import {agentNetworkStations} from './agent-network.mjs';

const ROLE_COLORS={router:0x57c9ff,agent:0x42e9d0,review:0xf5c473,start:0x93aafe,merge:0xca99ff,end:0x7ef3ac};
const STATES={idle:'Klar',running:'Arbejder',completed:'Færdig',revision:'Rettelser',failed:'Fejl',interrupted:'Stoppet'};
const COLORS={idle:0x517e9a,running:0xffc979,completed:0x56ebaf,revision:0xffc979,failed:0xff677d,interrupted:0xc1a1fb};
const dom=(tag,cls,content)=>{const el=document.createElement(tag);el.className=cls;if(content!==undefined)el.textContent=content;return el;};
const roleColor=n=>ROLE_COLORS[n.type]||ROLE_COLORS.agent;

export function buildAgentNetwork(factory,project,T){
 const f=factory;f.networkMode=true;f.playback.networkMode=true;f.networkSignals=new Map();
 const stations=agentNetworkStations(project);
 const radius=Math.max(44,...stations.map(s=>Math.hypot(s.x,s.z)+8));
 const floor=new T.Mesh(new T.CircleGeometry(radius,96),new T.MeshStandardMaterial({color:0x091a2b,metalness:.22,roughness:.94}));
 floor.rotation.x=-Math.PI/2;floor.position.y=-.35;f.root.add(floor);
 const grid=new T.GridHelper(radius*2,Math.min(100,Math.round(radius*2)),0x245570,0x19364d);
 grid.position.y=-.30;grid.material.transparent=true;grid.material.opacity=.32;f.root.add(grid);
 for(const r of [7,14,23,32]){const circle=new T.Mesh(new T.TorusGeometry(r,.027,6,96),new T.MeshBasicMaterial({color:0x1c596d,transparent:true,opacity:.24}));
  circle.rotation.x=Math.PI/2;circle.position.y=-.27;f.root.add(circle);
 }
 const byId=new Map();
 for(const station of stations){
  const n=station.node,c=roleColor(n),g=new T.Group(),p=new T.Vector3(station.x,0,station.z);g.position.copy(p);g.userData.nodeId=n.id;f.root.add(g);
  f.cylinder(g,1.9,.26,0,-.02,0,0x173146);
  f.cylinder(g,1.48,.14,0,.24,0,0x30526a);
  const stand=new T.Mesh(new T.CylinderGeometry(.66,.92,1.3,32),new T.MeshStandardMaterial({color:0x163548,metalness:.7,roughness:.28}));
  stand.position.y=1.03;g.add(stand);
  const ring=new T.Mesh(new T.TorusGeometry(1.52,.075,8,48),new T.MeshBasicMaterial({color:c,transparent:true,opacity:.58}));
  ring.rotation.x=Math.PI/2;ring.position.y=.46;g.add(ring);
  const halo=new T.Mesh(new T.TorusGeometry(.84,.048,8,48),new T.MeshBasicMaterial({color:c,transparent:true,opacity:.74}));
  halo.rotation.x=Math.PI/2;halo.position.y=2.16;g.add(halo);
  const core=new T.Mesh(n.type==='router'?new T.IcosahedronGeometry(.73,1):n.type==='review'?new T.OctahedronGeometry(.7):new T.IcosahedronGeometry(.53,1),
   new T.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:.30,metalness:.35,roughness:.22}));
  core.position.y=2.22;g.add(core);
  for(const x of[-.88,.88])for(const z of[-.88,.88]){const led=new T.Mesh(new T.SphereGeometry(.10,8,8),new T.MeshBasicMaterial({color:c}));
   led.position.set(x,.33,z);g.add(led);}
  const beacon=new T.Mesh(new T.SphereGeometry(.21,12,10),new T.MeshBasicMaterial({color:COLORS.idle}));beacon.position.set(1.42,.55,0);g.add(beacon);
  const light=new T.PointLight(c,.0,6,2);light.position.y=2.5;g.add(light);
  const workLight={material:{emissiveIntensity:0}};
  const label=dom('button','factory-machine-label network-station-label');label.type='button';label.dataset.nodeId=n.id;
  label.append(dom('small','',n.type==='router'?'KOORDINERING':n.type==='agent'?'SPECIALIST':n.type==='review'?'KVALITETSSIKRING':n.type==='merge'?'RESULTATER':n.type==='start'?'START':'LEVERING'),
   dom('strong','',n.name),dom('span','machine-settings',(n.model||'Codex-standard')+(n.access==='write'?' · Skriveadgang':'')),
   dom('span','machine-state','Klar'));
  label.onclick=()=>f.select(n.id);f.labels.append(label);
  const machine={node:n,group:g,position:p,label,parts:[],rotors:[],doors:[],beacon,workLight,ring,halo,core,light,internal:station.internal};
  f.machines.push(machine);byId.set(n.id,machine);
 }
 f.networkById=byId;
 // Faint lines show possible team membership, not actual messages.
 const hub=byId.get(stations.find(s=>s.node.type==='router')?.node.id);
 if(hub)for(const m of f.machines.filter(x=>x.node.type==='agent')){
  const from=hub.position.clone().add(new T.Vector3(0,.25,0)),to=m.position.clone().add(new T.Vector3(0,.25,0));
  const line=new T.Line(new T.BufferGeometry().setFromPoints([from,to]),new T.LineBasicMaterial({color:0x2b7592,transparent:true,opacity:.17}));
  f.root.add(line);
 }
 f.bounds=new T.Box3().setFromObject(f.root);
 f.fit();f.setLive(f.live);f.select(project.startNodeId||stations[0]?.node.id);
}

function signalColor(t){
 if(t.port==='revision')return 0xf2a1fb;
 if(t.transport==='drone')return 0xffbd72;
 if(t.transport==='signal')return 0x66d7ff;
 return 0x66f0bb;
}
function createSignal(f,transfer,T){
 const a=f.networkById.get(transfer.source),b=f.networkById.get(transfer.target);
 if(!a||!b||a===b)return null;
 const from=a.position.clone().add(new T.Vector3(0,2.5,0)),to=b.position.clone().add(new T.Vector3(0,2.5,0));
 const lift=Math.max(2.0,Math.min(7,from.distanceTo(to)*.21));
 const mid=from.clone().lerp(to,.5).add(new T.Vector3(0,lift,0));
 const curve=new T.QuadraticBezierCurve3(from,mid,to),color=signalColor(transfer);
 const material=new T.LineBasicMaterial({color,transparent:true,opacity:.67});
 const line=new T.Line(new T.BufferGeometry().setFromPoints(curve.getPoints(56)),material);f.root.add(line);
 const size=transfer.transport==='drone'?.38:.25;
 const body=new T.Mesh(transfer.transport==='drone'?new T.BoxGeometry(size,size,size):new T.SphereGeometry(size,14,10),
  new T.MeshBasicMaterial({color}));
 const glow=new T.Mesh(new T.SphereGeometry(size*1.8,12,8),new T.MeshBasicMaterial({color,transparent:true,opacity:.18,depthWrite:false,blending:T.AdditiveBlending}));
 const marker=new T.Group();marker.add(body,glow);f.root.add(marker);
 return{line,marker,curve,source:transfer.source,target:transfer.target,transport:transfer.transport,kind:transfer.kind||transfer.port,progress:0};
}
export function syncAgentNetwork(factory,T){
 const f=factory,active=new Set();
 for(const transfer of f.playback.transfers){
  const key=[transfer.source,transfer.target,transfer.port||'',transfer.transport||'package'].join(':');
  active.add(key);let stream=f.networkSignals.get(key);
  if(!stream){stream=createSignal(f,transfer,T);if(!stream)continue;f.networkSignals.set(key,stream);}
  stream.marker.visible=!f.motion.matches;stream.line.visible=true;
  stream.line.material.opacity=f.motion.matches?.55:.72;
  stream.progress=transfer.progress;stream.marker.position.copy(stream.curve.getPoint(transfer.progress));
 }
 for(const [key,stream] of f.networkSignals){
  if(active.has(key))continue;
  stream.marker.visible=false;
  stream.line.visible=true;
  stream.line.material.opacity=.07;
 }
 // Keep replay/long-running workflows from accumulating unbounded geometry.
 while(f.networkSignals.size>90){const [key,stream]=f.networkSignals.entries().next().value;if(active.has(key))break;
  f.root.remove(stream.line,stream.marker);stream.line.geometry.dispose();stream.line.material.dispose();
  stream.marker.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});f.networkSignals.delete(key);
 }
 const nodes=f.motion.matches?f.live.nodes:f.playback.nodes;
 for(const m of f.machines){
  const id=m.node.id,escalated=f.motion.matches?(f.live.events||[]).findLast(e=>e.type==='review-escalated'&&e.nodeId===id):f.playback.escalations[id];
  let state=nodes[id]||'idle';
  const changed=f.motion.matches?(f.live.events||[]).findLast(e=>e.type==='review'&&e.nodeId===id&&!e.approved):f.playback.reviews[id]==='changes';
  if(state==='completed'&&changed)state='revision';
  m.label.dataset.state=state;
  const model=typeof escalated==='string'?escalated:escalated?.model;
  m.label.querySelector('.machine-state').textContent=model?'Ekstra review · '+model:STATES[state]||state;
  m.beacon.material.color.setHex(COLORS[state]||COLORS.idle);
  m.core.material.emissiveIntensity=state==='running'?1.0:state==='completed'?.5:.25;
  m.light.intensity=state==='running'?1.0:0;
 }
}
export function animateAgentNetwork(factory,time,T){
 const f=factory,nodes=f.motion.matches?f.live.nodes:f.playback.nodes;
 for(const m of f.machines){
  const active=nodes[m.node.id]==='running';
  const phase=time*(active?1.6:.20);
  m.core.rotation.y=phase;m.core.position.y=2.22+(f.motion.matches?0:Math.sin(time*(active?3:1.1)+m.position.x)*.07);
  m.halo.rotation.z=f.motion.matches?0:phase*.35;
  m.ring.material.opacity=active?.97:Math.max(.24,.5+(f.motion.matches?0:Math.sin(time*2+m.position.z)*.12));
  m.workLight.material.emissiveIntensity=active?1:0;
 }
 for(const stream of f.networkSignals.values())if(stream.marker.visible)stream.marker.rotation.y=time*2;
}
