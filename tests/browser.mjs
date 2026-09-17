import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const evidence={checks:[],errors:[],network:[],desktop:{},mobile:{}};
const record=name=>{evidence.checks.push(name);console.log('PASS '+name);};
const base='http://127.0.0.1:4189';
function listen(page){page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')evidence.errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('file:')&&!r.url().startsWith('data:'))evidence.network.push(r.url());});}
const state=page=>page.evaluate(()=>window.blockhawk.getState());
try {
  const desktop=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const page=await desktop.newPage();listen(page);
  await page.goto(base+'/?test');await page.waitForFunction(()=>window.blockhawk?.getPerformance().ready);
  assert.equal(await page.title(),'BLOCKHAWK · Signal Storm');assert.equal((await state(page)).phase,'briefing');
  await page.screenshot({path:'artifacts/desktop-briefing.png'});record('Desktop loads the embedded 3D scene and briefing');
  await page.getByRole('button',{name:'Field manual',exact:true}).click();assert.equal(await page.locator('#manual').isVisible(),true);
  await page.getByRole('button',{name:'READY, HAWK'}).click();assert.equal((await state(page)).phase,'briefing');record('Field manual opens and returns to briefing');
  await page.locator('#deploy-button').click();const initial=await state(page);
  await page.waitForFunction(()=>window.blockhawk.getAudio().state==='running');
  await page.locator('#audio-button').click();assert.equal(await page.evaluate(()=>window.blockhawk.getAudio().enabled),false);await page.locator('#audio-button').click();record('Synthesized audio starts from a user gesture and mute toggles correctly');
  await page.keyboard.down('w');await page.waitForTimeout(950);await page.keyboard.up('w');
  const moved=await state(page);assert.ok(Math.hypot(moved.p.x-initial.p.x,moved.p.z-initial.p.z)>9);record('Real keyboard input moves the aircraft in the rendered game');
  await page.keyboard.press('2');assert.equal((await state(page)).p.weapon,1);
  const ammo=(await state(page)).p.ammo[1];await page.keyboard.down('Space');await page.waitForTimeout(520);await page.keyboard.up('Space');assert.ok((await state(page)).p.ammo[1]<ammo);record('Weapon selection and held fire consume ammunition');
  await page.keyboard.press('Escape');const paused=await state(page);await page.waitForTimeout(300);assert.equal((await state(page)).time,paused.time);
  await page.locator('#quality').selectOption('mobile');await page.locator('#quality').selectOption('cinematic');await page.locator('#volume').fill('35');
  await page.locator('#resume-button').click();await page.keyboard.press('m');const mapped=await state(page);assert.equal(mapped.phase,'map');await page.waitForTimeout(200);assert.equal((await state(page)).time,mapped.time);
  await page.screenshot({path:'artifacts/tactical-map.png'});await page.locator('#map-resume').click();record('Pause, graphics, volume, tactical map and resume work');
  await page.keyboard.press('Escape');await page.locator('#restart-button').click();
  // Fly the complete mission through simulation controls. No teleportation, enemy
  // HP edits, invulnerability, ammo edits or stage changes are used in this run.
  const mission=await page.evaluate(()=>{
    const api=window.blockhawk,step=api.test.step;
    const get=()=>api.getState(),enemy=id=>get().enemies.find(e=>e.id===id);
    let frames=0;
    const result={route:[],minArmor:100};
    function advance(input,seconds=.12){step(input,seconds);const g=get();frames++;result.minArmor=Math.min(result.minArmor,g.p.armor);if(g.phase!=='playing'&&g.phase!=='won')throw new Error(`Flight failed at stage ${g.stage}: ${g.phase}, armor=${g.p.armor}`);if(frames>20000)throw new Error('Pilot controller exceeded mission budget');}
    function fly(x,z){
      for(let n=0;n<1600;n++){
        const g=get(),dx=x-g.p.x,dz=z-g.p.z,d=Math.hypot(dx,dz);if(d<1.6){advance({},.6);return;}
        const threats=g.enemies.filter(e=>!e.dead&&e.range>0&&e.type!=='command'&&Math.hypot(e.x-g.p.x,e.z-g.p.z)<48).sort((a,b)=>Math.hypot(a.x-g.p.x,a.z-g.p.z)-Math.hypot(b.x-g.p.x,b.z-g.p.z));
        const target=threats[0];api.test.setPlayer({weapon:0});
        const speed=Math.min(1,d/7);advance({x:dx/d*speed,z:dz/d*speed,fire:!!target,aim:target?{x:target.x,z:target.z}:null,flare:true});
      }throw new Error('Unable to reach waypoint');
    }
    function attack(id,weapon=1){
      let e=enemy(id);if(e.dead)return;fly(e.x,e.z+31);
      for(let n=0;n<800;n++){
        const g=get();e=enemy(id);if(e.dead){result.route.push(id);return;}
        const w=g.p.ammo[weapon]>=1?weapon:0;api.test.setPlayer({weapon:w});
        const side=Math.sin(n*.17)*.25;
        advance({x:side,z:0,fire:true,aim:{x:e.x,z:e.z},flare:true});
      }throw new Error('Unable to destroy '+id);
    }
    function service(){fly(-8,-26);advance({interact:true},4.5);}
    attack('coast-aa',0);attack('coast-sam',2);attack('road-tank',1);attack('coastal-radar',1);
    if(get().stage!==1)throw new Error('Radar objective did not progress');
    service();attack('camp-west',0);attack('camp-east',0);attack('camp-tank',1);
    fly(10,-51);advance({interact:true},.9);
    const rescueVisual=api.test.visuals();if(!rescueVisual.winch||rescueVisual.people[0].y<=3.2)throw new Error('Winch rope or engineer lift animation did not render');
    advance({interact:true},5.9);
    if(get().rescued!==4||get().stage!==2)throw new Error('Winch failed to collect all engineers');
    service();attack('bridge-tank',1);attack('citadel-sam',2);attack('citadel-aa',1);attack('generator-west',1);attack('generator-east',1);attack('storm-command',2);
    if(get().stage!==3)throw new Error('Storm objective did not progress');
    fly(-99,111);advance({interact:true},3.2);
    result.final=get();return result;
  });
  assert.equal(mission.final.phase,'won');assert.equal(mission.final.delivered,4);assert.ok(await page.locator('#debrief').isVisible());
  evidence.desktop.mission={time:mission.final.time,score:mission.final.score,minArmor:mission.minArmor,kills:mission.final.enemies.filter(e=>e.dead).length,route:mission.route};
  await page.screenshot({path:'artifacts/mission-complete.png'});record('Complete mission succeeds using flight, combat, resupply, winch and extraction controls');
  const persisted=await page.evaluate(()=>({best:JSON.parse(localStorage.getItem('blockhawk.best.pilot')),quality:JSON.parse(localStorage.getItem('blockhawk.quality')),volume:JSON.parse(localStorage.getItem('blockhawk.volume'))}));
  assert.equal(persisted.best,mission.final.score);assert.equal(persisted.quality,'cinematic');assert.equal(persisted.volume,.35);record('Best score and graphics/audio preferences persist in local storage');
  await page.locator('#replay-button').click();let fresh=await state(page);assert.equal(fresh.stage,0);assert.equal(fresh.rescued,0);assert.equal(fresh.score,0);assert.equal(fresh.p.armor,100);assert.ok(fresh.enemies.every(e=>!e.dead));record('Replay fully resets mission and enemies');
  await page.evaluate(()=>{window.blockhawk.test.setPlayer({fuel:.001});window.blockhawk.test.step({},.2);});assert.equal((await state(page)).phase,'failed');assert.ok(await page.locator('#debrief').isVisible());
  await page.locator('#menu-button').click();assert.equal((await state(page)).phase,'briefing');record('Fuel failure, debrief and return to briefing work');
  await page.locator('#deploy-button').click();await page.evaluate(()=>window.blockhawk.test.position(-72,60));await page.waitForTimeout(700);await page.screenshot({path:'artifacts/desktop-flight.png'});
  const targetBox=await page.locator('#target-lock').boundingBox();assert.ok(targetBox);
  await page.mouse.move(targetBox.x+targetBox.width/2,targetBox.y+targetBox.height/2);const beforeMouse=await state(page);
  await page.mouse.down();await page.waitForTimeout(360);await page.mouse.up();const afterMouse=await state(page);
  assert.ok(afterMouse.p.ammo[0]<beforeMouse.p.ammo[0]);assert.ok(afterMouse.enemies.some((e,i)=>e.hp<beforeMouse.enemies[i].hp));record('Real mouse aiming and firing hit a rendered enemy target');
  evidence.desktop.performance=await page.evaluate(()=>window.blockhawk.getPerformance());await page.keyboard.press('Escape');

  const mobile=await browser.newContext({viewport:{width:915,height:412},deviceScaleFactor:2.5,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16; SM-S942B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36'});
  const phone=await mobile.newPage();listen(phone);await phone.goto(base+'/?test');await phone.waitForFunction(()=>window.blockhawk?.getPerformance().ready);
  await phone.screenshot({path:'artifacts/mobile-landscape-briefing.png'});await phone.locator('#deploy-button').tap();
  assert.equal(await phone.locator('#touch-controls').isVisible(),true);
  const joystick=await phone.locator('#joystick').boundingBox(),fire=await phone.locator('#touch-fire').boundingBox();
  const cdp=await mobile.newCDPSession(phone);const before=await state(phone);
  const first={x:joystick.x+joystick.width*.72,y:joystick.y+joystick.height*.25,id:1},second={x:fire.x+fire.width/2,y:fire.y+fire.height/2,id:2};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first]});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first,second]});await phone.waitForTimeout(850);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const after=await state(phone);
  assert.ok(Math.hypot(after.p.x-before.p.x,after.p.z-before.p.z)>6);assert.ok(after.p.ammo[0]<before.p.ammo[0]);record('Android landscape: two simultaneous real touches fly and fire');
  await phone.locator('[data-weapon="2"]').tap();assert.equal((await state(phone)).p.weapon,2);await phone.locator('#touch-flare').tap();await phone.waitForFunction(()=>window.blockhawk.getState().p.flareCooldown>0);record('Touch weapon switching and countermeasures work');
  await phone.screenshot({path:'artifacts/mobile-landscape-flight.png'});evidence.mobile.landscape=await phone.evaluate(()=>window.blockhawk.getPerformance());
  await phone.evaluate(()=>{window.blockhawk.test.position(-99,111);window.blockhawk.test.setPlayer({armor:20,fuel:30,ammo:[0,0,0]});});
  const serviceButton=await phone.locator('#touch-interact').boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:serviceButton.x+serviceButton.width/2,y:serviceButton.y+serviceButton.height/2,id:3}]});
  await phone.waitForFunction(()=>window.blockhawk.getState().p.armor>35);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const serviced=await state(phone);assert.ok(serviced.p.fuel>45);assert.ok(serviced.p.ammo[0]>50);record('Holding the touch winch control lands, repairs, refuels and rearms');
  await phone.setViewportSize({width:412,height:915});await phone.waitForTimeout(450);await phone.screenshot({path:'artifacts/mobile-portrait-flight.png'});
  for(const id of ['joystick','touch-fire','touch-interact','touch-flare','minimap-button']){const b=await phone.locator('#'+id).boundingBox();assert.ok(b&&b.x>=0&&b.y>=0&&b.x+b.width<=413&&b.y+b.height<=916,id+' is off-screen');}
  const docSize=await phone.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,iw:innerWidth,ih:innerHeight}));assert.equal(docSize.w,docSize.iw);assert.equal(docSize.h,docSize.ih);record('Android portrait layout fits all controls without document overflow');
  await phone.locator('#minimap-button').tap();assert.equal((await state(phone)).phase,'map');await phone.locator('#map-resume').tap();assert.equal((await state(phone)).phase,'playing');record('Touch tactical map opens, pauses and resumes');
  await phone.setViewportSize({width:780,height:360});await phone.reload();await phone.waitForFunction(()=>window.blockhawk?.getPerformance().ready);await phone.screenshot({path:'artifacts/mobile-compact-briefing.png'});await phone.locator('#deploy-button').tap();assert.equal((await state(phone)).phase,'playing');record('Compact 780×360 landscape briefing remains tappable');

  const offline=await browser.newContext({viewport:{width:1280,height:800},offline:true});const local=await offline.newPage();listen(local);
  await local.goto(pathToFileURL(resolve('dist/blockhawk.html')).href);await local.waitForFunction(()=>window.blockhawk?.getPerformance().ready);await local.locator('#deploy-button').click();assert.equal((await state(local)).phase,'playing');
  assert.equal(await local.evaluate(()=>Object.hasOwn(window.blockhawk,'test')),false);record('Distributed single HTML runs offline from file:// without test controls');
  assert.deepEqual(evidence.network,[]);assert.deepEqual(evidence.errors,[]);record('No external asset requests, JavaScript errors or shader errors');
  await desktop.close();await mobile.close();await offline.close();
} finally {await writeFile('artifacts/verification.json',JSON.stringify(evidence,null,2));await browser.close();}
console.log(`${evidence.checks.length} browser checks passed.`);
