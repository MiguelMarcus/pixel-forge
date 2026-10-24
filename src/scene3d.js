/* Bancada 3D local: WebGL sem dependências remotas, scripts clássicos/file://. */
(function (root) {
  'use strict';
  var PF = root.PF, gl, program, buffer, texture, deps, active = false, raf = 0;
  var source = null, yaw = 0.55, pitch = -0.25, distance = 3.2, drag = null;
  var $ = function (id) { return document.getElementById(id); };
  function connect(d) { deps = d; }
  function canvasFor(asset) {
    var c = document.createElement('canvas'); c.width = asset.width; c.height = asset.height;
    var x = c.getContext('2d'), im = x.createImageData(asset.width, asset.height), rgba = PF.toRGBA(asset);
    im.data.set(rgba.data); x.putImageData(im, 0, 0); return c;
  }
  function selectedSource() {
    var id = $('sceneSource').value;
    if (id === 'editor') return deps && deps.getEditor();
    var all = deps ? deps.getAssets() : [];
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function makeGeometry(shape) {
    var p = [], uv = [];
    function quad(a,b,c,d) { [a,b,c,a,c,d].forEach(function(v, i) { p.push(v[0],v[1],v[2]); uv.push([[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]][i][0], [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]][i][1]); }); }
    if (shape === 'card' || shape === 'ground') {
      var y0=shape==='ground'?0:-0.8, y1=shape==='ground'?0:0.8, z0=shape==='ground'?-0.8:0, z1=shape==='ground'?0.8:0;
      quad([-0.8,y0,z0],[0.8,y0,z0],[0.8,y1,z1],[-0.8,y1,z1]);
    } else {
      var a=[-0.75,-0.75,0.75],b=[0.75,-0.75,0.75],c=[0.75,0.75,0.75],d=[-0.75,0.75,0.75], e=[-0.75,-0.75,-0.75],f=[0.75,-0.75,-0.75],g=[0.75,0.75,-0.75],h=[-0.75,0.75,-0.75];
      quad(a,b,c,d); quad(f,e,h,g); quad(e,a,d,h); quad(b,f,g,c); quad(d,c,g,h); quad(e,f,b,a);
    }
    var ru=Math.max(1,Math.min(8,Number($('sceneRepeatU').value)||1)), rv=Math.max(1,Math.min(8,Number($('sceneRepeatV').value)||1));
    for(var q=0;q<uv.length;q+=2){uv[q]*=ru;uv[q+1]*=rv;}
    return { positions:new Float32Array(p), uv:new Float32Array(uv) };
  }
  function shader(type, text) { var s=gl.createShader(type); gl.shaderSource(s,text); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function initGL() {
    var c=$('sceneCanvas'); gl=c.getContext('webgl',{alpha:false,antialias:false})||c.getContext('experimental-webgl');
    if(!gl) throw new Error('WebGL indisponível neste navegador. As abas 2D continuam disponíveis.');
    program=gl.createProgram(); gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec3 p; attribute vec2 t; uniform float a; uniform float b; uniform float z; uniform float aspect; varying vec2 v; void main(){ float x=p.x*cos(a)-p.z*sin(a); float zz=p.x*sin(a)+p.z*cos(a); float y=p.y*cos(b)-zz*sin(b); zz=p.y*sin(b)+zz*cos(b); float w=max(0.4,z-zz); gl_Position=vec4(x/(w*aspect),y/w,zz*0.12,1.0); v=t; }')); gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float; uniform sampler2D tex; uniform float alphaOn; varying vec2 v; void main(){ vec4 c=texture2D(tex,v); if(alphaOn>0.5 && c.a<0.03) discard; gl_FragColor=vec4(c.rgb,alphaOn>0.5?c.a:1.0); }')); gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('Não foi possível iniciar o renderizador 3D.');
    buffer=gl.createBuffer(); texture=gl.createTexture(); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.DEPTH_TEST);
  }
  function refreshSource() {
    source=selectedSource(); $('sceneEmpty').classList.toggle('hidden',!!source); $('sceneStatus').textContent=source?'Objeto pronto':'Nenhum objeto'; $('sceneExport').disabled=!source; $('scenePng').disabled=!source; $('sceneRecipe').disabled=!source;
    if(!source) { $('sceneAssetName').textContent='Sem asset de origem'; draw(); return; }
    $('sceneAssetName').textContent=source.name||'sprite atual'; $('sceneDimensions').textContent=' · '+source.asset.width+' × '+source.asset.height+' px';
    var c=canvasFor(source.asset), res=$('sceneResolution').value;
    if(res!=='source' && Math.max(c.width,c.height)>Number(res)) { var scale=Number(res)/Math.max(c.width,c.height), small=document.createElement('canvas'); small.width=Math.max(1,Math.round(c.width*scale)); small.height=Math.max(1,Math.round(c.height*scale)); var sx=small.getContext('2d'); sx.imageSmoothingEnabled=false; sx.drawImage(c,0,0,small.width,small.height); c=small; }
    if(gl) { gl.bindTexture(gl.TEXTURE_2D,texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c); var linear=$('sceneFilter').value==='linear'; gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,linear?gl.LINEAR:gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,linear?gl.LINEAR:gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT); }
    $('sceneThumb').innerHTML=''; var img=document.createElement('img'); img.src=c.toDataURL('image/png'); img.alt='Miniatura da textura'; $('sceneThumb').appendChild(img); draw();
  }
  function draw() {
    if(!active||!gl) return; var c=$('sceneCanvas'), dpr=Math.min(root.devicePixelRatio||1,2), w=Math.max(1,Math.round(c.clientWidth*dpr)),h=Math.max(1,Math.round(c.clientHeight*dpr));
    if(c.width!==w||c.height!==h){c.width=w;c.height=h;} gl.viewport(0,0,w,h); gl.clearColor(0.055,0.067,0.09,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    if(!source)return; var geo=makeGeometry($('sceneShape').value); gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,geo.positions,gl.STATIC_DRAW); var pp=gl.getAttribLocation(program,'p'); gl.enableVertexAttribArray(pp); gl.vertexAttribPointer(pp,3,gl.FLOAT,false,0,0); var ub=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,ub); gl.bufferData(gl.ARRAY_BUFFER,geo.uv,gl.STATIC_DRAW); var tp=gl.getAttribLocation(program,'t'); gl.enableVertexAttribArray(tp); gl.vertexAttribPointer(tp,2,gl.FLOAT,false,0,0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture); gl.uniform1i(gl.getUniformLocation(program,'tex'),0); gl.uniform1f(gl.getUniformLocation(program,'a'),yaw); gl.uniform1f(gl.getUniformLocation(program,'b'),pitch); gl.uniform1f(gl.getUniformLocation(program,'z'),distance); gl.uniform1f(gl.getUniformLocation(program,'aspect'),w/h); gl.uniform1f(gl.getUniformLocation(program,'alphaOn'),$('sceneAlpha').checked?1:0); gl.drawArrays(gl.TRIANGLES,0,geo.positions.length/3); gl.deleteBuffer(ub);
  }
  function tick(){ if(!active)return; draw(); raf=requestAnimationFrame(tick); }
  function enter(){ active=true; var sel=$('sceneSource'), old=sel.value, assets=deps?deps.getAssets():[]; while(sel.options.length>1)sel.remove(1); assets.forEach(function(it){var o=document.createElement('option');o.value=it.id;o.textContent='Biblioteca · '+it.name;sel.appendChild(o);}); if(old!=='editor'&&assets.some(function(a){return a.id===old;}))sel.value=old; else sel.value='editor'; if(!gl){try{initGL();}catch(e){$('sceneStatus').textContent='Erro';$('sceneEmpty').textContent=e.message;$('sceneEmpty').classList.remove('hidden');return;}} refreshSource(); cancelAnimationFrame(raf); tick(); }
  function leave(){active=false;cancelAnimationFrame(raf);}
  function safeName(s){return String(s||'pixel-forge').replace(/\.[^.]+$/,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase()||'pixel-forge';}
  function trigger(blob,name){var u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(u);},30000);}
  function imagePng(){var c=canvasFor(source.asset),r=$('sceneResolution').value;if(r!=='source'&&Math.max(c.width,c.height)>Number(r)){var q=document.createElement('canvas'),k=Number(r)/Math.max(c.width,c.height);q.width=Math.round(c.width*k);q.height=Math.round(c.height*k);var x=q.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(c,0,0,q.width,q.height);c=q;} return c;}
  function makeGlb(){
    var im=imagePng(), data=im.toDataURL('image/png'), geo=makeGeometry($('sceneShape').value), pos=geo.positions, uv=geo.uv, indices=new Uint16Array(pos.length/3); for(var i=0;i<indices.length;i++)indices[i]=i;
    var bytes=new Uint8Array(pos.byteLength+uv.byteLength+indices.byteLength), off=0; bytes.set(new Uint8Array(pos.buffer),off);var po=off;off+=pos.byteLength;bytes.set(new Uint8Array(uv.buffer),off);var uo=off;off+=uv.byteLength;bytes.set(new Uint8Array(indices.buffer),off);var io=off;
    var json={asset:{version:'2.0',generator:'Pixel Forge local 3D'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:0,roughnessFactor:1},alphaMode:$('sceneAlpha').checked?'BLEND':'OPAQUE',doubleSided:true}],textures:[{source:0}],images:[{uri:data}],samplers:[{magFilter:$('sceneFilter').value==='linear'?9729:9728,minFilter:$('sceneFilter').value==='linear'?9729:9728,wrapS:10497,wrapT:10497}],accessors:[{bufferView:0,componentType:5126,count:pos.length/3,type:'VEC3',min:[-0.8,-0.8,-0.8],max:[0.8,0.8,0.8]},{bufferView:1,componentType:5126,count:uv.length/2,type:'VEC2'},{bufferView:2,componentType:5123,count:indices.length,type:'SCALAR'}],bufferViews:[{buffer:0,byteOffset:po,byteLength:pos.byteLength,target:34962},{buffer:0,byteOffset:uo,byteLength:uv.byteLength,target:34962},{buffer:0,byteOffset:io,byteLength:indices.byteLength,target:34963}],buffers:[{uri:'data:application/octet-stream;base64,'+btoa(String.fromCharCode.apply(null,bytes)),byteLength:bytes.length}]};
    var j=new TextEncoder().encode(JSON.stringify(json)), pad=(4-j.length%4)%4, jp=new Uint8Array(j.length+pad);jp.set(j);for(var z=j.length;z<jp.length;z++)jp[z]=32;var total=12+8+jp.length, out=new Uint8Array(total),v=new DataView(out.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,total,true);v.setUint32(12,jp.length,true);v.setUint32(16,0x4e4f534a,true);out.set(jp,20);return out;
  }
  function validateGlb(bytes){var v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(v.byteLength<20||v.getUint32(0,true)!==0x46546c67||v.getUint32(4,true)!==2||v.getUint32(8,true)!==v.byteLength)throw new Error('GLB inválido ou incompleto.');var len=v.getUint32(12,true),j=JSON.parse(new TextDecoder().decode(bytes.slice(20,20+len)));if(!j.meshes||!j.images||!j.images[0].uri||j.images[0].uri.indexOf('data:image/png;base64,')!==0)throw new Error('GLB sem mesh ou textura PNG incorporada.');return j;}
  function init(){var c=$('sceneCanvas'); if(!c)return; $('sceneSource').addEventListener('change',refreshSource);['sceneShape','sceneFilter','sceneRepeatU','sceneRepeatV','sceneAlpha','sceneResolution'].forEach(function(id){$(id).addEventListener('change',refreshSource);}); $('scenePreset').addEventListener('change',function(){var p=this.value;$('sceneFilter').value=p==='linear'?'linear':'nearest';if(p==='lowpoly'&&['cube','box'].indexOf($('sceneShape').value)<0)$('sceneShape').value='cube';if(p==='ps1')$('sceneResolution').value='32';refreshSource();}); $('sceneReset').onclick=function(){yaw=.55;pitch=-.25;distance=3.2;draw();}; c.addEventListener('pointerdown',function(e){drag=[e.clientX,e.clientY];c.setPointerCapture(e.pointerId);});c.addEventListener('pointermove',function(e){if(!drag)return;yaw+=(e.clientX-drag[0])*.01;pitch=Math.max(-1.4,Math.min(1.4,pitch+(e.clientY-drag[1])*.01));drag=[e.clientX,e.clientY];draw();});['pointerup','pointercancel','lostpointercapture'].forEach(function(ev){c.addEventListener(ev,function(){drag=null;});});c.addEventListener('wheel',function(e){e.preventDefault();distance=Math.max(1.7,Math.min(8,distance+e.deltaY*.003));draw();},{passive:false});
    $('sceneExport').onclick=function(){try{$('sceneStatus').textContent='Carregando GLB exportado…';var bytes=makeGlb(),parsed=validateGlb(bytes);if(!parsed.meshes.length)throw new Error('Mesh ausente.');$('sceneStatus').textContent='GLB validado e objeto pronto';trigger(new Blob([bytes],{type:'model/gltf-binary'}),safeName(source.name)+'.glb');$('sceneRecipeStatus').textContent='GLB validado localmente';}catch(e){$('sceneStatus').textContent='Erro';deps.toast('Falha ao validar GLB: '+e.message);}};
    $('scenePng').onclick=function(){imagePng().toBlob(function(b){trigger(b,safeName(source.name)+'-textura.png');},'image/png');}; $('sceneRecipe').onclick=function(){var recipe={format:'pixel-forge-model3d',version:1,asset:{name:source.name,width:source.asset.width,height:source.asset.height},shape:$('sceneShape').value,faces:{all:source.name},material:{filter:$('sceneFilter').value,repeatU:Number($('sceneRepeatU').value)||1,repeatV:Number($('sceneRepeatV').value)||1,alpha:$('sceneAlpha').checked,resolution:$('sceneResolution').value,preset:$('scenePreset').value}};trigger(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}),safeName(source.name)+'-3d-receita.json');$('sceneRecipeStatus').textContent='Receita exportada';}; $('sceneOpenGlb').onclick=function(){$('sceneGlbInput').click();};$('sceneGlbInput').onchange=function(){var f=this.files[0];if(!f)return;f.arrayBuffer().then(function(b){validateGlb(new Uint8Array(b));$('sceneStatus').textContent='GLB reaberto e validado';deps.toast('GLB validado: contém mesh e PNG incorporado.');}).catch(function(e){$('sceneStatus').textContent='Erro ao abrir GLB';deps.toast(e.message);});};
  }
  PF.scene3d={init:init,connect:connect,enter:enter,leave:leave};
})(typeof self!=='undefined'?self:this);
