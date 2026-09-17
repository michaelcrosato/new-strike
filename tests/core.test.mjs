import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,startGame,update,fire,selectTarget,objective,contextAction,BASE,CAMP,DEPOT,WEAPONS,WORLD_LIMIT} from '../src/core.js';

const tick=(g,input={},seconds=1)=>{for(let i=0;i<seconds*60;i++)update(g,input,1/60);};
const started=(d='pilot')=>{const g=createGame(d);startGame(g);return g;};
function attack(g,id,weapon=1) {
  const e=g.enemies.find(e=>e.id===id);g.p.x=e.x;g.p.z=e.z+30;g.p.vx=0;g.p.vz=0;g.p.yaw=0;g.p.weapon=weapon;
  for(let i=0;i<1200&&!e.dead&&g.phase==='playing';i++)update(g,{fire:true,aim:{x:e.x,z:e.z},flare:true},1/60);
  return e;
}

test('briefing, pause and map never consume fuel, launch time or ammunition',()=>{
  for(const phase of ['briefing','paused','map','failed','won']){const g=createGame();g.phase=phase;const before=JSON.stringify(g);tick(g,{fire:true,x:1},3);assert.equal(JSON.stringify(g),before);}
});
test('flight has acceleration, diagonal normalization, damping and hard world bounds',()=>{
  const straight=started(),diagonal=started();tick(straight,{x:1},1);tick(diagonal,{x:1,z:1},1);
  assert.ok(Math.hypot(diagonal.p.vx,diagonal.p.vz)<23.01);assert.ok(Math.abs(Math.hypot(diagonal.p.vx,diagonal.p.vz)-straight.p.vx)<.001);
  tick(straight,{},2);assert.ok(Math.abs(straight.p.vx)<.02);tick(straight,{x:1,z:1},30);assert.equal(straight.p.x,WORLD_LIMIT);assert.equal(straight.p.z,WORLD_LIMIT);
});
test('terrain following gains safe altitude without changing the flight heading',()=>{
  const g=started(),yaw=g.p.yaw;tick(g,{altitude:23},2);assert.ok(g.p.y>22.9);assert.equal(g.p.yaw,yaw);
});
test('all weapons use ammunition and cooldown; a fractional rearm cannot fire a partial round',()=>{
  for(let i=0;i<3;i++){const g=started();g.p.weapon=i;assert.equal(fire(g,null),true);assert.equal(g.p.ammo[i],WEAPONS[i].max-1);assert.equal(fire(g,null),false);g.p.cooldown=0;g.p.ammo[i]=.2;assert.equal(fire(g,null),false);}
});
test('cannon uses swept collision and seekers home on moving patrols',()=>{
  const g=started('recon');const radar=attack(g,'coastal-radar',0);assert.ok(radar.dead);assert.equal(g.stage,1);assert.ok(g.hits>0);
  const h=started('recon');const tank=attack(h,'road-tank',2);assert.ok(tank.dead);assert.ok(h.p.ammo[2]<10);
});
test('shielded battery cannot be damaged while either power node is live',()=>{
  const g=started('recon');g.stage=2;g.p.x=99;g.p.z=-49;g.p.weapon=2;
  const command=g.enemies.find(e=>e.id==='storm-command');const health=command.hp;
  tick(g,{fire:true,aim:{x:99,z:-79},flare:true},1.2);assert.equal(command.hp,health);assert.ok(g.events.some(e=>e.type==='shield'));
});
test('guards and movement gate rescues; winch progress does not survive leaving the zone',()=>{
  const g=started();g.stage=1;Object.assign(g.p,{x:CAMP.x,z:CAMP.z});tick(g,{interact:true},2);assert.equal(g.rescued,0);assert.equal(contextAction(g).enabled,false);
  g.enemies.filter(e=>e.guard).forEach(e=>e.dead=true);tick(g,{interact:true},.7);assert.ok(g.rescue>0);g.p.x+=30;tick(g,{interact:true},.1);assert.equal(g.rescue,0);
  Object.assign(g.p,{x:CAMP.x,z:CAMP.z,vx:0,vz:0});tick(g,{interact:true},6.6);assert.equal(g.rescued,4);assert.equal(g.p.cargo,4);assert.equal(g.stage,2);assert.equal(objective(g).index,'03');
});
test('carrier and field pad repair, refuel and rearm without exceeding capacity',()=>{
  for(const pad of [BASE,DEPOT]){const g=started();Object.assign(g.p,{x:pad.x,z:pad.z,armor:12,fuel:5,ammo:[0,0,0]});tick(g,{interact:true},5);assert.equal(g.p.armor,100);assert.equal(g.p.fuel,100);assert.deepEqual(g.p.ammo,WEAPONS.map(w=>w.max));assert.equal(g.supplyVisits,1);}
});
test('countermeasures only remove nearby homing threats, and have a cooldown',()=>{
  const g=started();g.projectiles=[{id:1,x:BASE.x+10,z:BASE.z,y:9,life:4,enemy:true,homing:true,vx:0,vz:0,vy:0,travelled:0},{id:2,x:BASE.x+10,z:BASE.z+5,y:9,life:4,enemy:true,homing:false,vx:0,vz:0,vy:0,travelled:0}];
  tick(g,{flare:true},.1);assert.equal(g.flares,1);assert.ok(!g.projectiles.some(p=>p.id===1));assert.ok(g.projectiles.some(p=>p.id===2));tick(g,{flare:true},1);assert.equal(g.flares,1);
});
test('fuel exhaustion, enemy damage, and missile launch all produce real failure states',()=>{
  const fuel=started();fuel.p.fuel=.001;tick(fuel,{},1);assert.equal(fuel.phase,'failed');assert.equal(fuel.endTitle,'FUEL EXHAUSTED');
  const timeout=started();timeout.stage=2;timeout.objectiveTimer=.01;tick(timeout,{},1);assert.equal(timeout.phase,'failed');assert.equal(timeout.endTitle,'LAUNCH NOT PREVENTED');
  const damage=started();damage.p.invulnerable=0;damage.p.armor=1;damage.projectiles.push({id:1,x:BASE.x,z:BASE.z,y:8,life:2,enemy:true,damage:20,vx:0,vz:0,vy:0,travelled:0});tick(damage,{},.1);assert.equal(damage.phase,'failed');assert.equal(damage.endTitle,'AIRCRAFT LOST');
});
test('full operation is winnable with normal weapons, rescues, supplies and extraction',()=>{
  const g=started('recon');
  for(const id of ['coast-aa','coast-sam','road-tank','coastal-radar'])assert.ok(attack(g,id,1).dead,id);
  assert.equal(g.stage,1);
  Object.assign(g.p,{x:DEPOT.x,z:DEPOT.z,vx:0,vz:0});tick(g,{interact:true},5);
  for(const id of ['camp-west','camp-east','camp-tank'])assert.ok(attack(g,id,1).dead,id);
  Object.assign(g.p,{x:CAMP.x,z:CAMP.z,vx:0,vz:0});tick(g,{interact:true},6.6);assert.equal(g.stage,2);
  Object.assign(g.p,{x:DEPOT.x,z:DEPOT.z,vx:0,vz:0});tick(g,{interact:true},5);
  for(const id of ['citadel-sam','citadel-aa','generator-west','generator-east'])assert.ok(attack(g,id,2).dead,id);
  assert.ok(attack(g,'storm-command',2).dead);assert.equal(g.stage,3);
  Object.assign(g.p,{x:BASE.x,z:BASE.z,vx:0,vz:0});tick(g,{interact:true},3.1);
  assert.equal(g.phase,'won');assert.equal(g.delivered,4);assert.equal(g.p.cargo,0);assert.ok(g.score>6000);
});
