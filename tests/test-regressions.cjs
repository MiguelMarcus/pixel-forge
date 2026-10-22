const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const PF = require('../src/core.js');
require('../src/aseprite.js');
require('../src/profiles.js');
require('../src/sheet.js');
require('../src/shadow.js');
const { createStore, fromSetFile } = require('../src/library.js');

function solid(w, h) {
  return { width:w, height:h, indices:new Uint8Array(w*h),
    palette:[{r:255,g:0,b:0,a:255}], transparentIndex:-1, outlineIndex:-1 };
}

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
