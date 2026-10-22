const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const PF = require('../src/core.js');
require('../src/lighting.js');
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

function sprite(w=17,h=17) {
  const asset={width:w,height:h,transparentIndex:1,indices:new Uint8Array(w*h),palette:[{r:180,g:100,b:60,a:255},{r:0,g:0,b:0,a:0}]};
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(x===0 || y===0 || x===w-1 || y===h-1) asset.indices[y*w+x]=1;
  return asset;
}

test('silhueta gera volume com cor chapada, preservando fonte, resolução e alpha', () => {
  const input=sprite(), original=structuredClone(input);
  const m=PF.lighting.generate(input,{smooth:0});
  assert.ok(m.heights[8*17+8]>m.heights[8*17+1]);
  assert.equal(m.width,17);assert.equal(m.heights.length,17*17);
  for(let p=0;p<input.indices.length;p++) {
    const alpha=input.indices[p]===1?0:255;
    assert.equal(m.bump.data[p*4+3],alpha);assert.equal(m.normal.data[p*4+3],alpha);
    if(alpha) assert.ok(Math.abs(Math.hypot(...m.vectors.subarray(p*3,p*3+3))-1)<1e-6);
  }
  assert.deepEqual(input,original);
});

test('força zero produz normais neutras; normais laterais apontam para fora do volume', () => {
  const input=sprite();
  const flat=PF.lighting.generate(input,{strength:0});
  assert.deepEqual([...flat.normal.data.slice(4*100,4*100+3)],[128,128,255]);
  const m=PF.lighting.generate(input,{smooth:0});
  assert.ok(m.vectors[(8*17+2)*3]<0);
  assert.ok(m.vectors[(8*17+14)*3]>0);
  assert.ok(m.vectors[(2*17+8)*3+1]>0);
  assert.ok(m.vectors[(14*17+8)*3+1]<0);
});

test('luminosidade, mistura e inversão de altura têm efeito previsível', () => {
  const input=sprite(5,5);input.palette.push({r:255,g:255,b:255,a:255});input.indices[2*5+3]=2;
  const m=PF.lighting.generate(input,{mode:'luminance',smooth:0});
  const inverted=PF.lighting.generate(input,{mode:'luminance',smooth:0,invert:true});
  assert.equal(m.heights[13],1);assert.ok(inverted.heights[13]<1e-6);
  assert.ok(m.heights[11]<m.heights[13]);
  const mixed=PF.lighting.generate(input,{mode:'silhouette',detail:1,smooth:0});
  assert.deepEqual(mixed.heights,m.heights);
  assert.equal(inverted.bump.data[3],0);
});

test('inverter Y só altera verde exportado; iluminação física da prévia permanece igual', () => {
  const a=PF.lighting.generate(sprite(),{flipY:false}), b=PF.lighting.generate(sprite(),{flipY:true});
  const p=(2*17+8)*4;
  assert.equal(a.normal.data[p],b.normal.data[p]);
  assert.equal(a.normal.data[p+1]+b.normal.data[p+1],255);
  assert.deepEqual(PF.lighting.illuminate(a,{}),PF.lighting.illuminate(b,{}));
});

test('trocar direção da luz troca o lado iluminado; ambiente funciona sem luz direta', () => {
  const m=PF.lighting.generate(sprite(),{strength:8});
  const left=PF.lighting.illuminate(m,{azimuth:180,elevation:30,ambient:0,specular:0,selfShadow:false,color:'#ffffff'});
  const right=PF.lighting.illuminate(m,{azimuth:0,elevation:30,ambient:0,specular:0,selfShadow:false,color:'#ffffff'});
  assert.ok(left.data[(8*17+2)*4]>right.data[(8*17+2)*4]);
  assert.ok(right.data[(8*17+14)*4]>left.data[(8*17+14)*4]);
  const ambient=PF.lighting.illuminate(m,{ambient:0.5,intensity:0});
  assert.equal(ambient.data[(8*17+8)*4],90);
  for(let p=0;p<m.mask.length;p++) assert.equal(ambient.data[p*4+3],m.source.data[p*4+3]);
});

test('autossombra detecta um relevo alto entre a superfície e a luz baixa', () => {
  const input=sprite(9,5);input.palette[0]={r:50,g:50,b:50,a:255};input.palette.push({r:255,g:255,b:255,a:255});
  for(let y=1;y<4;y++) input.indices[y*9+5]=2;
  const m=PF.lighting.generate(input,{mode:'luminance',smooth:0,strength:20});
  const options={azimuth:0,elevation:5,ambient:0.2,specular:0};
  const shadow=PF.lighting.illuminate(m,{...options,selfShadow:true});
  const plain=PF.lighting.illuminate(m,{...options,selfShadow:false});
  assert.ok(shadow.data[(2*9+2)*4]<plain.data[(2*9+2)*4]);
});

test('sprite vazio, opaco e de um pixel produzem mapas finitos', () => {
  for(const input of [sprite(1,1),{...sprite(1,1),indices:new Uint8Array([0])},sprite(2,8)]) {
    const m=PF.lighting.generate(input,{smooth:4});
    assert.ok([...m.heights,...m.vectors].every(Number.isFinite));
    assert.equal(PF.lighting.illuminate(m,{}).data.length,input.width*input.height*4);
  }
  const input=sprite();input.palette[0].a=115;
  assert.equal(PF.lighting.generate(input,{}).normal.data[(8*17+8)*4+3],115);
});

test('configurações importadas são limitadas e inválidos usam padrões', () => {
  const s=PF.lighting.settings({strength:Infinity,smooth:999,ambient:-10,elevation:NaN,color:'invalid',view:'oops'});
  assert.equal(s.strength,6);assert.equal(s.smooth,4);assert.equal(s.ambient,0);assert.equal(s.elevation,45);assert.equal(s.view,'lit');
});

test('PNG RGBA preserva mais de 256 cores, alpha e bytes; gera arquivos para verificação independente', async () => {
  const image=PF.createImage(17,17);
  for(let y=0;y<17;y++) for(let x=0;x<17;x++) image.data.set([x*15,y*15,(x+y)*7,(x+y)%2?115:255],(y*17+x)*4);
  const png=await PF.encodeRGBAPNG(image);
  assert.equal(png[25],6);
  const compressed=[];
  for(let pos=8;pos<png.length;) {
    const n=Buffer.from(png).readUInt32BE(pos), type=Buffer.from(png.subarray(pos+4,pos+8)).toString();
    if(type==='IDAT') compressed.push(png.subarray(pos+8,pos+8+n));
    pos+=n+12;
  }
  const raw=zlib.inflateSync(Buffer.concat(compressed));
  for(let y=0;y<17;y++) assert.deepEqual([...raw.subarray(y*69+1,(y+1)*69)],[...image.data.subarray(y*68,(y+1)*68)]);
  fs.writeFileSync(path.join(out,'rgba-data.png'),png);fs.writeFileSync(path.join(out,'rgba-data.raw'),image.data);
  const maps=PF.lighting.generate(sprite(),{});
  for(const [name,img] of [['normal-map',maps.normal],['bump-map',maps.bump]]) {
    fs.writeFileSync(path.join(out,name+'.png'),await PF.encodeRGBAPNG(img));
    fs.writeFileSync(path.join(out,name+'.raw'),img.data);
  }
  await assert.rejects(PF.encodeRGBAPNG({width:2,height:2,data:new Uint8Array(1)}),/inválida/);
});
