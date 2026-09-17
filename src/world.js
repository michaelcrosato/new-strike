import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BASE, DEPOT, CAMP, randomGenerator, distance } from './core.js';

export const ISLANDS = [
  [[-127, 65], [-124, 35], [-108, 7], [-94, -7], [-62, -26], [-32, -19], [-12, 4], [-14, 34], [-26, 65], [-55, 82], [-88, 89], [-115, 80]],
  [[-30, -27], [-37, -49], [-19, -79], [4, -91], [28, -99], [48, -86], [63, -72], [61, -37], [48, -15], [18, -7], [-5, -17]],
  [[62, -107], [86, -123], [116, -120], [139, -103], [145, -75], [131, -44], [109, -27], [84, -33], [70, -52], [64, -79]],
  [[25, 28], [42, 9], [69, 3], [102, 10], [119, 33], [128, 58], [113, 77], [88, 85], [60, 71], [38, 62]],
  [[-121, -81], [-112, -102], [-95, -108], [-79, -96], [-83, -73], [-106, -67]],
  [[-18, 106], [-7, 96], [11, 100], [21, 119], [8, 133], [-12, 127]],
];
export function inPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const PI = Math.PI;
const rand = randomGenerator(818);
const palettes = {
  grass: 0x557749, grass2: 0x74934f, grass3: 0x64844d, grassDark: 0x405d3f,
  sand: 0xc2b689, cliff: 0x827d5c, deepCliff: 0x576658,
  dark: 0x243e3c, concrete: 0x8b9c8c, roof: 0x647f76, roofLight: 0x93a89a,
  rust: 0xbd6039, orange: 0xf59338, cream: 0xdfd9bb, asphalt: 0x485954,
  trunk: 0x655b3a, palm: 0x3c694b, palmLight: 0x598257, palmTop: 0x749455,
  steel: 0x71847e, black: 0x20322f, glass: 0x173b4a, red: 0xa84e3b,
  airframe: 0x34564b, airframeLight: 0x527566,
};

export class World {
  constructor(scene, game) {
    this.scene = scene; this.dynamic = new THREE.Group(); this.static = new THREE.Group();
    scene.add(this.static, this.dynamic);
    this.materials = {}; this.geometries = {}; this.enemies = new Map(); this.rotating = [];
    this.particles = []; this.trails = []; this.smoking = []; this.rings = []; this.birds = []; this.obstacles = [];
    for (const [name, color] of Object.entries(palettes)) this.materials[name] = new THREE.MeshStandardMaterial({ color, roughness: name === 'glass' ? .18 : .83, metalness: name === 'glass' ? .6 : name === 'steel' ? .42 : .03, flatShading: true });
    for (const name of ['palm', 'palmLight', 'palmTop']) {
      const frond = this.materials[name].clone(); frond.side = THREE.DoubleSide; this.materials[name + 'Frond'] = frond;
    }
    this.mergedMaterials = new Map();
    this.materials.glow = new THREE.MeshStandardMaterial({ color: 0xffb84b, emissive: 0xff9600, emissiveIntensity: 2.3 });
    this.materials.cyan = new THREE.MeshStandardMaterial({ color: 0x81edd0, emissive: 0x32cbaa, emissiveIntensity: 1.1 });
    this.materials.enemyGlow = new THREE.MeshStandardMaterial({ color: 0xff8156, emissive: 0xff3105, emissiveIntensity: 1.9 });
    this.makeTerrain(); this.makeStructures(); this.scatterNature(); this.makeCarrier();
    this.makePad(DEPOT.x, DEPOT.z, 7.6, 'F', false);
    this.makeRescue(); this.mergeStatic();
    this.heli = this.makeHelicopter(); this.dynamic.add(this.heli);
    this.makeEnemies(game); this.mergeModels(); this.makeMarkers(); this.makeParticles(); this.makeBirds();
    this.reset(game);
  }
  mat(m) { return typeof m === 'string' ? this.materials[m] : m; }
  mesh(geometry, material, x = 0, y = 0, z = 0, parent = this.static) {
    const m = new THREE.Mesh(geometry, this.mat(material)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  box(x, y, z, w, h, d, material, parent = this.static) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent);
  }
  cylinder(x, y, z, rt, rb, h, material, segments = 8, parent = this.static) {
    return this.mesh(new THREE.CylinderGeometry(rt, rb, h, segments), material, x, y, z, parent);
  }
  rod(a, b, radius, material, parent = this.static) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b);
    const mesh = this.mesh(new THREE.CylinderGeometry(radius, radius, av.distanceTo(bv), 5), material, 0, 0, 0, parent);
    mesh.position.copy(av).add(bv).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bv.sub(av).normalize()); return mesh;
  }
  slab(poly, base, height, material, scale = 1) {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(cx + (x - cx) * scale, -(cz + (z - cz) * scale))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
    geo.rotateX(-PI / 2); geo.translate(0, base, 0);
    return this.mesh(geo, material);
  }
  makeTerrain() {
    // Physical water with world-space moving micro-normal waves and glancing highlights.
    this.waterMaterial = new THREE.MeshStandardMaterial({ color: 0x126c70, roughness: .24, metalness: .33 });
    this.waterTime = { value: 0 };
    this.waterMaterial.onBeforeCompile = shader => {
      shader.uniforms.uTime = this.waterTime;
      shader.vertexShader = 'varying vec3 vWaterWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed,1.)).xyz;');
      shader.fragmentShader = 'uniform float uTime; varying vec3 vWaterWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 q = vWaterWorld.xz;
        float ripple = sin(q.x * .8 + q.y * .4 + uTime * 1.25) * .026 + sin(q.y * 1.9 - q.x * .22 + uTime * 1.6) * .012;
        normal = normalize(normal + vec3(ripple, ripple * .3, ripple * .75));`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float swell = sin(vWaterWorld.x*.036+vWaterWorld.z*.052+uTime*.22)*.06;
        float lines = pow(max(0.,sin(vWaterWorld.x*.15+vWaterWorld.z*1.1+uTime*.8)),28.)*.06;
        diffuseColor.rgb *= 1.0 + swell + lines;`);
    };
    const water = this.mesh(new THREE.PlaneGeometry(1800, 1800), this.waterMaterial, 0, -.05, 0); water.rotation.x = -PI / 2; water.castShadow = false;
    this.water = water;
    const shallows = new THREE.MeshStandardMaterial({ color: 0x469387, roughness: .42, metalness: .18 });
    const foam = new THREE.MeshStandardMaterial({ color: 0x81aa98, roughness: .5 });
    for (let i = 0; i < ISLANDS.length; i++) {
      const poly = ISLANDS[i];
      this.slab(poly, -.1, .16, shallows, 1.11);
      this.slab(poly, .02, .18, foam, 1.035);
      this.slab(poly, .05, .73, 'sand', 1.0);
      this.slab(poly, .5, 1.2, 'deepCliff', .945);
      this.slab(poly, 1.25, 1.0, 'cliff', .923);
      this.slab(poly, 2.0, .65, 'grass', .90);
      // Large, subtle triangular meadow patches, not a noisy checkerboard.
      const cx = poly.reduce((s,p)=>s+p[0],0)/poly.length, cz = poly.reduce((s,p)=>s+p[1],0)/poly.length;
      for (let j = 0; j < poly.length; j++) {
        const a = poly[j], b = poly[(j+1)%poly.length];
        const tri = [[cx,cz],[cx+(a[0]-cx)*.885,cz+(a[1]-cz)*.885],[cx+(b[0]-cx)*.885,cz+(b[1]-cz)*.885]];
        this.slab(tri, 2.65, .025, j%3 === 0 ? 'grass2' : j%3 === 1 ? 'grass' : 'grass3');
      }
    }
    // Stepped jungle ridges at the backs of the operational islands.
    const ridges = [[-103, 3, 15, 16], [-102, -2, 8, 10], [-90, -10, 13, 10], [2, -86, 13, 9], [35, -83, 14, 10], [128, -102, 11, 9], [122, -111, 12, 8], [-97, -91, 13, 13], [56, 26, 13, 9], [103, 64, 12, 9]];
    for (const [x,z,r,h] of ridges) {
      this.obstacles.push({ x, z, w:r*2, d:r*2, top:2.5+h });
      for (let k = 0; k < 3; k++) {
        const rock = this.cylinder(x, 2.5 + h * .15 + k * h * .23, z, r * (1-k*.24), r*(1.08-k*.24), h*.34, k===2 ? 'grassDark' : 'cliff', 5);
        rock.rotation.y = (x+z)*.02;
      }
    }
    // Shallow rocks and sand bars make the delta read as terrain from above.
    for (let i = 0; i < 34; i++) {
      const x = -154 + rand()*308, z = -146 + rand()*286;
      if (ISLANDS.some(p=>inPolygon(x,z,p)) || distance({x,z},BASE)<24) continue;
      const r = 1.5 + rand()*2.5;
      this.cylinder(x, .1, z, r*.8, r, 1.2+rand()*1.8, 'cliff', 5);
    }
  }
  road(a, b, width = 7) {
    const dx = b[0]-a[0], dz = b[1]-a[1], len = Math.hypot(dx,dz);
    const road = this.box((a[0]+b[0])/2,2.72,(a[1]+b[1])/2,width,.09,len,'asphalt'); road.rotation.y=Math.atan2(dx,dz);
    for(let d=3; d<len-2; d+=6) {
      const x=a[0]+dx*d/len,z=a[1]+dz*d/len;
      const dash=this.box(x,2.785,z,.18,.025,2.7,'cream'); dash.rotation.y=road.rotation.y;
    }
  }
  building(x,z,w,d,h,material='concrete',roof='roof') {
    this.obstacles.push({ x,z,w,d,top:h+3.5 });
    this.box(x,2.8+h/2,z,w,h,d,material);
    this.box(x,2.9+h,z,w+.7,.5,d+.7,roof);
    this.box(x,3.0+h,z,w*.8,.4,d*.8,roof);
    const front=z+d/2+.035;
    for(let dx=-w/2+1.3;dx<w/2-.6;dx+=2.6) this.box(x+dx,4.0,z+d/2+.07,1.2,1.15,.10,'glass');
    this.box(x,3.6,front,.95,1.8,.12,'dark');
    if(w>7) { this.box(x+w*.22,3.6+h,z,2.1,1.1,2.8,'steel'); this.cylinder(x-w*.26,3.35+h,z,1,1,.35,'dark'); }
  }
  container(x,z,color='rust',turn=0) {
    const group = new THREE.Group(); group.position.set(x,2.7,z); group.rotation.y=turn; this.static.add(group);
    this.box(0,1.6,0,3.2,3.2,8,color,group);
    for(let i=-3.6;i<4;i+=.7) {
      this.box(-1.64,1.6,i,.10,3,.1,'steel',group); this.box(1.64,1.6,i,.10,3,.1,color,group);
    }
    for(let j=-1;j<=1;j+=2) this.box(j*.7,1.6,4.05,.08,2.8,.08,'cream',group);
    // A few raised connection studs establish the molded construction-toy language.
    for(let a=-.8;a<=.8;a+=1.6) for(let b=-2.4;b<=2.4;b+=2.4) this.cylinder(a,3.29,b,.35,.35,.18,color,8,group);
  }
  fence(x,z,w,d) {
    for(let i=-w/2;i<=w/2;i+=3.5) for(const k of [-1,1]) this.box(x+i,3.9,z+k*d/2,.22,2.5,.22,'steel');
    for(let i=-d/2;i<=d/2;i+=3.5) for(const k of [-1,1]) this.box(x+k*w/2,3.9,z+i,.22,2.5,.22,'steel');
    for(const k of [-1,1]) for(const y of [3.4,4.7]) {
      this.box(x,y,z+k*d/2,w,.09,.09,'steel'); this.box(x+k*w/2,y,z,.09,.09,d,'steel');
    }
  }
  makeStructures() {
    this.road([-99,61],[-64,35]); this.road([-64,35],[-32,-5]);
    this.road([-12,-23],[19,-59]); this.road([19,-59],[55,-65]); this.road([69,-67],[112,-77]);
    this.road([49,46],[102,28]);
    this.box(-66,2.79,20,26,.25,24,'asphalt');
    this.building(-82,13,10,9,4,'concrete'); this.building(-57,7,8,6,3.8,'dark');
    this.container(-95,37,'rust'); this.container(-96,47,'cream'); this.container(-37,29,'roof');
    this.fence(-67,20,31,30);
    this.building(6,-59,16,7,4.2,'concrete','roofLight'); this.building(25,-40,8,12,4.1,'cream','rust');
    this.building(-5,-68,11,9,3.4,'dark'); this.container(29,-72,'rust',PI/2);
    this.fence(9,-52,44,40);
    this.box(10,2.75,-50,13,.15,10,'sand');
    this.box(-8,2.7,-26,19,.16,19,'asphalt'); this.container(-21,-29,'cream'); this.container(-20,-20,'roof');
    this.building(103,-102,12,8,5.3,'concrete'); this.building(123,-83,10,14,5,'dark');
    this.box(99,2.74,-79,43,.16,34,'asphalt');
    for(let z=-95;z<=-62;z+=11) this.box(123,2.86,z,5,.08,.25,'cream');
    this.container(81,-106,'rust',PI/2); this.container(90,-106,'roof',PI/2);
    // A concrete river bridge, with supports, crash barriers and lamps.
    this.box(64,3.1,-66,23,1.1,8,'concrete'); this.box(64,3.7,-66,23,.12,6.8,'asphalt');
    for(const z of [-70,-62]) {this.box(64,4.25,z,24,.7,.5,'cream');}
    for(const x of [57,66,74]) {this.box(x,1.5,-66,2,3,6,'cliff'); this.box(x,3.8,-66,2,.04,.2,'cream');}
    // The harbor is an optional supply and combat diversion.
    this.box(91,1.7,85,42,1,19,'concrete'); this.box(106,1.5,99,9,1,25,'concrete');
    this.building(78,55,18,17,7,'cream','roof'); this.building(101,36,13,14,6,'concrete','rust');
    for(const [x,z,c] of [[61,54,'rust'],[58,41,'roof'],[97,62,'rust'],[106,69,'cream'],[89,68,'roof']]) this.container(x,z,c,PI/2);
    this.crane(112,70); this.crane(77,76);
    for(const [x,z] of [[-50,61],[-87,59],[38,-23],[111,-39],[49,22]]) {
      this.building(x,z,6,7,3.2,'cream','rust'); this.building(x+8,z+2,5,6,2.7,'concrete');
    }
    // Solar fields and aerials ground the setting in a near future.
    for(let x=85;x<112;x+=8) for(let z=-43;z<-34;z+=5) {
      this.box(x,3.4,z,.3,1.6,.3,'steel'); const panel=this.box(x,4.2,z,6,.15,3,'glass'); panel.rotation.x=-.28;
      this.box(x,4.25,z,.1,.18,3,'steel');
    }
    for(const [x,z] of [[-54,12],[21,-61],[112,-102]]) {
      this.rod([x,3,z],[x,15,z],.17,'steel'); this.box(x,13,z,3,.2,.2,'steel'); this.box(x,15.1,z,.35,.3,.35,'enemyGlow');
    }
  }
  crane(x,z) {
    this.obstacles.push({x:x+3,z,w:15,d:3,top:18});
    this.box(x,9,z,1.5,16,1.5,'orange'); this.box(x+4,17,z,15,1,1.2,'orange');
    this.rod([x-2,12,z],[x+10,17,z],.16,'dark'); this.rod([x+9,17,z],[x+9,5,z],.06,'dark');
    this.box(x+9,5,z,1,.5,1,'black'); this.box(x-1.5,14.5,z,3,3,3,'cream');
  }
  palm(x,z,s=1) {
    const g=new THREE.Group(); g.position.set(x,2.6,z); g.rotation.y=rand()*PI*2; g.scale.setScalar(s); this.static.add(g);
    const lean = (rand()-.5)*1.3;
    for(let i=0;i<4;i++) {
      const b=this.cylinder(lean*i*.3,i*1.7+.85,0,.23-i*.025,.32-i*.023,1.75,'trunk',5,g); b.rotation.z=-lean*.12;
      this.cylinder(lean*i*.3,i*1.7+.1,0,.34-i*.023,.34-i*.023,.13,'cliff',6,g);
    }
    const top=6.8;
    for(let i=0;i<7;i++) {
      const a=i*PI*2/7, l=3.6+rand();
      const geo=new THREE.BufferGeometry();
      const verts=[0,top,0, Math.sin(a)*l*.58,top+.55,Math.cos(a)*l*.58, Math.sin(a-.23)*l*.6,top+.05,Math.cos(a-.23)*l*.6,
        0,top,0, Math.sin(a+.23)*l*.6,top+.05,Math.cos(a+.23)*l*.6,Math.sin(a)*l*.58,top+.55,Math.cos(a)*l*.58,
        Math.sin(a)*l*.58,top+.55,Math.cos(a)*l*.58,Math.sin(a)*l,top-1.8,Math.cos(a)*l,Math.sin(a-.23)*l*.6,top+.05,Math.cos(a-.23)*l*.6,
        Math.sin(a)*l*.58,top+.55,Math.cos(a)*l*.58,Math.sin(a+.23)*l*.6,top+.05,Math.cos(a+.23)*l*.6,Math.sin(a)*l,top-1.8,Math.cos(a)*l];
      geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3)); geo.computeVertexNormals();
      this.mesh(geo,i%3===0?'palmTopFrond':i%2?'palmLightFrond':'palmFrond',lean,0,0,g);
    }
  }
  scatterNature() {
    const exclusion = [BASE,DEPOT,CAMP,{x:-66,z:20},{x:99,z:-79},{x:80,z:53}];
    for(let i=0;i<560;i++) {
      const x=rand()*290-145,z=rand()*255-125;
      if(!ISLANDS.some(p=>inPolygon(x,z,p)) || exclusion.some(p=>distance({x,z},p)<23)) continue;
      // Spare the main roads and bridge approach.
      if((Math.abs(x+z+30)<9 && x<0 && z>0) || (z>-74&&z<-57&&x>-10&&x<115)) continue;
      if(rand()>.32) this.palm(x,z,.65+rand()*.65);
      else {
        for(let j=0;j<3;j++) this.cylinder(x+j*.8,3.4+rand(),z+j*.6,1.1,2.3,2+rand()*2,j%2?'grassDark':'palm',5);
      }
    }
  }
  drawPadLetter(canvas,letter) {
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#d2d8b7';ctx.font='900 160px "Barlow Condensed",Impact,sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(letter,128,137);
  }
  makePad(x,z,r,letter,carrier) {
    const y=carrier?2.52:2.88;
    this.box(x,y-.09,z,r*2,.17,r*2,'dark');
    const circle=this.mesh(new THREE.RingGeometry(r*.73,r*.78,48),'cream',x,y+.02,z); circle.rotation.x=-PI/2;circle.castShadow=false;
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    this.drawPadLetter(canvas,letter);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    // The interface font is embedded in the page, but it may not be parsed yet when the deck is
    // built, so the letter is redrawn once it is ready instead of baking a system fallback.
    const fontReady=document.fonts&&document.fonts.load&&document.fonts.load('900 160px "Barlow Condensed"');
    if(fontReady&&fontReady.then)fontReady.then(()=>{this.drawPadLetter(canvas,letter);texture.needsUpdate=true;}).catch(()=>{});
    const mat=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false});
    const text=this.mesh(new THREE.PlaneGeometry(r*1.4,r*1.4),mat,x,y+.04,z);text.rotation.x=-PI/2;text.castShadow=false;
    for(const a of [0,PI/2,PI,PI*1.5]) this.box(x+Math.cos(a)*r*.95,y+.07,z+Math.sin(a)*r*.95,.8,.2,.8,'cyan');
  }
  makeCarrier() {
    const x=BASE.x,z=BASE.z;
    const poly=[[x-14,z+29],[x+14,z+29],[x+14,z-27],[x+7,z-34],[x-12,z-34]];
    this.slab(poly,-1.6,3,'dark'); this.slab(poly,1.4,1,'concrete');this.slab(poly,2.3,.18,'asphalt',.97);
    this.makePad(x,z,11,'H',true);
    for(const dx of [-12,12]) for(let dz=-23;dz<26;dz+=4) this.box(x+dx,2.57,z+dz,.4,.08,2.1,'cream');
    this.box(x-8,5,z+17,7,5,11,'concrete'); this.box(x-8,8,z+16,6,1.4,7,'dark');
    this.box(x-7,9,z+17,7,.3,8,'roofLight');this.box(x-8,7.9,z+12.4,5,.8,.12,'glass');
    this.rod([x-8,9,z+18],[x-8,18,z+18],.22,'steel');
    const array=this.box(x-8,15,z+18,5,.6,.3,'cream');this.rotating.push(array);
    this.box(x+7,3.5,z+20,4,2,5,'dark'); this.box(x+7,4.8,z+20,3,.7,3,'steel');
    this.box(x,2.5,z-23,8,.1,.45,'orange');
    for(const dz of [-25,-20]) this.container(x-7,z+dz,'roof');
    // Radar dish and defensive missile pods at the bow.
    for(const dx of [-8,8]) {
      this.box(x+dx,3.1,z-28,2.8,1.2,4,'cream');
      for(let i=0;i<3;i++) this.cylinder(x+dx-1+i,3.9,z-29,.3,.3,1.3,'dark',6);
    }
  }
  makeRescue() {
    this.people=[];
    for(let i=0;i<4;i++) {
      const p=new THREE.Group();this.dynamic.add(p);p.position.set(CAMP.x-3+i*2,2.75,CAMP.z);
      this.box(0,.8,0,.65,1.1,.55,'orange',p);this.box(0,1.65,0,.55,.55,.55,'cream',p);
      this.box(-.2,.23,0,.2,.55,.25,'dark',p);this.box(.2,.23,0,.2,.55,.25,'dark',p);
      const arm=this.box(-.5,1.1,0,.2,.8,.23,'orange',p);arm.rotation.z=-.6;
      p.userData.home=p.position.clone();
      this.mergeGroup(p);
      this.people.push(p);
    }
  }
  makeHelicopter() {
    const g=new THREE.Group();const body=new THREE.Group();g.add(body);this.heliBody=body;
    // Faceted longitudinal rings form a purpose-built attack-helicopter fuselage.
    const rings=[[-4.5,.45,.15,.25],[-3.2,1.1,-.45,1.2],[-1.3,1.45,-.8,1.3],[1.7,1.2,-.7,.8],[2.7,.65,-.3,.4]];
    const vertices=[];
    const ringPoints=([z,w,b,t])=>[[-w,b,z],[w,b,z],[w*.83,t,z],[-w*.83,t,z]];
    for(let i=0;i<rings.length-1;i++) {const a=ringPoints(rings[i]),b=ringPoints(rings[i+1]); for(let j=0;j<4;j++){const k=(j+1)%4;vertices.push(...a[j],...b[j],...a[k],...a[k],...b[j],...b[k]);}}
    const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geom.computeVertexNormals();this.mesh(geom,'airframe',0,0,0,body);
    const canopy=this.box(0,.96,-2.0,1.8,.7,2.8,'glass',body);canopy.rotation.x=-.22;
    this.box(0,1.41,-2.0,.12,.12,3.1,'steel',body);this.box(0,1.2,-3.15,1.75,.12,.12,'roofLight',body);
    this.box(0,1.55,-1.1,2.05,.16,.14,'roofLight',body);
    for(const x of [-1,1]) {
      this.box(x*1.31,.42,-.65,.17,1.1,1.7,'dark',body);
      this.box(x*1.42,.12,-.55,.08,.35,.9,'orange',body);
      this.box(x*1.23,.9,.9,.82,1.05,2.9,'airframeLight',body);
      const exhaust=this.cylinder(x*1.23,1.0,2.35,.35,.43,.7,'black',8,body);exhaust.rotation.x=PI/2;
      const wing=this.box(x*2.2,-.05,.35,2.5,.23,1.2,'roof',body);wing.rotation.z=x*.1;
      const pod=this.cylinder(x*2.9,-.55,.1,.58,.58,2.7,'dark',8,body);pod.rotation.x=PI/2;
      for(let i=0;i<3;i++) {const rocket=this.cylinder(x*2.9+(i-1)*.26,-.52,-1.29,.09,.09,.13,'black',6,body);rocket.rotation.x=PI/2;}
      const seeker=this.cylinder(x*3.65,-.3,.15,.2,.2,3.1,'cream',6,body);seeker.rotation.x=PI/2;
      this.box(x*3.65,-.3,1.2,.8,.09,.5,'dark',body);
      this.rod([x*.7,-.4,1],[x*1.8,-1.6,1.5],.13,'steel',body);
      const wheel=this.cylinder(x*1.85,-1.6,1.5,.44,.44,.42,'black',10,body);wheel.rotation.z=PI/2;
      this.box(x*1.7,.5,1.45,.13,.15,.3,x<0?'enemyGlow':'cyan',body);
    }
    this.rod([0,-.4,-2.6],[0,-1.6,-2.8],.14,'steel',body);
    const wheel=this.cylinder(0,-1.63,-2.8,.3,.3,.45,'black',10,body);wheel.rotation.z=PI/2;
    const gun=this.box(0,-.82,-3.15,.55,.55,.85,'dark',body);
    this.rod([0,-.85,-3.3],[0,-.85,-5.25],.12,'black',body);
    this.mesh(new THREE.IcosahedronGeometry(.42,0),'glass',0,-.42,-4.4,body);
    // Tail boom, stabilizers and tail rotor.
    const tail=this.cylinder(0,.13,5,.18,.65,6,'roof',5,body);tail.rotation.x=PI/2;
    this.box(0,.35,6.8,3.4,.17,.75,'roofLight',body);
    const fin=this.box(0,1.15,7.45,.22,2.5,1.05,'orange',body);fin.rotation.x=-.28;
    this.box(0,.42,7.35,.4,.3,1.3,'dark',body);
    this.tailRotor=new THREE.Group();this.tailRotor.position.set(.42,1.4,7.5);body.add(this.tailRotor);
    for(let i=0;i<4;i++) {const blade=this.box(0,0,0,.08,.16,2.6,'black',this.tailRotor);blade.rotation.x=i*PI/2;}
    this.cylinder(0,1.6,.1,.18,.24,1.3,'steel',8,body);
    this.rotor=new THREE.Group();this.rotor.position.set(0,2.25,.1);body.add(this.rotor);
    for(let i=0;i<4;i++) {
      const pivot=new THREE.Group();pivot.rotation.y=i*PI/2;this.rotor.add(pivot);
      this.box(4.15,0,0,7.7,.10,.37,'black',pivot);this.box(7.45,.035,0,.8,.12,.4,'cream',pivot);
    }
    this.cylinder(0,2.37,.1,.5,.5,.16,'dark',8,body);
    const blurMat=new THREE.MeshBasicMaterial({color:0x38534b,transparent:true,opacity:.07,side:THREE.DoubleSide,depthWrite:false});
    this.rotorBlur=this.mesh(new THREE.RingGeometry(2.3,7.9,64),blurMat,0,2.24,.1,body);this.rotorBlur.rotation.x=-PI/2;this.rotorBlur.castShadow=false;
    this.rotor.userData.animated=true;this.tailRotor.userData.animated=true;
    this.mergeGroup(this.rotor);this.mergeGroup(this.tailRotor);this.mergeGroup(body);
    g.scale.setScalar(.9);
    const lineGeo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,-8,0)]);
    this.winch=new THREE.Line(lineGeo,new THREE.LineBasicMaterial({color:0xe8ddb4}));g.add(this.winch);this.winch.visible=false;
    return g;
  }
  makeEnemies(game) {
    for(const e of game.enemies) {
      const g=new THREE.Group();this.dynamic.add(g);g.position.set(e.x,e.y,e.z);this.enemies.set(e.id,g);
      if(e.type==='radar') {
        this.box(0,1,0,7,2,7,'dark',g);this.box(0,2.4,0,5,.5,5,'cream',g);
        for(const dx of [-2,2]) this.rod([dx,2.5,-1.5],[0,8,0],.17,'steel',g);
        this.cylinder(0,5,0,.25,.7,5,'steel',6,g);
        const dish=new THREE.Group();dish.position.y=8;g.add(dish);this.rotating.push(dish);g.userData.dish=dish;
        const plate=this.mesh(new THREE.SphereGeometry(4.5,10,5,0,PI*2,0,PI*.38),'cream',0,0,0,dish);plate.rotation.x=-PI/2;
        this.rod([0,0,0],[0,0,-5],.12,'dark',dish); this.mesh(new THREE.IcosahedronGeometry(.3,0),'enemyGlow',0,0,-5,dish);
      } else if(e.type==='command') {
        this.box(0,0,0,12,3,12,'dark',g);this.box(0,2,0,10,1,10,'concrete',g);
        for(const x of [-3,0,3]) {
          this.cylinder(x,4.5,0,.95,.95,5.5,'cream',8,g);this.cylinder(x,7.8,0,0,.95,1.2,'orange',8,g);
          this.box(x,2.5,-1.3,1,.5,.3,'enemyGlow',g);
        }
        this.box(0,1,-5.1,7,1,.2,'orange',g);
        const shieldMat=new THREE.MeshBasicMaterial({color:0x43dacc,transparent:true,opacity:.10,wireframe:true,depthWrite:false});
        this.shield=this.mesh(new THREE.SphereGeometry(11,18,10,0,PI*2,0,PI*.55),shieldMat,0,0,0,g);this.shield.castShadow=false;
      } else if(e.type==='generator') {
        this.box(0,0,0,6,1,6,'dark',g);this.box(0,1,0,4,2,4,'steel',g);
        for(const x of [-1.4,1.4]) {this.cylinder(x,2.4,0,.65,.65,3,'dark',8,g);this.cylinder(x,3,0,.7,.7,.5,'cyan',8,g);}
        this.box(0,1.3,-2.1,2,.65,.1,'cyan',g);
      } else if(e.type==='crate') {
        for(const x of [-1,1]) this.cylinder(x,0,0,.9,.9,2.6,'rust',8,g);
        this.box(0,.7,-1,3,.3,.08,'orange',g);
      } else {
        const boat=e.type==='boat', tank=e.type==='tank';
        this.box(0,-.2,0,boat?3.3:4.2,boat?1.2:1,boat?8:5.4,boat?'concrete':'dark',g);
        if(boat) {this.box(0,.7,1.4,2.5,1.5,2.5,'cream',g);this.box(0,1.5,1,2.5,.5,2,'glass',g);}
        if(tank||e.type==='sam') for(const x of [-2.1,2.1]) {this.box(x,-.4,0,.65,.8,5.8,'black',g);for(let z=-2;z<=2;z++)this.cylinder(x,-.2,z,.32,.32,.7,'steel',6,g).rotation.z=PI/2;}
        const turret=new THREE.Group();g.add(turret);g.userData.turret=turret;
        this.cylinder(0,.6,0,1.4,1.7,.9,'rust',8,turret);
        if(e.type==='sam') {
          for(const x of [-1,1]) {const tube=this.box(x,1.7,-.4,.7,.8,3.7,'cream',turret);tube.rotation.x=-.38;}
        } else {
          this.box(0,1.3,0,2.5,1.1,2,'rust',turret);
          for(const x of tank?[0]:[-.4,.4]) this.rod([x,1.5,-.6],[x,1.5,tank?-4.7:-3.4],.17,'black',turret);
        }
        this.box(0,1.5,1.02,.8,.25,.1,'enemyGlow',turret);
      }
    }
  }
  // Each enemy is built from a dozen or more primitives; merging them per model turns every
  // model into two or three draw calls while leaving turrets and dishes free to animate.
  mergeModels() {
    for (const group of this.enemies.values()) {
      const { turret, dish } = group.userData;
      if (turret) turret.userData.animated = true;
      if (dish) dish.userData.animated = true;
      this.mergeGroup(group);
      if (turret) this.mergeGroup(turret);
      if (dish) this.mergeGroup(dish);
    }
  }
  makeMarkers() {
    this.marker=new THREE.Group();this.dynamic.add(this.marker);
    const mat=new THREE.MeshBasicMaterial({color:0xffc16a,transparent:true,opacity:.8,depthWrite:false,side:THREE.DoubleSide});
    const ring=this.mesh(new THREE.RingGeometry(7.9,8.1,64),mat,0,0,0,this.marker);ring.rotation.x=-PI/2;ring.castShadow=false;
    for(let i=0;i<4;i++) {const a=i*PI/2;const tick=this.box(Math.sin(a)*8.5,.06,Math.cos(a)*8.5,.22,.05,1.6,mat,this.marker);tick.rotation.y=a;tick.castShadow=false;}
    this.wash=this.mesh(new THREE.RingGeometry(2,7,48),new THREE.MeshBasicMaterial({color:0xc0d1b7,transparent:true,opacity:.15,depthWrite:false,side:THREE.DoubleSide}),0,3,0,this.dynamic);this.wash.rotation.x=-PI/2;this.wash.castShadow=false;
    this.beacon=this.mesh(new THREE.CylinderGeometry(.3,.3,15,6),new THREE.MeshBasicMaterial({color:0xffd584,transparent:true,opacity:.3,depthWrite:false}),0,0,0,this.marker);this.beacon.position.y=7.5;this.beacon.castShadow=false;
  }
  // Opaque matte geometry only differs by colour, so it can share one material once the
  // colour moves into the vertices. Transparent, textured and emissive meshes stay as they are.
  canBakeColor(material) {
    return material.isMeshStandardMaterial && !material.map && !material.transparent
      && material.emissive.getHex() === 0 && !material.wireframe;
  }
  shadingKey(material) {
    return this.canBakeColor(material)
      ? `bake_${material.roughness}_${material.metalness}_${material.side}`
      : material.uuid;
  }
  mergedMaterial(material) {
    const key = this.shadingKey(material);
    if (!this.canBakeColor(material)) return material;
    if (!this.mergedMaterials.has(key)) this.mergedMaterials.set(key, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: material.roughness, metalness: material.metalness,
      side: material.side, flatShading: true,
    }));
    return this.mergedMaterials.get(key);
  }
  bakeVertexColor(geometry, color) {
    const count = geometry.getAttribute('position').count, array = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { array[i*3] = color.r; array[i*3+1] = color.g; array[i*3+2] = color.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
  }
  // Flattens a mesh into world-or-parent space, ready to merge.
  bakedGeometry(mesh, matrix) {
    let geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
    geo.applyMatrix4(matrix);
    if (this.canBakeColor(mesh.material)) this.bakeVertexColor(geo, mesh.material.color);
    return geo;
  }
  buildMerged(bucket) {
    let geo = bucket.geos.length === 1 ? bucket.geos[0] : mergeGeometries(bucket.geos);
    const welded = mergeVertices(geo, 1e-4);
    if (welded && welded !== geo) { geo.dispose(); geo = welded; }
    const mesh = new THREE.Mesh(geo, this.mergedMaterial(bucket.material));
    mesh.castShadow = bucket.shadow; mesh.receiveShadow = true;
    for (const g of bucket.geos) if (g !== geo) g.dispose();
    return mesh;
  }
  // Collapses one animated model (an enemy, the airframe, a rescuee) to a few draw calls.
  // Subgroups flagged animated are left in place and merged on their own.
  mergeGroup(root) {
    root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert(), local = new THREE.Matrix4();
    const sources = [], buckets = new Map();
    const collect = node => {
      for (const child of node.children) {
        if (child.isGroup) { if (!child.userData.animated) collect(child); continue; }
        if (child.isMesh && !child.material.transparent) sources.push(child);
      }
    };
    collect(root);
    if (sources.length < 2) return;
    for (const mesh of sources) {
      const key = this.shadingKey(mesh.material) + '_' + mesh.castShadow;
      if (!buckets.has(key)) buckets.set(key, { material: mesh.material, shadow: mesh.castShadow, geos: [] });
      buckets.get(key).geos.push(this.bakedGeometry(mesh, local.multiplyMatrices(toRoot, mesh.matrixWorld)));
    }
    for (const mesh of sources) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    for (const bucket of buckets.values()) root.add(this.buildMerged(bucket));
    for (const child of [...root.children]) if (child.isGroup && !child.children.length) child.removeFromParent();
  }
  mergeStatic() {
    this.static.updateMatrixWorld(true);
    const buckets=new Map();const preserve=[];
    this.static.traverse(obj=>{
      if(!obj.isMesh) return;
      if(obj===this.water||obj.material.map||obj.material.transparent||this.rotating.includes(obj)) {preserve.push(obj);return;}
      // Key on the geometry's own centre: slabs are built in absolute coordinates and sit at the
      // origin, so keying on object position used to drop the whole terrain into one cell.
      const position=new THREE.Vector3();
      if(!obj.geometry.boundingBox)obj.geometry.computeBoundingBox();
      obj.geometry.boundingBox.getCenter(position).applyMatrix4(obj.matrixWorld);
      const key=this.shadingKey(obj.material)+'_'+Math.floor(position.x/75)+'_'+Math.floor(position.z/75)+'_'+obj.castShadow;
      if(!buckets.has(key)) buckets.set(key,{material:obj.material,shadow:obj.castShadow,geos:[]});
      buckets.get(key).geos.push(this.bakedGeometry(obj,obj.matrixWorld));
    });
    for(const obj of preserve) this.scene.attach(obj);
    const old=this.static;this.static=new THREE.Group();this.scene.add(this.static);
    for (const bucket of buckets.values()) this.static.add(this.buildMerged(bucket));
    this.scene.remove(old);old.traverse(o=>{if(o.isMesh)o.geometry.dispose();});
  }
  makeParticles() {
    const geo=new THREE.IcosahedronGeometry(1,0);
    const mat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true});
    this.particleMesh=new THREE.InstancedMesh(geo,mat,360);this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.particleMesh.count=0;this.particleMesh.frustumCulled=false;this.dynamic.add(this.particleMesh);
    this.dummy=new THREE.Object3D();this.color=new THREE.Color();
    this.bulletMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.11,.11,1),new THREE.MeshBasicMaterial({color:0xffffff}),180);this.bulletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.bulletMesh.frustumCulled=false;this.bulletMesh.count=0;this.dynamic.add(this.bulletMesh);
    this.flash=new THREE.PointLight(0xffa445,0,32,2);this.dynamic.add(this.flash);
  }
  spawnParticle(x,y,z,vx,vy,vz,size,color,life=1.2,type='debris') {
    if(this.particles.length>=350) this.particles.shift();
    this.particles.push({x,y,z,vx,vy,vz,size,color,life,maxLife:life,type,r:rand()*6});
  }
  explosion(x,y,z,size=1) {
    for(let i=0;i<25*size;i++) {
      const a=rand()*PI*2,s=rand()*12*size;
      this.spawnParticle(x,y+1,z,Math.sin(a)*s,rand()*14*size,Math.cos(a)*s,(.15+rand()*.7)*size,i%4===0?0xffd582:i%3===0?0xe88b42:0x3d4c44, .7+rand()*1.5);
    }
    for(let i=0;i<7;i++)this.spawnParticle(x+(rand()-.5)*4*size,y+rand()*4,z+(rand()-.5)*4*size,rand()*.8,1.5+rand()*2,rand(),1.1*size,0x4d5550,3+rand()*2,'smoke');
    this.flash.position.set(x,y+4,z);this.flash.intensity=160*size;
  }
  makeBirds() {
    for(let i=0;i<7;i++) {
      const g=new THREE.Group();this.dynamic.add(g);
      for(const side of [-1,1]) {const wing=this.box(side*.7,0,0,1.5,.05,.3,'cream',g);wing.rotation.z=side*.18;}
      this.birds.push(g);
    }
  }
  reset(game) {
    for(const e of game.enemies) {const mesh=this.enemies.get(e.id);mesh.visible=true;mesh.scale.setScalar(1);mesh.position.set(e.x,e.y,e.z);mesh.rotation.set(0,e.yaw,0);}
    this.particles.length=0;this.smoking.length=0;
    for(const person of this.people)person.visible=true;
    this.heli.visible=true;
  }
  flightHeight(x,z) {
    let top=2.7;
    for(const obstacle of this.obstacles) if(Math.abs(x-obstacle.x)<obstacle.w*.5+5&&Math.abs(z-obstacle.z)<obstacle.d*.5+5)top=Math.max(top,obstacle.top);
    for(const [id,mesh] of this.enemies) if(id==='coastal-radar'&&mesh.scale.y>.5&&Math.hypot(x-mesh.position.x,z-mesh.position.z)<12)top=Math.max(top,16);
    return top+6.3;
  }
  handle(event) {
    const {x,y,z}=event;
    if(event.type==='explosion') {
      this.explosion(x,y,z,event.size);
      if(event.id) {
        const mesh=this.enemies.get(event.id);mesh.scale.y=.18;mesh.position.y=2.7;
        this.smoking.push({x,y:3,z,t:0});
      }
    }
    if(event.type==='hit') for(let i=0;i<4;i++)this.spawnParticle(x,y,z,(rand()-.5)*8,2+rand()*4,(rand()-.5)*8,.12,0xffc982,.3+rand()*.4);
    if(event.type==='shot' && event.weapon>0)for(let i=0;i<3;i++)this.spawnParticle(x,y,z,(rand()-.5)*2,1,(rand()-.5)*2,.25,0xddd6b5,.5,'smoke');
    if(event.type==='flares')for(let i=0;i<20;i++){const a=i*PI*2/20;this.spawnParticle(x,y,z,Math.sin(a)*8,2,Math.cos(a)*8,.18,0xffebb3,1.5);}
    if(event.type==='splash')for(let i=0;i<10;i++)this.spawnParticle(x,y,z,(rand()-.5)*7,rand()*7,(rand()-.5)*7,.2,0xacc8b2,.8);
  }
  update(game,dt,time,obj,interacting) {
    const p=game.p;this.waterTime.value=time;
    this.heli.position.set(p.x,p.y+Math.sin(time*2.1)*.12,p.z);this.heli.rotation.y=p.yaw;
    this.heli.visible=game.phase!=='failed';
    const forwardSpeed=p.vx*Math.sin(p.yaw)-p.vz*Math.cos(p.yaw),sideSpeed=p.vx*Math.cos(p.yaw)+p.vz*Math.sin(p.yaw);
    this.heliBody.rotation.x=THREE.MathUtils.damp(this.heliBody.rotation.x,-forwardSpeed*.008,7,dt);
    this.heliBody.rotation.z=THREE.MathUtils.damp(this.heliBody.rotation.z,-sideSpeed*.012,7,dt);
    this.rotor.rotation.y=time*39;this.tailRotor.rotation.x=time*52;
    for(const object of this.rotating)object.rotation.y+=dt*.7;
    this.winch.visible=game.stage===1 && game.rescue>0;
    if(this.winch.visible){this.winch.geometry.attributes.position.array[4]=-(p.y-2.8)/.9;this.winch.geometry.attributes.position.needsUpdate=true;}
    this.wash.position.set(p.x,ISLANDS.some(poly=>inPolygon(p.x,p.z,poly))?2.81:.1,p.z);this.wash.rotation.z=time*.3;
    this.wash.material.opacity=interacting?.18:.06;this.wash.scale.setScalar(.94+Math.sin(time*6)*.06);
    this.marker.position.set(obj.x,3.05,obj.z);this.marker.rotation.y=time*.12;
    this.beacon.material.opacity=.14+Math.sin(time*3)*.055;
    if(this.shield)this.shield.visible=game.enemies.some(e=>e.generator&&!e.dead);
    for(const e of game.enemies) {
      if(e.dead) continue;const model=this.enemies.get(e.id);model.position.x=e.x;model.position.z=e.z;
      if(e.patrol)model.rotation.y=e.yaw;
      if(model.userData.turret)model.userData.turret.rotation.y=Math.atan2(p.x-e.x,-(p.z-e.z))-model.rotation.y;
    }
    for(let i=0;i<this.people.length;i++){
      const person=this.people[i];person.visible=i>=game.rescued;person.rotation.y=Math.sin(time*2+i)*.2;person.position.copy(person.userData.home);
      if(i===game.rescued&&game.rescue>0){
        const approach=Math.min(1,game.rescue/.3),lift=THREE.MathUtils.clamp((game.rescue-.3)/1.3,0,1);
        person.position.x=THREE.MathUtils.lerp(person.userData.home.x,p.x,approach);person.position.z=THREE.MathUtils.lerp(person.userData.home.z,p.z,approach);person.position.y=2.75+lift*(p.y-2.75);
      }
    }
    for(const fire of this.smoking) {
      fire.t+=dt;
      if(fire.t>.26){fire.t=0;this.spawnParticle(fire.x+(rand()-.5)*2,fire.y,fire.z,1.5,2.3,.65,1,0x586058,4,'smoke');}
    }
    if(p.armor<35&&game.phase==='playing'&&rand()<dt*8)this.spawnParticle(p.x,p.y,p.z,0,1,0,.7,0x3e4743,2,'smoke');
    let count=0;
    for(let i=this.particles.length-1;i>=0;i--) {
      const part=this.particles[i];part.life-=dt;if(part.life<=0){this.particles.splice(i,1);continue;}
      part.x+=part.vx*dt;part.y+=part.vy*dt;part.z+=part.vz*dt;
      if(part.type!=='smoke')part.vy-=12*dt;
      const scale=part.type==='smoke'?part.size*(1+(part.maxLife-part.life)*.9)*Math.min(1,part.life):part.size*Math.min(1,part.life*3);
      this.dummy.position.set(part.x,Math.max(.1,part.y),part.z);this.dummy.rotation.set(part.r,part.r+time,part.r);this.dummy.scale.setScalar(scale);this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(count,this.dummy.matrix);this.color.setHex(part.color);this.particleMesh.setColorAt(count,this.color);count++;
    }
    this.particleMesh.count=count;this.particleMesh.instanceMatrix.needsUpdate=true;if(this.particleMesh.instanceColor)this.particleMesh.instanceColor.needsUpdate=true;
    let bullets=0;
    for(const b of game.projectiles) {
      if(bullets>=180)break;
      this.dummy.position.set(b.x,b.y,b.z);this.dummy.rotation.set(0,Math.atan2(b.vx,b.vz),0);this.dummy.scale.set(b.weapon?3:1,b.weapon?3:1,b.weapon?1.7:2.4);this.dummy.updateMatrix();
      this.bulletMesh.setMatrixAt(bullets,this.dummy.matrix);this.color.setHex(b.enemy?0xff643c:b.weapon===0?0xffe6a9:0xf1f1c1);this.bulletMesh.setColorAt(bullets,this.color);bullets++;
      if(b.weapon>0&&rand()<dt*35)this.spawnParticle(b.x,b.y,b.z,0,.4,0,.23,b.enemy?0xc79969:0xb8bca1,.8,'smoke');
    }
    this.bulletMesh.count=bullets;this.bulletMesh.instanceMatrix.needsUpdate=true;if(this.bulletMesh.instanceColor)this.bulletMesh.instanceColor.needsUpdate=true;
    this.flash.intensity*=Math.exp(-12*dt);
    this.birds.forEach((bird,i)=>{const a=time*.08+i*.16;bird.position.set(-40+Math.cos(a)*42+i*2,22+Math.sin(time+i)*.4,38+Math.sin(a)*37+i);bird.rotation.y=-a;bird.children.forEach((w,j)=>w.rotation.z=(j?1:-1)*(.2+Math.sin(time*5+i)*.24));});
  }
}
