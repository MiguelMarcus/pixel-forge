const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const PF = require('../src/core.js');
require('../src/aseprite.js');
require('../src/profiles.js');
require('../src/sheet.js');
require('../src/shadow.js');
const { createStore, fromSetFile } = require('../src/library.js');

test('worker executa núcleo real e retorna resultado serializável ou erro', () => {
  const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
  let message;
  const self={location:{search:'?v=test'},postMessage(value){message=structuredClone(value);}};
  const context=vm.createContext({self,Uint8ClampedArray,Uint8Array,Float64Array,Uint32Array,Int32Array,Map});
  context.importScripts=(url)=>{
    assert.equal(url,'core.js?v=test');
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8'),context);
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/pipeline-worker.js'),'utf8'),context);
  const image=PF.createImage(8,8);image.data.fill(255);
  const options={mode:'structure',targetW:4,targetH:4,palette:[{r:255,g:255,b:255,a:255}]};
  self.onmessage({data:{image,options}});
  const expected=PF.conform(image,options);
  assert.deepEqual([...message.result.asset.indices],[...expected.asset.indices]);
  assert.equal(message.result.asset.width,4);
  assert.ok(message.result.stats.usage instanceof Map);
  self.onmessage({data:{image:null,options}});
  assert.equal(typeof message.error,'string');
});

function solid(w, h) {
  return { width:w, height:h, indices:new Uint8Array(w*h),
    palette:[{r:255,g:0,b:0,a:255}], transparentIndex:-1, outlineIndex:-1 };
}

test('votação limpa preserva cores próximas e desempata sem depender do espelhamento', () => {
  const palette=[96,100,103].map(v=>({r:v,g:v,b:v,a:255}));
  for(const mode of ['clean','structure']) {
    const image=PF.createImage(2,1);image.data.set([96,96,96,255,103,103,103,255]);
    const result=PF.resample(image,1,1,mode);
    assert.equal(result.data[0],96);
    image.data.set([103,103,103,255,96,96,96,255]);
    assert.deepEqual(PF.resample(image,1,1,mode).data,result.data);
  }
  const image=PF.createImage(2,1);image.data.set([96,96,96,255,103,103,103,255]);
  const result=PF.conform(image,{mode:'clean',palette,targetW:1,targetH:1,doAutoCrop:false});
  assert.notEqual(result.asset.indices[0],1);
  image.data.set([255,0,0,255,0,0,255,255]);
  const before=PF.resample(image,1,1,'dominant');
  image.data.set([0,0,255,255,255,0,0,255]);
  assert.deepEqual(PF.resample(image,1,1,'dominant').data,before.data);
});

test('bordas fortes são preservadas em todos os canais', () => {
  for(let channel=0;channel<3;channel++) {
    const image=PF.createImage(12,8);
    for(let y=0;y<8;y++)for(let x=0;x<12;x++) {
      const color=[100,100,100,255];color[channel]=x<6?50:150;
      image.data.set(color,(y*12+x)*4);
    }
    assert.deepEqual(PF.analyzeRegions(image).data,image.data);
  }
});

test('limpa ilha compacta discreta mas protege conexão diagonal e brilho', () => {
  const asset=solid(8,8);
  asset.palette=[{r:100,g:100,b:100,a:255},{r:120,g:120,b:120,a:255},{r:255,g:255,b:255,a:255}];
  const island=[27,28,35,36];island.forEach(p=>asset.indices[p]=1);
  assert.ok(island.every(p=>PF.cleanRegionSpecks(asset).indices[p]===0));
  asset.indices[18]=1;
  assert.ok(island.every(p=>PF.cleanRegionSpecks(asset).indices[p]===1));
  asset.indices[18]=0;island.forEach(p=>asset.indices[p]=2);
  assert.ok(island.every(p=>PF.cleanRegionSpecks(asset).indices[p]===2));
});

test('análise de regiões reduz ruído sem atravessar uma borda forte', () => {
  const image=PF.createImage(12,8);
  for(let y=0;y<8;y++) for(let x=0;x<12;x++) {
    const v=x<6?100+((x+y)%2?8:-8):230;
    image.data.set([v,v,v,255],(y*12+x)*4);
  }
  const out=PF.analyzeRegions(image);
  assert.ok(Math.abs(out.data[(3*12+3)*4]-100)<4);
  assert.ok(out.data[(3*12+5)*4]<110);
  assert.equal(out.data[(3*12+6)*4],230);
  assert.equal(image.data[(3*12+3)*4],92);
});

test('limpeza regional preserva linhas, brilhos e transparência', () => {
  const asset=solid(7,7);
  asset.palette=[{r:100,g:100,b:100,a:255},{r:120,g:120,b:120,a:255},
    {r:255,g:255,b:255,a:255},{r:0,g:0,b:0,a:0}];
  asset.indices[3*7+3]=1;
  assert.equal(PF.cleanRegionSpecks(asset).indices[24],0);
  asset.indices[24]=2;
  assert.equal(PF.cleanRegionSpecks(asset).indices[24],2);
  asset.indices[24]=1;asset.indices[25]=1;
  assert.equal(PF.cleanRegionSpecks(asset).indices[24],1);
  asset.indices[25]=3;
  const out=PF.cleanRegionSpecks(asset);
  assert.equal(out.indices[24],1);assert.equal(out.indices[25],3);
  assert.equal(asset.indices[24],1);
});

test('análise é limitada em resolução e não altera pixel art no tamanho nativo', () => {
  const palette=[{r:100,g:100,b:100,a:255},{r:120,g:120,b:120,a:255}];
  const image=PF.createImage(7,7);
  for(let i=0;i<49;i++) image.data.set([100,100,100,255],i*4);
  image.data.set([120,120,120,255],24*4);
  const native=PF.conform(image,{targetW:7,targetH:7,mode:'structure',doAutoCrop:false,palette});
  assert.equal(native.asset.indices[24],1);
  assert.equal(native.stages.regionAnalysis,undefined);
  const reduced=PF.conform(image,{targetW:2,targetH:2,mode:'structure',doAutoCrop:false,palette});
  assert.deepEqual(reduced.stages.regionAnalysis,{w:6,h:6});
  assert.equal(reduced.asset.width,2);
});

test('redução fracionária pesa a área real sem duplicar pixels da borda', () => {
  const image=PF.createImage(3,1);
  image.data.set([0,0,0,255,255,255,255,255,0,0,0,255]);
  const result=PF.resample(image,2,1,'box');
  assert.deepEqual([...result.data],[85,85,85,255,85,85,85,255]);
});

test('dominante considera cobertura alpha ao escolher a cor', () => {
  const image=PF.createImage(3,1);
  image.data.set([255,0,0,1,255,0,0,1,0,0,255,255]);
  assert.deepEqual([...PF.resample(image,1,1,'dominant').data],[0,0,255,86]);
});

test('pixel art limpa reúne variações do mesmo tom antes da redução', () => {
  const image=PF.createImage(4,2);
  const tones=[80,88,96,104,112,120,240,240];
  tones.forEach((v,i)=>image.data.set([v,v,v,255],i*4));
  const before=[...image.data];
  const palette=[{r:100,g:100,b:100,a:255},{r:240,g:240,b:240,a:255}];
  const opts={targetW:1,targetH:1,palette,doAutoCrop:false,fit:'stretch'};
  const original=PF.conform(image,{...opts,mode:'dominant'});
  const clean=PF.conform(image,{...opts,mode:'clean'});
  assert.equal(original.asset.indices[0],1);
  assert.equal(clean.asset.indices[0],0);
  assert.deepEqual([...image.data],before);
});

test('modo limpo mantém transparência e detalhes na escala original', () => {
  const image=PF.createImage(3,1);
  image.data.set([100,100,100,255,240,240,240,255,0,0,0,0]);
  const palette=[{r:100,g:100,b:100,a:255},{r:240,g:240,b:240,a:255}];
  const result=PF.conform(image,{targetW:3,targetH:1,palette,mode:'clean',doAutoCrop:false});
  assert.deepEqual([...result.asset.indices],[0,1,result.asset.transparentIndex]);
});

test('Aseprite preserva alpha parcial, inclusive no cel comprimido', async () => {
  const asset = solid(2,1);
  asset.palette.push({r:0,g:0,b:0,a:0});
  asset.palette[0].a=115; asset.transparentIndex=1; asset.indices[1]=1;
  const bytes=await PF.encodeAseprite(asset,{colorDepth:'rgba'});
  let cel;
  for(let pos=144;pos<bytes.length;) {
    const view=new DataView(bytes.buffer,bytes.byteOffset+pos);
    if(view.getUint16(4,true)===0x2005) cel=zlib.inflateSync(bytes.subarray(pos+26,pos+view.getUint32(0,true)));
    pos+=view.getUint32(0,true);
  }
  assert.deepEqual([...cel],[255,0,0,115,0,0,0,0]);
});

test('contorno interno de 3px inclui distância até o exterior do quadro', () => {
  const asset=PF.addOutline(solid(9,9),3,{inner:true,color:'#000000'});
  for(let y=0;y<9;y++) for(let x=0;x<9;x++) {
    const distance=Math.min(x,y,8-x,8-y)+1;
    assert.equal(asset.indices[y*9+x]===asset.outlineIndex,distance<=3,`${x},${y}`);
  }
});

test('contorno interno combina borda do quadro e transparência interna', () => {
  const input=solid(9,9); input.palette.push({r:0,g:0,b:0,a:0});
  input.transparentIndex=1; input.indices[4*9+4]=1;
  const asset=PF.addOutline(input,2,{inner:true,color:'#000000'});
  for(let y=0;y<9;y++) for(let x=0;x<9;x++) {
    if(x===4 && y===4) {assert.equal(asset.indices[y*9+x],1);continue;}
    const distance=Math.min(x+1,y+1,9-x,9-y,Math.abs(x-4)+Math.abs(y-4));
    assert.equal(asset.indices[y*9+x]===asset.outlineIndex,distance<=2,`${x},${y}`);
  }
});

test('todos os presets de fundo passam na resolução; sprite gigante continua inválido', () => {
  for(const [w,h] of PF.profileGet('background').sizes) {
    const asset=solid(w,h), stats=PF.computeStats(asset);
    assert.equal(PF.validate(asset,PF.profileContract('background'),stats).checks.find(c=>c.id==='resolution').ok,true);
  }
  const giant=solid(640,360);
  assert.equal(PF.validate(giant,PF.profileContract('character'),PF.computeStats(giant)).checks.find(c=>c.id==='resolution').ok,false);
});

test('régua verifica a base configurada mesmo para um único sprite', () => {
  const asset=solid(32,32);
  function check(y, baseline=480) { return PF.validateSheet({mode:'ruler',width:64,height:512,baseline,placements:[{asset,x:0,y}]}).checks.find(c=>c.id==='baseline').ok; }
  assert.equal(check(0),false);
  assert.equal(check(448),true);
  assert.equal(check(446),false);
  assert.equal(check(-32,0),true);
});

test('limite da paleta preserva transparência e rejeita overflow antes de escrever índices', () => {
  const palette=Array.from({length:256},(_,r)=>({r,g:0,b:0,a:255}));
  const image=PF.createImage(2,1); image.data.set([254,0,0,255,0,0,0,0]);
  assert.throws(()=>PF.quantize(image,palette),/256/);
  const asset=PF.quantize(image,palette.slice(0,255)).asset;
  assert.equal(asset.palette.length,256);
  assert.equal(PF.toRGBA(asset).data[7],0);
  image.data[7]=255;
  assert.equal(PF.quantize(image,palette).asset.palette.length,256);
  assert.throws(()=>PF.addOutline(PF.quantize(image,palette).asset,1),/entrada/);
});

test('sombra descarta cores não usadas e rejeita overflow sem corromper índices', () => {
  const asset=solid(2,1);
  asset.palette=Array.from({length:256},(_,r)=>({r,g:0,b:0,a:255}));
  assert.equal(PF.compositeShadow(asset,{}).palette.length,3);
  const full=solid(255,1);
  full.palette=asset.palette.slice(0,255);
  full.indices=Uint8Array.from({length:255},(_,i)=>i);
  assert.throws(()=>PF.compositeShadow(full,{}),/254/);
});

// Pequeno substituto transacional: alterações só entram no estado ao completar.
function fakeIDB() {
  let state={items:new Map(),meta:new Map()}, failure=null;
  const database={transaction(names,mode) {
    names=Array.isArray(names)?names:[names];
    const staged={items:new Map(state.items),meta:new Map(state.meta)};
    let aborted=false;
    const tx={error:null,abort(){aborted=true;},objectStore(name) {
      return {
        put(value,key) {if(failure==='throw'){throw new Error('write failed');} staged[name].set(key??value.id,structuredClone(value));},
        delete(key){staged[name].delete(key);},clear(){staged[name].clear();},
        get(key){const req={};queueMicrotask(()=>{req.result=structuredClone(staged[name].get(key));req.onsuccess?.();});return req;},
        getAll(){const req={};queueMicrotask(()=>{req.result=structuredClone([...staged[name].values()]);req.onsuccess?.();});return req;}
      };
    }};
    setImmediate(()=>{
      if(aborted || (mode==='readwrite' && failure)) {
        tx.error=new Error('quota/abort');
        if(failure==='error') tx.onerror?.(); else tx.onabort?.();
      } else {if(mode==='readwrite') for(const name of names) state[name]=staged[name];tx.oncomplete?.();}
    });
    return tx;
  }};
  return {api:{open(){const req={};queueMicrotask(()=>{req.result=database;req.onsuccess();});return req;}},fail(value){failure=value;}};
}

test('erros e abortos de IndexedDB são propagados; gravação falha não aparece como salva', async () => {
  const fake=fakeIDB();global.indexedDB=fake.api;
  try {
    const store=createStore();await store.ready;await store.put({id:'old'});
    for(const failure of ['error','abort','throw']) {
      fake.fail(failure);
      await assert.rejects(store.put({id:'lost'}));
      assert.ok(store.error());
      assert.deepEqual(await store.all(),[{id:'old'}]);
    }
    fake.fail(null); await store.put({id:'new'});assert.equal(store.error(),null);
  } finally {delete global.indexedDB;}
});

test('substituição atômica preserva itens e metadados quando a transação aborta', async () => {
  const fake=fakeIDB();global.indexedDB=fake.api;
  try {
    const store=createStore();await store.ready;
    await store.replace([{id:'old'}],{anchor:'old',project:{profile:'character'}});
    fake.fail('abort');
    await assert.rejects(store.replace([{id:'new'}],{anchor:'new',project:{profile:'background'}}));
    assert.deepEqual(await store.all(),[{id:'old'}]);assert.equal(await store.getMeta('anchor'),'old');
    fake.fail(null);await store.replace([{id:'new'}],{anchor:'new',project:{profile:'background'}});
    assert.deepEqual(await store.all(),[{id:'new'}]);assert.equal(await store.getMeta('anchor'),'new');
    assert.deepEqual(await store.getMeta('project'),{profile:'background'});
  } finally {delete global.indexedDB;}
});

test('gravação aguarda abertura do banco; modo memória mantém substituição e metadados', async () => {
  const fake=fakeIDB();global.indexedDB=fake.api;
  const indexed=createStore();await indexed.put({id:'early'});assert.deepEqual(await indexed.all(),[{id:'early'}]);
  delete global.indexedDB;
  const memory=createStore();await memory.replace([{id:'m'}],{anchor:'m'});
  assert.deepEqual(await memory.all(),[{id:'m'}]);assert.equal(await memory.getMeta('anchor'),'m');
});

test('backup rejeita versão e estrutura inválidas antes de carregar fontes', () => {
  assert.throws(()=>fromSetFile('{'),/JSON/);
  assert.throws(()=>fromSetFile(JSON.stringify({format:'pixelforge-set',version:99,items:[]})),/versão/);
  const valid={format:'pixelforge-set',version:1,profile:'character',contract:PF.profileContract('character'),items:[]};
  assert.equal(fromSetFile(JSON.stringify(valid)).items.length,0);
  assert.throws(()=>fromSetFile(JSON.stringify({...valid,items:[{}]})),/asset/);
  assert.throws(()=>fromSetFile(JSON.stringify({...valid,sheet:{width:0}})),/layout/);
});

test('armazenamento em memória não compartilha referências com receitas editáveis', async () => {
  const store=createStore();
  const item={id:'a',params:{sizeW:32}};
  const write=store.put(item);item.params.sizeW=64;await write;
  assert.equal((await store.all())[0].params.sizeW,32);
  const returned=await store.all();returned[0].params.sizeW=128;
  assert.equal((await store.all())[0].params.sizeW,32);
  const meta={strength:6};await store.putMeta('lighting',meta);meta.strength=12;
  const read=await store.getMeta('lighting');read.strength=20;
  assert.equal((await store.getMeta('lighting')).strength,6);
});

test('substituição e escrita capturam dados antes da abertura assíncrona', async () => {
  const fake=fakeIDB();global.indexedDB=fake.api;
  try {
    const store=createStore(),records=[{id:'a',params:{sizeW:32}}],metadata={lighting:{strength:6}};
    const write=store.replace(records,metadata);records[0].params.sizeW=64;metadata.lighting.strength=12;await write;
    assert.equal((await store.all())[0].params.sizeW,32);
    assert.equal((await store.getMeta('lighting')).strength,6);
  } finally {delete global.indexedDB;}
});

test('grade detecta sobreposição e frames deslocados para fora das células', () => {
  const asset=solid(32,32);
  const result=PF.validateSheet({mode:'grid',width:64,height:64,cell:32,placements:[{asset,x:0,y:0},{asset,x:1,y:0}]});
  assert.equal(result.checks.find(c=>c.id==='overlap').ok,false);
  assert.equal(result.checks.find(c=>c.id==='gridAlignment').ok,false);
});
