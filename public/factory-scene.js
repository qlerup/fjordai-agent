import * as T from 'three';
import {FactoryPlayback} from './factory-playback.mjs';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const COLORS={idle:0x537486,running:0xffbf64,revision:0xffbf64,completed:0x5be5b1,failed:0xff657b,interrupted:0xbda2ff};
const TYPES={review:'Code Reviewer',analysis:'Inputanalyse',start:'Indlevering',agent:'Agentmaskine',router:'Fordeler',condition:'Kontrolstation',text:'Tekstpresse',merge:'Samlemaskine',end:'Levering'};
const STATUS={idle:'Venter',running:'Arbejder',revision:'Rettelser sendt',completed:'Svar klar',failed:'Fejl',interrupted:'Stoppet'};
const make=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
export class FactoryScene{
 constructor(host,{onSelect=()=>{}}={}){
  this.playback=new FactoryPlayback();this.lastTime=null;this.host=host;this.onSelect=onSelect;this.machines=[];this.belts=[];this.drones=new Map();this.live={nodes:{},ports:new Set(),edges:new Set()};this.materials=new Map();this.textures=new Map();this.motion=matchMedia('(prefers-reduced-motion: reduce)');this.frame=0;this.visible=false;
  try{this.renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch{host.append(make('p','factory-fallback','3D-visningen kræver WebGL2. Du kan stadig redigere og køre projektet.'));return;}
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.setClearColor(0x0a1420);this.renderer.outputColorSpace=T.SRGBColorSpace;
  host.append(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','3D-fabrik. Træk for at dreje, og rul for at zoome.');
  this.labels=make('div','factory-labels');host.append(this.labels);
  this.labelsVisible=localStorage.getItem('fjordagent.factoryLabels')!=='hidden';this.labels.hidden=!this.labelsVisible;
  this.scene=new T.Scene();this.scene.fog=new T.Fog(0x0a1420,65,180);this.scene.add(new T.HemisphereLight(0xb8e4ff,0x172130,3));const key=new T.DirectionalLight(0xffe1b8,4);key.position.set(-12,28,18);this.scene.add(key);const rim=new T.DirectionalLight(0x57bfff,2);rim.position.set(10,10,-15);this.scene.add(rim);
  this.camera=new T.OrthographicCamera(-18,18,12,-12,.1,600);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=false;this.controls.minPolarAngle=.2;this.controls.maxPolarAngle=Math.PI*.47;this.controls.minZoom=.15;this.controls.maxZoom=5;this.controls.addEventListener('change',()=>this.render());
  this.resize=new ResizeObserver(()=>{this.size();});this.resize.observe(host);this.observer=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;this.schedule();});this.observer.observe(host);document.addEventListener('visibilitychange',()=>this.schedule());this.motion.addEventListener('change',()=>this.schedule());
  this.root=new T.Group();this.scene.add(this.root);this.size();
  let pressed;this.renderer.domElement.addEventListener('pointerdown',e=>{pressed={x:e.clientX,y:e.clientY};});
  this.renderer.domElement.addEventListener('pointerup',e=>{if(!pressed||Math.hypot(e.clientX-pressed.x,e.clientY-pressed.y)>5)return;pressed=null;const r=this.renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.camera);const hit=ray.intersectObjects(this.machines.map(m=>m.group),true)[0];if(hit){let object=hit.object;while(object&&!object.userData.nodeId)object=object.parent;if(object)this.select(object.userData.nodeId);}});
 }
 setLabelsVisible(visible){this.labelsVisible=visible;if(this.labels)this.labels.hidden=!visible;localStorage.setItem('fjordagent.factoryLabels',visible?'visible':'hidden');}
 texture(kind){
  if(this.textures.has(kind))return this.textures.get(kind);
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const c=canvas.getContext('2d');
  c.fillStyle=kind==='floor'?'#192b38':kind==='rubber'?'#26353c':'#80929d';c.fillRect(0,0,128,128);
  if(kind==='floor'){c.strokeStyle='#334957';c.lineWidth=2;c.strokeRect(1,1,126,126);for(const x of[6,122])for(const y of[6,122]){c.fillStyle='#516575';c.fillRect(x,y,2,2);}}
  else if(kind==='rubber'){for(let x=0;x<128;x+=16){c.fillStyle='#53626a';c.fillRect(x,0,3,128);c.fillStyle='#101e27';c.fillRect(x+3,0,2,128);}}
  else{for(let y=0;y<128;y+=2){c.fillStyle=y%6===0?'#8d9ca5':'#768a97';c.fillRect(0,y,128,1);}c.strokeStyle='#586e7b';c.strokeRect(2,2,124,124);}
  const texture=new T.CanvasTexture(canvas);texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.colorSpace=T.SRGBColorSpace;this.textures.set(kind,texture);return texture;
 }
 material(color,metalness=.45){const key=color+':'+metalness;if(!this.materials.has(key))this.materials.set(key,new T.MeshStandardMaterial({color,metalness,roughness:.62,map:this.texture('metal')}));return this.materials.get(key);}
 box(parent,w,h,d,x,y,z,color=0x243e51){const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),this.material(color));mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
 cylinder(parent,r,h,x,y,z,color=0x38566a){const mesh=new T.Mesh(new T.CylinderGeometry(r,r,h,16),this.material(color));mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
 shutter(parent,x,width,height,color){
  const bottom=.96,top=bottom+height,door=new T.Group();door.position.set(x,bottom+height/2,0);parent.add(door);
  this.box(door,.1,height,width,0,0,0,color);
  for(let i=1;i<6;i++)this.box(door,.12,.025,width,0,-height/2+i*height/6,0,0x304958);
  this.box(door,.13,.07,width,0,-height/2+.035,0,0xd7b66d);
  for(const z of[-width/2-.04,width/2+.04])this.box(parent,.17,height+.1,.08,x,bottom+height/2,z,0x728b97);
  this.box(parent,.25,.15,width+.22,x,top+.06,0,0x304958);
  // Close the gap below the belt as well, so the portal is a solid facade.
  this.box(parent,.13,.36,width,x,.63,0,color);
  return{object:door,side:x<0?'in':'out',top,height,open:0,target:0};
 }
 terminal(parent,delivery,doors){
  const wall=delivery?0x397d70:0x9b7952,trim=delivery?0x72d5b3:0xe5b86a,roof=0x304958;
  // A warehouse around the existing belt, with open loading portals at both ends.
  for(const z of[-1.02,1.02]){
   this.box(parent,3,1.65,.16,0,1.3,z,wall);
   this.box(parent,3.12,.14,.2,0,.55,z,0x526a7d);
   for(const x of[-1.36,0,1.36])this.box(parent,.09,1.75,.21,x,1.35,z,trim);
   for(const x of[-.7,.7]){
    this.box(parent,.88,.55,.05,x,1.64,z*1.09,0x172c3c);
    this.box(parent,.72,.39,.06,x,1.64,z*1.12,0x8fc9d0);
    this.box(parent,.045,.43,.07,x,1.64,z*1.15,trim);
   }
  }
  for(const x of[-1.5,1.5]){
   const gable=new T.Shape();gable.moveTo(-1.12,2.14);gable.lineTo(1.12,2.14);gable.lineTo(0,2.57);gable.closePath();
   const geometry=new T.ExtrudeGeometry(gable,{depth:.16,bevelEnabled:false});geometry.rotateY(Math.PI/2);geometry.translate(x-.08,0,0);parent.add(new T.Mesh(geometry,this.material(wall)));
   for(const z of[-.83,.83])this.box(parent,.18,1.66,.4,x,1.3,z,wall);
   this.box(parent,.2,.42,2.2,x,1.98,0,wall);
   for(const z of[-.59,.59])this.box(parent,.24,1.27,.09,x,1.12,z,trim);
   this.box(parent,.25,.1,1.27,x,1.77,0,trim);
   this.box(parent,.06,.16,.72,x*1.08,2,0,trim);
   // Raised canopy keeps the loading opening and moving parcels visible.
   this.box(parent,.6,.1,1.5,x*1.1,1.84,0,roof);
   doors.push(this.shutter(parent,x,1.1,.8,delivery?0x4c9a87:0xab8b5f));
  }
  const pitch=.3;
  for(const sign of[-1,1]){
   const panel=this.box(parent,3.38,.13,1.3,0,2.4,sign*.6,roof);panel.rotation.x=sign*pitch;
   for(let i=0;i<9;i++){const seam=this.box(parent,.035,.045,1.3,-1.5+i*.375,2.48,sign*.6,0x607e8a);seam.rotation.x=sign*pitch;}
  }
  this.box(parent,3.45,.12,.14,0,2.61,0,trim);
  // Rooftop ventilation and a small personnel door on the visible facade.
  this.box(parent,.62,.22,.44,.75,2.65,-.45,0x78909a);
  for(let i=0;i<4;i++)this.box(parent,.05,.025,.34,.55+i*.13,2.77,-.45,0x263d4b);
  this.box(parent,.43,.85,.08,0,.94,1.16,0x203b49);
  this.box(parent,.055,.055,.04,.13,.94,1.21,trim);
  this.box(parent,.75,.08,.3,0,.48,1.3,0x78909a);
  // Staged freight beside the hall distinguishes receiving from dispatch.
  for(let i=0;i<2;i++){
   const x=-.95+i*.57;this.box(parent,.48,.07,.42,x,.5,1.38,0x7c6449);
   this.box(parent,.4,.38,.36,x,.73,1.38,delivery?0x5abe9d:0xbd9465);
   this.box(parent,.09,.4,.38,x,.73,1.38,0xdec99a);
  }
 }
 reviewHall(parent,doors){
  const wall=0x3d5550,trim=0xc2b789;
  for(const z of[-1.22,1.22]){this.box(parent,3.5,2.15,.18,0,1.55,z,wall);for(const x of[-1.62,0,1.62])this.box(parent,.12,2.25,.24,x,1.58,z,trim);}
  for(const x of[-1.75,1.75]){for(const z of[-.95,.95])this.box(parent,.18,2.15,.62,x,1.55,z,wall);this.box(parent,.2,.63,2.65,x,2.33,0,wall);doors.push(this.shutter(parent,x,1.2,1.05,0x819b89));this.box(parent,.55,.12,1.58,x*1.08,2.1,0,trim);}
  this.box(parent,3.95,.2,3.05,0,2.75,0,0x84968b);this.box(parent,3.6,.08,2.74,0,2.9,0,0x263f40);
  const pad=new T.Mesh(new T.TorusGeometry(.86,.045,8,40),this.material(0xe4c773));pad.rotation.x=Math.PI/2;pad.position.y=2.97;parent.add(pad);
  for(const x of[-.29,.29])this.box(parent,.09,.035,.9,x,2.98,0,0xe6e5c8);this.box(parent,.65,.035,.09,0,2.98,0,0xe6e5c8);
  for(const x of[-1.55,1.55])for(const z of[-1.12,1.12]){this.cylinder(parent,.08,.15,x,2.98,z,0xe4c773);}
  this.box(parent,2.72,.84,.08,-.12,1.96,1.36,0x17302e);this.box(parent,2.48,.61,.06,-.12,1.96,1.43,0x93c6bc);
  for(const x of[-.95,-.12,.71])this.box(parent,.06,.7,.07,x,1.96,1.47,trim);
  this.box(parent,.6,.58,.08,-.87,.99,1.38,0x244137);const tickA=this.box(parent,.29,.09,.07,-1.01,1.02,1.45,0xa1edbb);tickA.rotation.z=-.6;const tickB=this.box(parent,.49,.09,.07,-.74,1.13,1.45,0xa1edbb);tickB.rotation.z=.85;
  this.box(parent,.48,1.09,.1,1.18,1.08,1.38,0x203b3c);this.box(parent,.28,.31,.05,1.18,1.35,1.45,0x93c6bc);this.box(parent,.65,.1,.3,1.18,.51,1.47,trim);
 }
 analysisHall(parent,doors){
  const wall=0x284c60,frame=0x89a9b7,accent=0xe1b65e;
  // A receiving hall with a raised control room and a lower dispatch wing.
  this.box(parent,4.45,.16,3.35,0,.48,0,0x536d7d);
  for(const z of[-1.25,1.25]){
   this.box(parent,3.65,2.05,.18,0,1.52,z,wall);
   for(const x of[-1.72,-.55,.55,1.72])this.box(parent,.09,2.15,.24,x,1.55,z,frame);
   this.box(parent,3.8,.13,.23,0,2.51,z,frame);
  }
  for(const x of[-1.82,1.82]){
   for(const z of[-.94,.94])this.box(parent,.18,2.05,.64,x,1.52,z,wall);
   this.box(parent,.2,.48,2.68,x,2.3,0,wall);
   doors.push(this.shutter(parent,x,1.2,1.1,0x6f94a5));
   this.box(parent,.65,.13,1.62,x*1.08,2.16,0,frame);
   for(const z of[-.68,.68])this.box(parent,.22,.22,.1,x,.69,z,accent);
  }
  this.box(parent,3.98,.18,2.95,0,2.65,0,0x426c80);
  // Clerestory windows and skylights make this read as a control building.
  this.box(parent,3.3,.48,.8,-.08,2.96,-.42,wall);
  this.box(parent,3.6,.12,1.04,-.08,3.24,-.42,frame);
  this.box(parent,2.92,.27,.05,-.08,2.98,.005,0x8ecbd3);
  for(const x of[-1.1,-.42,.26,.94])this.box(parent,.05,.34,.06,x,2.98,.04,frame);
  for(const x of[-1.13,-.28,.57]){const glass=this.box(parent,.62,.06,.62,x,2.78,.73,0x78b5bf);glass.rotation.x=-.13;}
  this.cylinder(parent,.15,.48,1.42,2.96,-.8,frame);this.cylinder(parent,.24,.1,1.42,3.22,-.8,0x304b5b);
  // Operator windows, a personnel entrance and a scanner emblem on the facade.
  this.box(parent,2.35,.85,.1,-.34,1.88,1.38,0x102c3d);
  this.box(parent,2.16,.64,.06,-.34,1.88,1.45,0x83bbc5);
  for(const x of[-1.02,-.34,.34])this.box(parent,.05,.7,.07,x,1.88,1.5,frame);
  this.box(parent,.48,1.12,.13,1.17,1.12,1.4,0x132e3e);this.box(parent,.28,.33,.05,1.17,1.4,1.49,0x83bbc5);
  this.box(parent,.07,.07,.05,1.31,1.03,1.5,accent);this.box(parent,.72,.12,.38,1.17,.53,1.48,frame);
  const scanner=new T.Mesh(new T.TorusGeometry(.18,.035,8,20),this.material(0xa7e2e2));scanner.position.set(-1.03,1.03,1.43);parent.add(scanner);
  const handle=this.box(parent,.25,.07,.07,-.84,.83,1.43,0xa7e2e2);handle.rotation.z=-.7;
  for(let i=0;i<3;i++)this.box(parent,.36,.065,.06,-.36+i*.45,1.04,1.41,i===0?accent:0x72b7b6);
 }
 syncDrones(){
  for(const drone of this.drones.values()){drone.group.visible=false;drone.line.visible=false;}
  if(this.motion.matches)return;
  for(const transfer of this.playback.transfers.filter(t=>t.transport==='drone')){
   const source=this.machines.find(m=>m.node.id===transfer.source),target=this.machines.find(m=>m.node.id===transfer.target);if(!source||!target)continue;
   const key=transfer.source+'>'+transfer.target;let drone=this.drones.get(key);
   if(!drone){
    const group=new T.Group(),rotors=[];this.root.add(group);this.box(group,.48,.16,.44,0,0,0,0x98bfc1);this.box(group,1.08,.06,.09,0,0,0,0x263e4b);this.box(group,.09,.06,1.08,0,0,0,0x263e4b);
    for(const x of[-.43,.43])for(const z of[-.43,.43]){const rotor=new T.Group();rotor.position.set(x,.12,z);group.add(rotor);this.cylinder(rotor,.065,.09,0,0,0,0xe1c478);this.box(rotor,.48,.025,.065,0,.06,0,0xb3c9cf);this.box(rotor,.065,.025,.48,0,.06,0,0xb3c9cf);rotors.push(rotor);}
    for(const x of[-.2,.2])this.box(group,.035,.3,.035,x,-.2,0,0x7d929a);this.box(group,.4,.36,.4,0,-.42,0,0xf0ba72);this.box(group,.075,.38,.42,0,-.42,0,0x725433);
    const a=source.position.clone().add(new T.Vector3(0,4,0)),b=target.position.clone().add(new T.Vector3(0,3.8,0)),curve=new T.CubicBezierCurve3(a,a.clone().add(new T.Vector3(0,3,0)),b.clone().add(new T.Vector3(0,3,0)),b);
    const line=new T.Line(new T.BufferGeometry().setFromPoints(curve.getPoints(64)),new T.LineDashedMaterial({color:0xe5c47b,dashSize:.23,gapSize:.16,transparent:true,opacity:.6}));line.computeLineDistances();this.root.add(line);drone={source:transfer.source,target:transfer.target,group,rotors,curve,line};this.drones.set(key,drone);
   }
   drone.progress=transfer.progress;drone.group.visible=true;drone.line.visible=true;drone.group.position.copy(drone.curve.getPoint(transfer.progress));const tangent=drone.curve.getTangent(transfer.progress);drone.group.rotation.y=-Math.atan2(tangent.z,tangent.x);
  }
 }
 dock(machine,slots,direction){
  const sign=direction==='out'?1:-1,depth=slots.length*1.12+.16,g=machine.group;
  // An enclosed extension of the machine, with a separate loading bay per belt.
  this.box(g,1.7,.45,depth+ .2,sign*2.9,.2,0,0x172c3c);
  this.box(g,1.7,.12,depth,sign*2.9,.88,0,0x526a7d);
  this.box(g,1.8,.16,depth+.15,sign*2.9,1.8,0,0x60798b);
  for(const z of[-depth/2,depth/2])this.box(g,1.65,.85,.12,sign*2.9,1.34,z,0x243e51);
  // Solid rear facade with a central passage to the original machine belt.
  for(const z of[-(depth+.9)/4,(depth+.9)/4])this.box(g,.12,.85,(depth-.9)/2,sign*2.12,1.34,z,0x243e51);
  this.box(g,.12,.16,depth,sign*2.12,1.7,0,0x243e51);
  return slots.map((slot,i)=>{
   const z=(i-(slots.length-1)/2)*1.12,lane=new T.Group();lane.position.z=z;g.add(lane);
   const door=this.shutter(lane,sign*3.65,.96,.72,0x60798b);door.edge=slot.edge||null;machine.doors.push(door);
   for(const dz of[-.53,.53])this.box(lane,.15,.85,.1,sign*3.65,1.34,dz,0x243e51);
   this.box(lane,.06,.12,.44,sign*3.76,1.88,0,0xd7b66d);
   return{edge:slot.edge,point:machine.position.clone().add(new T.Vector3(sign*3.8,.88,z))};
  });
 }
 conveyor(parent,curve){
  const length=curve.getLength(),count=Math.min(140,Math.max(8,Math.ceil(length/.25))),decks=[],rails=[],legs=[],rollers=[];
  const add=(list,w,h,d,p,angle=0)=>{const geometry=new T.BoxGeometry(w,h,d);geometry.rotateY(angle);geometry.translate(p.x,p.y,p.z);list.push(geometry);};
  for(let i=0;i<count;i++){const u=(i+.5)/count,p=curve.getPoint(u),v=curve.getTangent(u),angle=-Math.atan2(v.z,v.x),side=new T.Vector3(-v.z,0,v.x).multiplyScalar(.46);add(decks,length/count+.025,.12,.76,p,angle);for(const sign of[-1,1])add(rails,length/count+.025,.17,.055,p.clone().addScaledVector(side,sign).add(new T.Vector3(0,.03,0)),angle);}
  const supportCount=Math.max(1,Math.ceil(length/2.7));for(let i=0;i<=supportCount;i++){const p=curve.getPoint(i/supportCount),v=curve.getTangent(i/supportCount),angle=-Math.atan2(v.z,v.x),side=new T.Vector3(-v.z,0,v.x).multiplyScalar(.32);for(const sign of[-1,1]){const q=p.clone().addScaledVector(side,sign);add(legs,.1,.83,.1,new T.Vector3(q.x,.315,q.z),angle);add(legs,.32,.08,.3,new T.Vector3(q.x,-.11,q.z),angle);}add(legs,.16,.1,.85,new T.Vector3(p.x,.58,p.z),angle);}
  for(let i=0;i<=Math.ceil(length/.45);i++){const p=curve.getPoint(i/Math.ceil(length/.45)),v=curve.getTangent(i/Math.ceil(length/.45)),geom=new T.CylinderGeometry(.09,.09,.78,8);geom.rotateX(Math.PI/2);geom.rotateY(-Math.atan2(v.z,v.x));geom.translate(p.x,p.y-.09,p.z);rollers.push(geom);}
  const texture=this.texture('rubber').clone();texture.repeat.set(.125,1);texture.needsUpdate=true;const deckMaterial=new T.MeshStandardMaterial({color:0x809eaa,map:texture,roughness:.94});
  for(const [geometries,material]of[[decks,deckMaterial],[rails,this.material(0x7793a3)],[legs,this.material(0x3c5667)],[rollers,this.material(0x9faab0)]]){const geometry=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());parent.add(new T.Mesh(geometry,material));}
  return texture;
 }
 set(project){
  this.project=project;if(!this.renderer)return;
  this.root.traverse(o=>{o.geometry?.dispose();for(const mat of(Array.isArray(o.material)?o.material:[o.material]))if(mat&&![...this.materials.values()].includes(mat)){if(mat.map&&![...this.textures.values()].includes(mat.map))mat.map.dispose();mat.dispose();}});this.root.clear();this.labels.replaceChildren();this.machines=[];this.belts=[];this.drones=new Map();
  const graph=project.graph;
  // Preserve the editor's layout; the third dimension belongs to the machines.
  const positions=new Map(graph.nodes.map(n=>[n.id,new T.Vector3(n.x/42,0,n.y/42)]));
  for(const n of graph.nodes){const p=positions.get(n.id),g=new T.Group();g.position.copy(p);g.userData.nodeId=n.id;this.root.add(g);const model=n.model||'Serverens standard',hash=[...model].reduce((v,c)=>(v*31+c.charCodeAt(0))>>>0,0),accent=new T.Color().setHSL((hash%360)/360,.55,.57).getHex();
   this.box(g,4.4,.5,3.6,0,.1,0,0x172c3c);this.box(g,4,.08,3.2,0,.4,0,0x496376);
   for(const x of[-1.65,1.65])for(const z of[-1.25,1.25])this.cylinder(g,.14,.6,x,.45,z,0x121d2b);
   const parts=[],rotors=[],doors=[];const deck=this.conveyor(g,new T.LineCurve3(new T.Vector3(-2.2,.88,0),new T.Vector3(2.2,.88,0)));
   for(const z of[-1.12,1.12]){this.box(g,3.6,.03,.18,0,.46,z,0xd7a13f);for(let i=0;i<9;i++){const stripe=this.box(g,.15,.035,.19,-1.6+i*.4,.48,z,0x172733);stripe.rotation.y=.45;}}
   const workLight=new T.Mesh(new T.BoxGeometry(.65,.08,.06),new T.MeshStandardMaterial({color:0x597d88,emissive:0x5be5b1,emissiveIntensity:0}));workLight.position.set(0,.64,1.53);g.add(workLight);
   if(n.type==='review'){
    this.reviewHall(g,doors);
   }else if(n.type==='analysis'){
    this.analysisHall(g,doors);
   }else if(n.type==='agent'){
    for(const x of[-1.4,.8])doors.push(this.shutter(g,x,1.75,.63,0x60798b));
    for(const z of[-.96,.96])this.box(g,2.2,1.25,.2,-.3,1.1,z);this.box(g,2.2,.95,2.1,-.3,2.04,0);this.box(g,1.5,.5,.06,-.3,2.03,1.08,accent);this.box(g,2.5,.16,2.4,-.3,2.6,0,0x60798b);for(let i=0;i<6;i++)this.box(g,.12,.43,.04,-1.15+i*.19,1.97,1.12,0x182f3e);
    if(n.access==='write'){const arm=new T.Group();arm.position.set(1.2,.55,-.55);g.add(arm);this.cylinder(arm,.45,.3,0,0,0,accent);const joint=this.box(arm,.28,1.25,.32,0,.7,0,0xa7bec9);this.box(arm,1.05,.24,.3,-.38,1.35,0,0xa7bec9);this.box(arm,.15,.5,.15,-.84,1.12,0,accent);parts.push({object:arm,kind:'arm',base:arm.rotation.y});}
    else{const scanner=this.box(g,2.3,.07,.1,-.3,1.2,1.14,0x66efd2);parts.push({object:scanner,kind:'scan',base:1.2});}
    const levels=['none','minimal','low','medium','high','xhigh','max','ultra'],count=n.reasoningEffort?Math.max(1,levels.indexOf(n.reasoningEffort)):1;for(let i=0;i<count;i++)this.box(g,.18,.22,.4,-1.2+i*.3,2.78,0,accent);
   }else if(n.type==='router'){
    this.cylinder(g,1.35,.3,0,1.3,0);const turn=new T.Group();turn.position.y=1.55;g.add(turn);this.cylinder(turn,1.13,.16,0,0,0,0xb28a58);this.box(turn,1.8,.14,.35,0,.16,0,0xffbf64);rotors.push(turn);
    const routes=n.routes||[{id:'out',name:'Automatisk'}];routes.forEach((r,i)=>{const z=(i-(routes.length-1)/2)*Math.min(.52,2.5/routes.length);this.box(g,.65,.25,.28,1.7,.6,z,0xc49a63);});
    this.box(g,.18,1.4,.18,-1.45,1.35,-1.1);this.box(g,1.15,.55,.16,-1.45,2.1,-1.1,accent);
   }else if(n.type==='condition'){
    for(const z of[-1.25,1.25])this.box(g,.3,2,.25,0,1.45,z,0x8dabc0);this.box(g,.5,.3,2.8,0,2.4,0);this.box(g,.7,.25,.1,-.6,2.4,.31,0x5be5b1);this.box(g,.7,.25,.1,.6,2.4,.31,0xff657b);const sensor=this.box(g,.15,1.7,.06,0,1.4,0,0x83d5ff);parts.push({object:sensor,kind:'gate',base:0});
   }else if(n.type==='text'){
    for(const x of[-1.2,1.2])doors.push(this.shutter(g,x,1.5,.48,0x60798b));
    for(const z of[-.85,.85])this.box(g,2.4,1.1,.2,0,1.05,z);this.box(g,2.4,.6,2,0,1.7,0);this.box(g,1.6,.1,1.2,0,1.8,-.4,0x99b4c1);const paper=this.box(g,1.4,.04,1.2,0,.75,1.1,0xe5efe9);parts.push({object:paper,kind:'paper',base:1.1});this.box(g,1.4,.16,.1,0,1.2,1.02,0x111e2a);
   }else if(n.type==='merge'){
    const hopper=new T.Mesh(new T.CylinderGeometry(1.25,.5,1.2,6),this.material(0x6a91a4));hopper.position.y=1.95;g.add(hopper);for(const z of[-.85,.85])this.box(g,1,1.1,.18,0,1,z);const mixer=this.box(g,2.3,.18,.2,0,2.6,0,0xffbf64);rotors.push(mixer);
   }else{
    this.terminal(g,n.type==='end',doors);
    const parcel=new T.Group();parcel.position.set(n.type==='end'?-1.85:1.85,1.27,0);g.add(parcel);this.box(parcel,.42,.5,.48,0,0,0,n.type==='end'?0x5abe9d:0xbd9465);this.box(parcel,.1,.52,.5,0,0,0,0x233e4d);parts.push({object:parcel,kind:'parcel',base:0,phase:0});
   }
   const beacon=new T.Mesh(new T.SphereGeometry(.16,12,8),new T.MeshBasicMaterial({color:COLORS.idle}));beacon.position.set(-1.7,.75,1.35);g.add(beacon);
   const label=make('button','factory-machine-label');label.type='button';label.dataset.nodeId=n.id;label.append(make('small','',TYPES[n.type]||n.type),make('strong','',n.name),make('span','machine-settings',n.type==='router'&&n.routingMode==='analysis'?'Følger inputanalyse':n.type==='review'||n.type==='analysis'||n.type==='agent'||n.type==='router'?model+' · '+(n.reasoningEffort||'standard reasoning'):n.type==='condition'?((n.rules?.length||0)+' regler'):n.type==='text'?'Skabelon → tekst':n.type==='merge'?'Samler indgående svar':n.type==='end'?'Færdigt resultat':'Opgavens start'),make('span','machine-state','Venter'));label.onclick=()=>this.select(n.id);this.labels.append(label);this.machines.push({node:n,group:g,position:p,label,parts,rotors,doors,beacon,deck,workLight});
  }
  const exits=new Map(),entrances=new Map();
  for(const machine of this.machines){
   const n=machine.node,outgoing=graph.edges.filter(e=>e.source===n.id),incoming=graph.edges.filter(e=>e.target===n.id);
   const ports=['analysis','router'].includes(n.type)?(n.routes||[{id:'out'}]).map(r=>r.id):n.type==='condition'?['yes','no']:n.type==='end'?[]:['out'];
   const slots=ports.flatMap(port=>{const edges=outgoing.filter(e=>e.port===port).sort((a,b)=>positions.get(a.target).z-positions.get(b.target).z);return edges.length?edges.map(edge=>({edge})):[{}];});
   if(slots.length>1)for(const bay of this.dock(machine,slots,'out'))if(bay.edge)exits.set(bay.edge,bay.point);
   if(incoming.length>1)for(const bay of this.dock(machine,incoming.sort((a,b)=>positions.get(a.source).z-positions.get(b.source).z).map(edge=>({edge})),'in'))entrances.set(bay.edge,bay.point);
  }
  for(const e of graph.edges){const a=positions.get(e.source),b=positions.get(e.target);if(!a||!b)continue;
   const from=exits.get(e)||a.clone().add(new T.Vector3(2.2,.88,0)),to=entrances.get(e)||b.clone().add(new T.Vector3(-2.2,.88,0));const bend=to.x>=from.x?Math.max(.25,(to.x-from.x)*.42):Math.max(1.2,Math.abs(to.x-from.x)*.42);const curve=new T.CubicBezierCurve3(from,from.clone().add(new T.Vector3(bend,0,0)),to.clone().add(new T.Vector3(-bend,0,0)),to);const length=curve.getLength(),count=Math.min(100,Math.max(8,Math.ceil(length/.6))),deck=this.conveyor(this.root,curve);
   const lineGeometry=new T.BufferGeometry().setFromPoints(curve.getPoints(Math.min(150,count*2)));const line=new T.Line(lineGeometry,new T.LineBasicMaterial({color:0x426478}));line.position.y=.12;this.root.add(line);
   const crate=this.box(this.root,.38,.38,.38,0,0,0,0xf0ba72);crate.visible=false;this.belts.push({edge:e,curve,line,crate,deck,used:false,flowing:false});
  }
  const bounds=new T.Box3().setFromObject(this.root),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());const floor=this.box(this.root,Math.max(size.x+12,20),.2,Math.max(size.z+12,14),center.x,-.25,center.z,0x101f2e);floor.material=new T.MeshStandardMaterial({color:0x8193a0,map:this.texture('floor').clone(),roughness:.95});floor.material.map.repeat.set(Math.max(size.x+12,20)/2,Math.max(size.z+12,14)/2);floor.material.map.needsUpdate=true;this.bounds=bounds;this.fit();this.setLive(this.live);this.select(graph.nodes.find(n=>n.id===project.startNodeId)?.id);
 }
 select(id){this.selected=id;for(const m of this.machines)m.label.classList.toggle('selected',m.node.id===id);const m=this.machines.find(m=>m.node.id===id);if(m)this.onSelect(m.node,this.live);this.render();}
 fit(){if(!this.bounds)return;if(!this.host.clientWidth||!this.host.clientHeight){this.needsFit=true;return;}this.needsFit=false;const center=this.bounds.getCenter(new T.Vector3()),size=this.bounds.getSize(new T.Vector3());this.controls.target.copy(center);this.camera.position.copy(center).add(new T.Vector3(16,26,32));this.camera.zoom=1;this.camera.lookAt(center);this.camera.updateMatrixWorld();const view=this.camera.matrixWorldInverse,projected=new T.Box3();for(const x of[this.bounds.min.x,this.bounds.max.x])for(const y of[0,this.machines.some(m=>m.node.type==='review')?7.5:5])for(const z of[this.bounds.min.z,this.bounds.max.z])projected.expandByPoint(new T.Vector3(x,y,z).applyMatrix4(view));const projectedSize=projected.getSize(new T.Vector3()),aspect=Math.max(.4,this.host.clientWidth/(this.host.clientHeight||620));this.span=Math.max(6,projectedSize.y/2,projectedSize.x/2/aspect)*1.22+1.5;this.size();this.controls.update();}
 size(){if(!this.renderer||!this.host.clientWidth||!this.host.clientHeight)return;if(this.needsFit&&this.bounds){this.fit();return;}const w=this.host.clientWidth,h=this.host.clientHeight,aspect=w/h,span=this.span||20;this.camera.left=-span*aspect;this.camera.right=span*aspect;this.camera.top=span;this.camera.bottom=-span;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);this.render();}
 setLive(live){this.live=live;if(!this.renderer)return;this.playback.update(live);this.updateVisuals();const m=this.machines.find(m=>m.node.id===this.selected);if(m)this.onSelect(m.node,live);this.schedule();}
 updateVisuals(){
  this.syncDrones();
  const nodes=this.motion.matches?this.live.nodes:this.playback.nodes;
  for(const m of this.machines)for(const door of m.doors)door.target=this.motion.matches?0:Math.max(0,...this.playback.transfers.filter(t=>t.transport!=='drone'&&(door.side==='in'?t.target===m.node.id:t.source===m.node.id)&&(door.edge===undefined||(door.edge&&t.source===door.edge.source&&t.target===door.edge.target&&t.port===door.edge.port))).map(t=>door.side==='in'?T.MathUtils.smoothstep(t.progress,.55,.75):1-T.MathUtils.smoothstep(t.progress,.25,.45)));
  for(const m of this.machines){let state=nodes[m.node.id]||'idle';const review=this.motion.matches?(this.live.events||[]).findLast(e=>e.type==='review'&&e.nodeId===m.node.id):null;const changes=this.motion.matches?review&&!review.approved:this.playback.reviews[m.node.id]==='changes';if(state==='completed'&&changes)state='revision';m.label.dataset.state=state;m.label.querySelector('.machine-state').textContent=STATUS[state]||state;m.beacon.material.color.setHex(COLORS[state]||COLORS.idle);}
  for(const b of this.belts){const e=b.edge;b.used=this.live.ports?this.live.ports.has(e.source+':'+e.port+'>'+e.target):this.live.edges?.has(e.source+'>'+e.target);const transfer=this.playback.transfers.find(t=>t.source===e.source&&t.port===e.port&&t.target===e.target);b.flowing=!!transfer&&!this.motion.matches;b.line.material.color.setHex(b.used?0x60e7bb:0x426478);b.crate.visible=b.flowing;if(b.flowing){const p=b.curve.getPoint(transfer.progress),v=b.curve.getTangent(transfer.progress);b.crate.position.copy(p).add(new T.Vector3(0,.25,0));b.crate.rotation.y=-Math.atan2(v.z,v.x);}}
 }
 schedule(){cancelAnimationFrame(this.frame);this.frame=0;this.lastTime=null;this.updateVisuals();this.animate(0);this.render();if(this.visible&&!document.hidden&&!this.motion.matches&&(this.playback.pending||this.machines.some(m=>m.doors.some(d=>d.open>0))))this.frame=requestAnimationFrame(t=>this.tick(t));}
 animate(t,delta=0){for(const drone of this.drones.values())if(drone.group.visible)for(const rotor of drone.rotors)rotor.rotation.y=t*40;for(const b of this.belts)if(b.flowing)b.deck.offset.x=-t*1.8;for(const m of this.machines){const active=!this.motion.matches&&this.playback.nodes[m.node.id]==='running';m.workLight.material.emissiveIntensity=active?1.2+Math.sin(t*7)*.6:0;m.deck.offset.x=active?-t*1.8:0;for(const door of m.doors){if(this.motion.matches)door.open=0;else door.open=T.MathUtils.clamp(door.open+T.MathUtils.clamp(door.target-door.open,-delta/90,delta/90),0,1);door.object.scale.y=Math.max(.015,1-door.open);door.object.position.y=door.top-door.height*door.object.scale.y/2;}for(const r of m.rotors)r.rotation.y=active?t:0;for(const p of m.parts){if(p.kind==='arm')p.object.rotation.y=p.base+(active?Math.sin(t*2)*.65:0);if(p.kind==='scan')p.object.position.y=p.base+(active?Math.sin(t*3)*.45:0);if(p.kind==='gate')p.object.position.x=active?Math.sin(t*2):0;if(p.kind==='paper')p.object.position.z=p.base+(active?(t%1)*.5:0);if(p.kind==='parcel'){p.object.position.z=p.base+(active?Math.sin(t*4+p.phase)*.28:0);p.object.position.y=1.27+(active?Math.abs(Math.sin(t*4+p.phase))*.14:0);}}m.beacon.scale.setScalar(active?1+Math.sin(t*4)*.15:1);}}
 tick(time){const delta=this.lastTime===null?0:Math.min(100,time-this.lastTime);this.lastTime=time;this.playback.advance(delta);this.updateVisuals();this.animate(time/1000,delta);this.render();this.frame=0;if(this.visible&&!document.hidden&&!this.motion.matches&&(this.playback.pending||this.machines.some(m=>m.doors.some(d=>d.open>0))))this.frame=requestAnimationFrame(t=>this.tick(t));}
 render(){
  if(!this.renderer||!this.host.clientWidth)return;this.renderer.render(this.scene,this.camera);this.host.classList.toggle('factory-compact',this.host.clientWidth/Math.max(1,this.machines.length)<220);
  const labels=this.machines.map(m=>{const p=m.position.clone().add(new T.Vector3(0,m.node.type==='analysis'?4.1:3.25,0)).project(this.camera);m.label.hidden=p.z>1||p.z< -1||Math.abs(p.x)>1.2||Math.abs(p.y)>1.3;return{m,x:(p.x+1)*this.host.clientWidth/2,y:(-p.y+1)*this.host.clientHeight/2};}).filter(p=>!p.m.label.hidden).sort((a,b)=>a.x-b.x),placed=[];
  for(const item of labels){const label=item.m.label,w=label.offsetWidth,h=label.offsetHeight;const x=Math.max(w/2+8,Math.min(this.host.clientWidth-w/2-8,item.x)),y=Math.max(h+8,item.y);label.style.left=x+'px';label.style.top=y+'px';}
 }
 diagnostics(){return{webgl:!!this.renderer,machines:this.machines.length,belts:this.belts.length,airborne:[...this.drones.values()].filter(d=>d.group.visible).map(d=>({source:d.source,target:d.target,progress:d.progress})),flowing:this.belts.filter(b=>b.flowing).map(b=>b.edge),active:this.playback.active,queued:this.playback.queue.length,reducedMotion:this.motion.matches,drawCalls:this.renderer?.info.render.calls};}
}
