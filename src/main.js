import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { World } from './world.js';
import { AudioEngine } from './audio.js';
import { createGame, startGame, update, objective, contextAction, WEAPONS, LEVELS, clamp, distance } from './core.js';

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints>0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.body.classList.toggle('touch',isTouch);
if(isTouch)$('brief-input').textContent='TOUCH CONTROLS';
const save = {get(key,fallback){try{return JSON.parse(localStorage.getItem('blockhawk.'+key))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem('blockhawk.'+key,JSON.stringify(value));}catch{}}};
const audio=new AudioEngine();audio.enabled=save.get('audio',true);audio.volume=save.get('volume',.65);
$('audio-label').textContent=audio.enabled?'SOUND ON':'SOUND OFF';$('audio-button').setAttribute('aria-label',audio.enabled?'Mute sound':'Enable sound');$('volume').value=audio.volume*100;
$('difficulty').value=save.get('difficulty','pilot');
const campaign={
  get unlocked(){return clamp(save.get('unlocked',1),1,LEVELS.length);},
  set unlocked(v){save.set('unlocked',clamp(v,1,LEVELS.length));},
};
let operation=clamp(save.get('operation',0),0,campaign.unlocked-1);
let game=createGame($('difficulty').value,operation);
let renderer,scene,camera,world,composer,gtao,bloom,dof,film,sun,renderPass;
let graphics=save.get('quality','auto'),resolvedQuality='balanced';$('quality').value=graphics;
let width=innerWidth,height=innerHeight,clockTime=0,lastTime=0,shake=0,damageFlash=0,toastTime=0,uiTick=0;
let pausedFrom='playing',manualFrom='briefing',initialReady=false,resizePending=false,webglLost=false;
let actualFps=60,frameAverage=16.6,performanceTime=0,autoDownshifted=false;
const keys=new Set();const input={x:0,z:0,fire:false,interact:false,flare:false,turn:0,strafe:false,aim:null};
let mouseFire=false,mouseAim=null,lastMouse=0,joy={x:0,y:0,id:null},touchFire=false,touchInteract=false,touchFlare=false,flareQueued=false,fireQueued=false;
const cameraFocus=new THREE.Vector3(game.base.x,0,game.base.z),cameraOffset=new THREE.Vector3(74,91,90);
const screenRight=new THREE.Vector3(.772,0,-.635),screenUp=new THREE.Vector3(-.635,0,-.772);
const raycaster=new THREE.Raycaster(),ground=new THREE.Plane(new THREE.Vector3(0,1,0),-3),tempVec=new THREE.Vector3();
const projected=new THREE.Vector3();
const formatTime = t => `${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;

function setPhase(phase) {game.phase=phase;document.body.dataset.phase=phase;clearInput();}
function toast(text,time=3) {$('toast').textContent=text;toastTime=time;}
function clearInput() {
  keys.clear();mouseFire=false;touchFire=false;touchInteract=false;touchFlare=false;flareQueued=false;fireQueued=false;joy={x:0,y:0,id:null};
  input.x=0;input.z=0;input.fire=false;input.interact=false;input.flare=false;
  $('stick').style.transform='';document.querySelectorAll('.pressed').forEach(b=>b.classList.remove('pressed'));
}
function showFatal(message) {$('loading').hidden=true;$('fatal').hidden=false;$('fatal-message').textContent=message;document.body.dataset.phase='error';}

function initGraphics() {
  renderer=new THREE.WebGLRenderer({canvas:$('scene'),antialias:true,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1.10;renderer.info.autoReset=false;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x729f91);scene.fog=new THREE.FogExp2(0x80a794,.0019);
  camera=new THREE.OrthographicCamera(-75,75,45,-45,.5,650);
  const hemi=new THREE.HemisphereLight(0xc4ded5,0x596444,1.75);scene.add(hemi);
  sun=new THREE.DirectionalLight(0xffdb9e,3.8);sun.position.set(-80,130,70);sun.castShadow=true;
  sun.shadow.camera.left=-90;sun.shadow.camera.right=90;sun.shadow.camera.top=90;sun.shadow.camera.bottom=-90;sun.shadow.camera.near=5;sun.shadow.camera.far=310;
  sun.shadow.bias=-.00025;sun.shadow.normalBias=.18;sun.shadow.radius=2.3;
  scene.add(sun,sun.target);
  const fill=new THREE.DirectionalLight(0x9bcbd1,.65);fill.position.set(90,60,-80);scene.add(fill);
  const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();
  const envTarget=pmrem.fromScene(room,.04);scene.environment=envTarget.texture;scene.environmentIntensity=.18;room.dispose();pmrem.dispose();
  world=new World(scene,game);
  const target=new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,samples:2});
  composer=new EffectComposer(renderer,target);renderPass=new RenderPass(scene,camera);composer.addPass(renderPass);
  gtao=new GTAOPass(scene,camera,width,height);gtao.output=GTAOPass.OUTPUT.Default;gtao.blendIntensity=.58;
  gtao.updateGtaoMaterial({radius:2.3,distanceExponent:1.1,thickness:2,distanceFallOff:.65,scale:1,samples:8});
  gtao.updatePdMaterial({lumaPhi:10,depthPhi:2,normalPhi:3,radius:5,rings:2,samples:8});composer.addPass(gtao);
  dof=new BokehPass(scene,camera,{focus:143,aperture:.00006,maxblur:.004});dof.materialBokeh.defines.PERSPECTIVE_CAMERA=0;composer.addPass(dof);
  bloom=new UnrealBloomPass(new THREE.Vector2(width,height),.22,.55,1.15);composer.addPass(bloom);
  composer.addPass(new OutputPass());
  film=new ShaderPass({uniforms:{tDiffuse:{value:null},uTime:{value:0},uGrain:{value:reducedMotion?0:.008}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,fragmentShader:`uniform sampler2D tDiffuse;uniform float uTime;uniform float uGrain;varying vec2 vUv;
    void main(){vec3 col=texture2D(tDiffuse,vUv).rgb;vec2 p=vUv*2.-1.;float vignette=1.-dot(p,p)*.095;
    float grain=fract(sin(dot(vUv,vec2(12.9898,78.233))+uTime)*43758.5453)-.5;
    col*=vignette;col+=grain*uGrain;col=mix(vec3(dot(col,vec3(.2126,.7152,.0722))),col,1.16);col=(col-.5)*1.045+.5;gl_FragColor=vec4(col,1.);}`});composer.addPass(film);
  setQuality(graphics);describeOperation();resize();updateCamera(1,true);
  renderer.compile(scene,camera);composer.render();
  initialReady=true;$('loading').hidden=true;setPhase('briefing');
  requestAnimationFrame(frame);
}

function setQuality(value) {
  graphics=value;save.set('quality',value);
  let resolved=value;
  if(value==='auto') {
    const gl=renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');
    const gpu=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'';
    resolved=isTouch?'mobile':/NVIDIA|Radeon RX|Apple M[234]/i.test(gpu)?'cinematic':'balanced';
  }
  resolvedQuality=resolved;
  const ratio=Math.min(devicePixelRatio||1,resolved==='mobile'?1.3:resolved==='cinematic'?2:1.5);
  renderer.setPixelRatio(ratio);composer.setPixelRatio(ratio);
  const shadowSize=resolved==='cinematic'?4096:resolved==='mobile'?1024:2048;
  if(sun.shadow.mapSize.x!==shadowSize){sun.shadow.mapSize.set(shadowSize,shadowSize);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}}
  gtao.enabled=resolved==='cinematic';dof.enabled=resolved==='cinematic';bloom.enabled=true;
  composer.renderTarget1.samples=resolved==='cinematic'?4:resolved==='balanced'?2:0;
  composer.renderTarget2.samples=composer.renderTarget1.samples;
  resize();
}
function resize() {
  width=innerWidth;height=innerHeight;renderer.setSize(width,height,false);composer.setSize(width,height);
  updateCamera(0,true);resizePending=false;
}
function updateCamera(dt,snap=false) {
  const intro=game.phase==='briefing',portrait=height>width;
  const extent=intro?(portrait?112:88):(portrait?111:isTouch?83:77);
  const speed=Math.hypot(game.p.vx,game.p.vz),zoomOut=intro?0:speed*.08;
  const view=extent+zoomOut,aspect=width/height;
  camera.left=-view*aspect/2;camera.right=view*aspect/2;camera.top=view/2;camera.bottom=-view/2;camera.updateProjectionMatrix();
  const focus=new THREE.Vector3(game.p.x+game.p.vx*.25,1,game.p.z+game.p.vz*.25);
  if(intro){focus.addScaledVector(screenRight,portrait?9:-25);focus.addScaledVector(screenUp,10);}
  if(snap)cameraFocus.copy(focus);else cameraFocus.lerp(focus,1-Math.exp(-5.2*dt));
  camera.position.copy(cameraFocus).add(cameraOffset);
  if(!reducedMotion&&shake>.01){camera.position.x+=(Math.random()-.5)*shake;camera.position.z+=(Math.random()-.5)*shake;}
  camera.lookAt(cameraFocus);
  camera.updateMatrixWorld();
  if(dof){tempVec.set(game.p.x,game.p.y,game.p.z).applyMatrix4(camera.matrixWorldInverse);dof.uniforms.focus.value=-tempVec.z;dof.uniforms.aperture.value=intro?.00006:.000012;}
  const sx=Math.round(cameraFocus.x/2)*2,sz=Math.round(cameraFocus.z/2)*2;
  sun.position.set(sx-80,130,sz+70);sun.target.position.set(sx,0,sz);sun.target.updateMatrixWorld();
}

// Populates the briefing, the checklists and the map heading for one operation.
function describeOperation() {
  const level=LEVELS[operation],count=level.objectives.length;
  $('brief-tagline').textContent=level.tagline;
  $('operation-title').innerHTML=`<span>OP. ${String(operation+1).padStart(2,'0')}</span> ${level.region}`;
  $('brief-intro').innerHTML=level.intro.join('<br>');
  $('deploy-button').innerHTML=`DEPLOY TO ${level.name.split(' ').pop()} <span>↗</span>`;
  $('brief-objectives').textContent=`${count} OBJECTIVES`;
  $('map-title').textContent=level.name+'.';
  $('top-location').textContent=level.name;
  $('mission-steps').innerHTML=level.objectives.map((_,i)=>`<i${i===0?' class="active"':''}></i>`).join('');
  $('map-objectives').innerHTML=level.objectives.map(o=>`<li>${o.label.charAt(0)+o.label.slice(1).toLowerCase()}</li>`).join('');
  $('operation-list').innerHTML=level.objectives.map(o=>`<li><b>${o.label.charAt(0)+o.label.slice(1).toLowerCase()}.</b> ${o.detail}</li>`).join('');
  const select=$('operation');
  select.innerHTML=LEVELS.map((l,i)=>`<option value="${i}"${i>=campaign.unlocked?' disabled':''}${i===operation?' selected':''}>${String(i+1).padStart(2,'0')} · ${l.name}${i>=campaign.unlocked?' · LOCKED':''}</option>`).join('');
  select.disabled=campaign.unlocked<2;
}
// A new operation needs a new world; the old one hands its buffers back first.
function loadOperation(index) {
  operation=clamp(index,0,campaign.unlocked-1);save.set('operation',operation);
  game=createGame($('difficulty').value,operation);
  if(world){world.dispose();world=new World(scene,game);}
  describeOperation();
  cameraFocus.set(game.base.x,1,game.base.z);updateCamera(1,true);
}
function deploy() {
  game=createGame($('difficulty').value,operation);save.set('difficulty',game.difficulty);world.reset(game);
  $('briefing').hidden=true;$('debrief').hidden=true;$('pause-screen').hidden=true;$('manual').hidden=true;$('map-screen').hidden=true;
  startGame(game);document.body.dataset.phase='playing';clearInput();mouseAim=null;lastMouse=0;shake=0;damageFlash=0;
  cameraFocus.set(game.p.x,1,game.p.z);audio.start().catch(()=>{});
  toast(isTouch?'FLIGHT: LEFT THUMB  /  WEAPONS: RIGHT THUMB':'W A S D TO FLY  ·  SPACE TO FIRE  ·  M FOR MAP',6);
  $('next-button').hidden=true;
  if(isTouch&&screen.orientation?.lock&&document.fullscreenElement)screen.orientation.lock('landscape').catch(()=>{});
  refreshHud();
}
function pause() {
  if(game.phase==='playing'){pausedFrom='playing';setPhase('paused');$('pause-screen').hidden=false;$('resume-button').focus();}
  else if(game.phase==='paused')resume();
}
function resume() {$('pause-screen').hidden=true;$('map-screen').hidden=true;$('manual').hidden=true;setPhase(pausedFrom==='briefing'?'briefing':'playing');}
function openManual() {
  manualFrom=game.phase;$('manual').hidden=false;if(game.phase==='playing')setPhase('paused');$('manual-ready').focus();
}
function closeManual() {$('manual').hidden=true;setPhase(manualFrom);if(manualFrom==='briefing')$('deploy-button').focus();}
function openMap() {
  if(game.phase==='map'){closeMap();return;}
  if(game.phase!=='playing')return;setPhase('map');$('map-screen').hidden=false;
  drawMap($('large-map'),true);[...$('map-objectives').children].forEach((li,i)=>{li.className=i<game.stage?'done':i===game.stage?'active':'';});
  $('map-resume').focus();
}
function closeMap() {$('map-screen').hidden=true;setPhase('playing');}
function returnToBriefing() {
  game=createGame($('difficulty').value,operation);world.reset(game);$('debrief').hidden=true;$('pause-screen').hidden=true;$('briefing').hidden=false;setPhase('briefing');updateCamera(1,true);$('deploy-button').focus();
}
function endMission(success) {
  document.body.dataset.phase=game.phase;clearInput();
  $('debrief-tag').textContent=success?'OPERATION COMPLETE':'OPERATION FAILED';
  $('debrief-title').innerHTML=success?'SMALL BIRD.<br>BIG HERO.':game.endTitle.replace(' ','<br>');
  $('debrief-description').textContent=success?'Four engineers home. One launch stopped. Not bad for a little helicopter.':game.reason;
  const rank=success?(game.time<390&&game.damageTaken<70?'S':game.time<650?'A':'B'):'×';$('rank-badge').textContent=rank;
  $('final-score').textContent=game.score.toLocaleString();
  const key='best.'+game.level.id+'.'+game.difficulty;
  const old=save.get(key,0);if(success&&game.score>old)save.set(key,game.score);
  if(success&&operation+1>=campaign.unlocked&&operation+1<LEVELS.length){
    campaign.unlocked=operation+2;
    toast('OPERATION '+String(operation+2).padStart(2,'0')+' UNLOCKED',5);
  }
  const hasNext=operation+1<LEVELS.length&&operation+1<campaign.unlocked;
  $('next-button').hidden=!(success&&hasNext);
  if(success&&hasNext)$('next-button').innerHTML=`NEXT: ${LEVELS[operation+1].name} <span>↗</span>`;
  $('best-score').textContent=success&&game.score>old?'NEW PERSONAL BEST':`PERSONAL BEST · ${Math.max(old,success?game.score:0).toLocaleString()}`;
  $('debrief-operation').textContent=`OPERATION ${String(operation+1).padStart(2,'0')} · ${game.level.name}`;
  $('stat-time').textContent=formatTime(game.time);$('stat-rescued').textContent=`${success?game.delivered:game.rescued} / 4`;$('stat-kills').textContent=game.kills;
  $('debrief').hidden=false;$('replay-button').focus();
}

function handleEvents() {
  for(const event of game.events) {
    world.handle(event);audio.event(event);
    if(event.type==='radio'){$('radio-text').textContent=event.text;$('radio-speaker').innerHTML=`${event.speaker}<span> / SECURE COMMS</span>`;}
    if(event.type==='playerHit'){shake=Math.min(2.3,shake+.7);damageFlash=Math.min(.8,damageFlash+.45);}
    if(event.type==='explosion'&&distance(game.p,event)<65)shake=Math.max(shake,event.size*.55);
    if(event.type==='objective')toast(['','01 COMPLETE · COASTAL RADAR OFFLINE','02 COMPLETE · ENGINEERS ABOARD','03 COMPLETE · LAUNCH PREVENTED'][event.stage],4);
    if(event.type==='end')endMission(event.success);
    if(event.type==='empty')toast(`${WEAPONS[event.weapon].short} EMPTY · REARM AT A GREEN PAD`,2);
    if(event.type==='capture')toast('PRISONER ABOARD',3);
    if(event.type==='delivered')toast(`${event.cargo} HANDED OVER · ARMOR PATCHED`,3);
    if(event.type==='recon')toast('SCAN COMPLETE',3);
    if(event.type==='arrived')toast('CONVOY IS CLEAR',3);
    if(event.type==='escaped')toast('TARGET SLIPPED THE NET',3);
    if(event.type==='shield'&&toastTime<=0)toast('SHIELD ACTIVE · DESTROY BOTH POWER NODES',3);
  }
  game.events.length=0;
}
function readInput() {
  const dx=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+joy.x;
  const dy=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0)+joy.y;
  input.x=dx*screenRight.x-dy*screenUp.x;input.z=dx*screenRight.z-dy*screenUp.z;
  input.fire=keys.has('Space')||mouseFire||touchFire||fireQueued;fireQueued=false;
  input.interact=keys.has('KeyE')||touchInteract;input.flare=keys.has('KeyC')||touchFlare||flareQueued;flareQueued=false;
  input.turn=(keys.has('KeyR')?1:0)-(keys.has('KeyQ')?1:0);input.strafe=keys.has('ShiftLeft')||keys.has('ShiftRight');
  input.aim=mouseAim&&performance.now()-lastMouse<2500?mouseAim:null;
  input.altitude=world.flightHeight(game.p.x+game.p.vx*.3,game.p.z+game.p.vz*.3);
}
function refreshHud() {
  const p=game.p,obj=objective(game);
  $('mission-index').textContent=`${obj.index} / ${String(obj.total).padStart(2,'0')}`;$('mission-title').textContent=obj.label;$('mission-detail').textContent=obj.detail;
  document.querySelectorAll('.mission-steps i').forEach((el,i)=>el.className=i<game.stage?'done':i===game.stage?'active':'');
  $('flight-time').textContent=formatTime(game.time);
  const clock=objective(game).timed&&game.objectiveTimer>0;
  $('countdown').hidden=!clock;if(clock)$('countdown').querySelector('b').textContent=formatTime(game.objectiveTimer);
  $('armor-value').textContent=Math.ceil(p.armor);$('fuel-value').textContent=Math.ceil(p.fuel);
  $('armor-bar').style.width=p.armor+'%';$('fuel-bar').style.width=p.fuel+'%';$('armor-bar').style.background=p.armor<30?'var(--red)':'var(--green)';
  $('fuel-bar').style.background=p.fuel<25?'var(--red)':'var(--amber)';
  $('cargo-count').textContent=`♙ ${p.cargo}/4`;$('speed-value').textContent=Math.round(Math.hypot(p.vx,p.vz)*3.5);$('altitude-value').textContent=Math.round(p.y);
  $('flare-status').textContent=p.flareCooldown>0?`FLARES ${Math.ceil(p.flareCooldown)}S`:'FLARES READY';
  $('touch-flare').querySelector('small').textContent=p.flareCooldown>0?`${Math.ceil(p.flareCooldown)}S`:'FLARES';
  for(let i=0;i<3;i++){$('ammo-'+i).textContent=Math.floor(p.ammo[i]);document.querySelector(`[data-weapon="${i}"]`).classList.toggle('selected',p.weapon===i);}
  const heading=((p.yaw*180/Math.PI)%360+360)%360;$('heading').textContent=Math.round(heading).toString().padStart(3,'0');
  $('cardinal').textContent=['N','NE','E','SE','S','SW','W','NW'][Math.round(heading/45)%8];
  const context=contextAction(game);$('context').hidden=!context;
  $('radio').classList.toggle('visible',game.messageTime>0&&game.phase==='playing'&&!context);
  if(context) {
    $('context-label').textContent=context.label;
    const hints={rescue:'Hold E / WINCH to lift the crew',capture:'Hold E / WINCH to take them aboard',
      recon:'Hold E / WINCH to keep the scanner on target',deliver:'Hold E / WINCH to set down and hand over',
      extract:'Hold E / WINCH to land and extract',service:'Hold E / WINCH to repair and replenish'};
    const hint=context.enabled?(hints[context.kind]??hints.service):(Math.hypot(p.vx,p.vz)>=5?'Release flight control to hold a steady hover':'Eliminate the compound defenders');
    $('context-hint').textContent=isTouch?hint.replace('E / ',''):hint.replace(' / WINCH','');
    $('context-progress').style.width=clamp(context.progress,0,1)*100+'%';
    $('touch-interact').querySelector('small').textContent=({rescue:'WINCH',capture:'WINCH',recon:'SCAN',deliver:'LAND',extract:'LAND'})[context.kind]??'SUPPLY';
  } else $('touch-interact').querySelector('small').textContent='WINCH';
  const incoming=game.projectiles.some(b=>b.enemy&&b.homing&&b.life>0&&distance(b,p)<50);$('incoming').hidden=!incoming;
  const cell=game.limit/2;
  $('map-sector').textContent=`SECTOR ${String.fromCharCode(65+clamp(Math.floor((p.x+game.limit)/cell),0,3))}${clamp(Math.floor((p.z+game.limit)/cell)+1,1,4)}`;
  drawMap($('minimap'),false);
}
function projectWorld(x,y,z) {
  projected.set(x,y,z).project(camera);
  return {x:(projected.x*.5+.5)*width,y:(-.5*projected.y+.5)*height,visible:projected.z<1&&Math.abs(projected.x)<1&&Math.abs(projected.y)<1};
}
function updateMarkers() {
  const obj=objective(game),point=projectWorld(obj.x,14,obj.z);
  const bottom=isTouch?height>width?340:200:210;
  const x=clamp(point.x,85,width-85),y=clamp(point.y,195,Math.max(215,height-bottom));
  const pin=$('objective-pin');pin.style.left=x+'px';pin.style.top=y+'px';
  $('pin-name').textContent=obj.short;$('pin-distance').textContent=`${Math.round(distance(game.p,obj)*5)} M`;
  pin.querySelector('.pin-diamond').textContent=point.x<50?'‹':point.x>width-50?'›':point.y<100?'⌃':point.y>height-120?'⌄':'◇';
  const target=game.enemies.find(e=>e.id===game.target&&!e.dead),lock=$('target-lock');
  lock.hidden=!target;
  if(target){const pos=projectWorld(target.x,target.y+2,target.z);lock.hidden=!pos.visible;lock.style.left=pos.x+'px';lock.style.top=pos.y+'px';
    $('target-name').textContent=target.type==='command'&&game.enemies.some(e=>e.generator&&!e.dead)?'SHIELDED':target.type==='crate'?'VOLATILE':target.type.toUpperCase();$('target-hp').style.width=target.hp/target.maxHp*100+'%';}
}

function drawMap(canvas,large) {
  const ctx=canvas.getContext('2d'),s=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,s,h);ctx.fillStyle='#1d3832';ctx.fillRect(0,0,s,h);
  const scale=(large?s-50:s-26)/(game.limit*2.1),ox=s/2,oz=h/2;
  const map=(x,z)=>[ox+x*scale,oz+z*scale];
  ctx.strokeStyle='#728b6c24';ctx.lineWidth=1;
  const grid=game.limit/4;
  for(let i=-game.limit;i<=game.limit;i+=grid){const [x,z]=map(i,i);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.moveTo(0,z);ctx.lineTo(s,z);ctx.stroke();}
  for(const poly of game.level.islands) {
    ctx.beginPath();poly.forEach(([x,z],i)=>{const p=map(x,z);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();ctx.fillStyle='#526d4f';ctx.fill();ctx.strokeStyle='#819873';ctx.lineWidth=large?2:1.3;ctx.stroke();
  }
  ctx.strokeStyle='#bbc19c6b';ctx.lineWidth=large?4:2;
  for(const [ax,az,bx,bz] of game.level.spans ?? []){ctx.beginPath();ctx.moveTo(...map(ax,az));ctx.lineTo(...map(bx,bz));ctx.stroke();}
  // Mission route is intentionally faint, so threats remain readable.
  if(large&&game.level.route) {ctx.setLineDash([7,8]);ctx.lineWidth=2;ctx.strokeStyle='#f3b25e38';ctx.beginPath();game.level.route.forEach((p,i)=>i?ctx.lineTo(...map(p.x,p.z)):ctx.moveTo(...map(p.x,p.z)));ctx.stroke();ctx.setLineDash([]);}
  for(const e of game.enemies) {
    if(e.type==='crate')continue;
    const [x,z]=map(e.x,e.z);ctx.fillStyle=e.dead?'#80947b80':e.generator?'#83cebb':'#e28b69';
    if(e.dead){ctx.fillRect(x-1,z-1,2,2);continue;}
    const r=large?(e.type==='command'?8:5):e.type==='command'?5:3;
    ctx.beginPath();ctx.moveTo(x,z-r);ctx.lineTo(x+r,z);ctx.lineTo(x,z+r);ctx.lineTo(x-r,z);ctx.closePath();ctx.fill();
  }
  for(const p of [game.base,...game.depots]) {
    const [x,z]=map(p.x,p.z),r=large?7:4;ctx.strokeStyle='#bddfa8';ctx.lineWidth=large?3:2;
    ctx.beginPath();ctx.moveTo(x-r,z);ctx.lineTo(x+r,z);ctx.moveTo(x,z-r);ctx.lineTo(x,z+r);ctx.stroke();
    ctx.strokeStyle='#bddfa859';ctx.strokeRect(x-r-4,z-r-4,(r+4)*2,(r+4)*2);
  }
  for(const f of game.friendlies) {
    if(f.dead)continue;
    const [x,z]=map(f.x,f.z),r=large?6:4;
    ctx.fillStyle=f.arrived?'#bddfa8':'#9fe0c8';
    ctx.beginPath();ctx.moveTo(x,z-r);ctx.lineTo(x+r,z+r);ctx.lineTo(x-r,z+r);ctx.closePath();ctx.fill();
  }
  const obj=objective(game),[tx,tz]=map(obj.x,obj.z),r=large?15:8;
  ctx.strokeStyle='#ffd78b';ctx.lineWidth=large?2.5:1.5;ctx.beginPath();ctx.arc(tx,tz,r,0,Math.PI*2);ctx.stroke();
  const [px,pz]=map(game.p.x,game.p.z);ctx.save();ctx.translate(px,pz);ctx.rotate(game.p.yaw);
  ctx.fillStyle='#f4edc9';ctx.beginPath();const n=large?12:7;ctx.moveTo(0,-n);ctx.lineTo(n*.65,n*.7);ctx.lineTo(0,n*.28);ctx.lineTo(-n*.65,n*.7);ctx.closePath();ctx.fill();ctx.restore();
  if(large) {
    ctx.font='600 15px "Barlow",sans-serif';ctx.textBaseline='bottom';ctx.fillStyle='#d1dcc0';
    for(const [x,z,text] of game.level.labels ?? []) {
      const [lx,lz]=map(x,z);ctx.fillText(text,lx-text.length*4.4,lz);
    }
    ctx.font='12px "Barlow",sans-serif';ctx.fillStyle='#a3b79a';
    for(let i=0;i<4;i++){const c=-game.limit*.75+i*game.limit/2;ctx.fillText(String.fromCharCode(65+i),map(c,0)[0],18);ctx.fillText(String(i+1),9,map(0,c)[1]);}
  }
}

function frame(now) {
  requestAnimationFrame(frame);if(webglLost)return;
  const raw=lastTime?(now-lastTime)/1000:1/60;lastTime=now;const dt=Math.min(raw,.05);
  frameAverage=frameAverage*.97+Math.min(raw*1000,200)*.03;actualFps=1000/frameAverage;
  if(resizePending)resize();
  const active=game.phase==='playing',animate=active||game.phase==='briefing'||game.phase==='failed'||game.phase==='won';
  if(animate)clockTime+=dt;
  if(active){readInput();update(game,input,dt);handleEvents();}
  if(animate){world.update(game,dt,clockTime,objective(game),active&&input.interact);updateCamera(dt);}
  shake*=Math.exp(-8*dt);damageFlash*=Math.exp(-5*dt);$('damage-flash').style.opacity=damageFlash;
  if(toastTime>0){toastTime-=dt;if(toastTime<=0)$('toast').textContent='';}
  audio.update(Math.hypot(game.p.vx,game.p.vz),game.phase);
  if(active){updateMarkers();uiTick+=dt;if(uiTick>.09){refreshHud();uiTick=0;}}
  film.uniforms.uTime.value=clockTime;renderer.info.reset();composer.render();
  if(graphics==='auto'&&active&&!autoDownshifted){performanceTime+=dt;if(performanceTime>10&&actualFps<38&&resolvedQuality!=='mobile'){autoDownshifted=true;setQuality('mobile');graphics='auto';save.set('quality','auto');$('quality').value='auto';}}
}

// Keyboard, mouse, and independent pointer captures for true two-thumb play.
document.addEventListener('keydown',e=>{
  if(['INPUT','SELECT'].includes(e.target.tagName))return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.code)&&e.code!=='Tab')e.preventDefault();
  if(e.repeat){if(game.phase==='playing')keys.add(e.code);return;}
  if(e.code==='Escape') {
    if(!$('manual').hidden)closeManual();else if(game.phase==='map')closeMap();else if(game.phase==='playing'||game.phase==='paused')pause();return;
  }
  if(e.code==='KeyH'){if($('manual').hidden)openManual();else closeManual();return;}
  if(e.code==='KeyV'){toggleAudio();return;}
  if(game.phase!=='playing'&&game.phase!=='map')return;
  if(e.code==='KeyM'){openMap();return;}
  if(e.code==='KeyP'){pause();return;}
  if(game.phase==='playing'){keys.add(e.code);if(e.code==='KeyC')flareQueued=true;if(e.code==='Space')fireQueued=true;if(['Digit1','Digit2','Digit3'].includes(e.code))switchWeapon(Number(e.code.slice(-1))-1);}
});
document.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{if(game.phase==='playing')pause();clearInput();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&game.phase==='playing')pause();lastTime=0;});
window.addEventListener('resize',()=>resizePending=true);
$('scene').addEventListener('contextmenu',e=>e.preventDefault());
$('scene').addEventListener('pointermove',e=>{
  if(e.pointerType==='touch'||!camera||game.phase!=='playing')return;
  raycaster.setFromCamera(new THREE.Vector2(e.clientX/width*2-1,-e.clientY/height*2+1),camera);
  if(raycaster.ray.intersectPlane(ground,tempVec)){mouseAim={x:tempVec.x,z:tempVec.z};lastMouse=performance.now();}
});
$('scene').addEventListener('pointerdown',e=>{if(game.phase==='playing'&&e.button===0&&e.pointerType!=='touch'){mouseFire=true;fireQueued=true;$('scene').setPointerCapture(e.pointerId);}});
$('scene').addEventListener('pointerup',()=>mouseFire=false);$('scene').addEventListener('pointercancel',()=>mouseFire=false);
window.addEventListener('pointerup',()=>mouseFire=false);
$('scene').addEventListener('wheel',e=>{if(game.phase==='playing'){e.preventDefault();switchWeapon((game.p.weapon+(e.deltaY>0?1:2))%3);}},{passive:false});
function switchWeapon(i) {game.p.weapon=i;audio.tone(400+i*160,.06,.06,'triangle');refreshHud();}
document.querySelectorAll('[data-weapon]').forEach(el=>el.addEventListener('click',()=>{if(game.phase==='playing')switchWeapon(Number(el.dataset.weapon));}));
const joystick=$('joystick');
function moveJoystick(e) {
  const rect=joystick.getBoundingClientRect(),dx=e.clientX-(rect.left+rect.width/2),dy=e.clientY-(rect.top+rect.height/2);
  const max=rect.width*.33,len=Math.hypot(dx,dy),scale=len>max?max/len:1;
  joy.x=Math.abs(dx)<4?0:dx*scale/max;joy.y=Math.abs(dy)<4?0:dy*scale/max;$('stick').style.transform=`translate(${dx*scale}px,${dy*scale}px)`;
}
joystick.addEventListener('pointerdown',e=>{if(game.phase!=='playing')return;e.preventDefault();joy.id=e.pointerId;joystick.setPointerCapture(e.pointerId);moveJoystick(e);});
joystick.addEventListener('pointermove',e=>{if(e.pointerId===joy.id)moveJoystick(e);});
function releaseJoystick(e){if(e.pointerId===joy.id){joy={x:0,y:0,id:null};$('stick').style.transform='';}}
joystick.addEventListener('pointerup',releaseJoystick);joystick.addEventListener('pointercancel',releaseJoystick);joystick.addEventListener('lostpointercapture',releaseJoystick);
function touchButton(id,set) {
  const button=$(id);let pointer=null;
  button.addEventListener('pointerdown',e=>{if(game.phase!=='playing')return;e.preventDefault();pointer=e.pointerId;button.setPointerCapture(e.pointerId);set(true);button.classList.add('pressed');});
  const release=e=>{if(e.pointerId===pointer){pointer=null;set(false);button.classList.remove('pressed');}};
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
}
touchButton('touch-fire',v=>{touchFire=v;if(v)fireQueued=true;});touchButton('touch-interact',v=>touchInteract=v);touchButton('touch-flare',v=>{touchFlare=v;if(v)flareQueued=true;});
$('deploy-button').addEventListener('click',deploy);$('replay-button').addEventListener('click',deploy);$('restart-button').addEventListener('click',deploy);
$('resume-button').addEventListener('click',resume);$('pause-button').addEventListener('click',pause);$('menu-button').addEventListener('click',returnToBriefing);
$('help-button').addEventListener('click',openManual);$('pause-help').addEventListener('click',openManual);$('close-manual').addEventListener('click',closeManual);$('manual-ready').addEventListener('click',closeManual);
$('minimap-button').addEventListener('click',openMap);$('close-map').addEventListener('click',closeMap);$('map-resume').addEventListener('click',closeMap);
$('brand-home').addEventListener('click',e=>{e.preventDefault();if(game.phase==='playing')pause();});
$('quality').addEventListener('change',()=>{setQuality($('quality').value);autoDownshifted=false;performanceTime=0;});
$('operation').addEventListener('change',()=>loadOperation(Number($('operation').value)));
$('next-button').addEventListener('click',()=>{loadOperation(operation+1);$('debrief').hidden=true;$('briefing').hidden=false;setPhase('briefing');$('deploy-button').focus();});
function toggleAudio(){audio.setEnabled(!audio.enabled);save.set('audio',audio.enabled);$('audio-label').textContent=audio.enabled?'SOUND ON':'SOUND OFF';$('audio-button').setAttribute('aria-label',audio.enabled?'Mute sound':'Enable sound');}
$('audio-button').addEventListener('click',toggleAudio);$('volume').addEventListener('input',()=>{audio.setVolume(Number($('volume').value)/100);save.set('volume',audio.volume);});
$('fullscreen-button').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();if(isTouch&&document.fullscreenElement)await screen.orientation?.lock?.('landscape').catch(()=>{});}catch{toast('FULLSCREEN IS NOT AVAILABLE IN THIS BROWSER');}
});
document.addEventListener('fullscreenchange',()=>{$('fullscreen-button').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen');resizePending=true;});
$('reload-button').addEventListener('click',()=>location.reload());
$('scene').addEventListener('webglcontextlost',e=>{e.preventDefault();webglLost=true;if(game.phase==='playing')pause();showFatal('The graphics context was lost. Close other GPU-heavy tabs and reload to restart the operation.');});
$('scene').addEventListener('webglcontextrestored',()=>location.reload());

// Read-only diagnostics are also useful when a player reports a hardware-specific issue.
window.blockhawk={getState:()=>JSON.parse(JSON.stringify({phase:game.phase,stage:game.stage,time:game.time,score:game.score,rescued:game.rescued,delivered:game.delivered,p:game.p,enemies:game.enemies,projectiles:game.projectiles,objectiveTimer:game.objectiveTimer,target:game.target,objective:objective(game),context:contextAction(game),level:game.level.id,levelIndex:game.levelIndex,operations:LEVELS.length,unlocked:campaign.unlocked,friendlies:game.friendlies,captured:game.captured})),getPerformance:()=>({fps:Math.round(actualFps),quality:resolvedQuality,pixelRatio:renderer?.getPixelRatio(),drawCalls:renderer?.info.render.calls,triangles:renderer?.info.render.triangles,ready:initialReady,touch:isTouch}),getAudio:()=>({state:audio.ctx?.state??'not-started',enabled:audio.enabled,volume:audio.volume})};
// Explicitly gated testing support. Production play never reads or enables this automatically.
if(new URLSearchParams(location.search).has('test')) {
  window.blockhawk.test={
    step:(controls,seconds)=>{let remaining=seconds;while(remaining>0&&game.phase==='playing'){const dt=Math.min(1/60,remaining);update(game,controls,dt);remaining-=dt;}handleEvents();refreshHud();world.update(game,0,clockTime,objective(game),false);},
    position:(x,z)=>{game.p.x=x;game.p.z=z;game.p.vx=0;game.p.vz=0;updateCamera(0,true);},
    setPlayer:values=>Object.assign(game.p,values),
    visuals:()=>({winch:world.winch.visible,people:world.people.map(p=>({visible:p.visible,y:p.position.y}))}),
  };
}
try{initGraphics();}catch(error){console.error(error);showFatal(`Flight systems could not start: ${error.message}. This game needs WebGL 2 and hardware acceleration.`);}
