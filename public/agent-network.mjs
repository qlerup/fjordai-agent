// Dynamic-workflow view only. These are display stations, not saved workflow edges.
// Keep virtual identifiers synchronized with buildDynamicGraph in src/graph.cjs.
export function agentNetworkStations(project){
 const graph=project.graph||{nodes:[]},nodes=graph.nodes||[];
 const take=type=>nodes.find(n=>n.type===type);
 const start=nodes.find(n=>n.type==='start'&&n.id===project.startNodeId)||take('start');
 const router=take('router')||{id:'__fjord_team_router',type:'router',name:'Orchestrator',instructions:'Automatisk fordeling',model:'',access:'read'};
 const merge={id:'__fjord_team_merge',type:'merge',name:'Samler resultater'};
 const review=take('review'),end=take('end')||{id:'__fjord_team_end',type:'end',name:'Resultat'};
 const stations=[];
 const push=(node,x,z,internal=false)=>{if(node)stations.push({node,x,z,internal});};
 push(start,-13,0);push(router,0,0,!take('router'));
 const agents=nodes.filter(n=>n.type==='agent');
 for(let i=0;i<agents.length;i++){
  const ring=Math.floor(i/12),offset=ring*12,count=Math.min(12,agents.length-offset);
  const angle=(i-offset+.5)*Math.PI*2/count+Math.PI/2;
  const radius=14+ring*10;
  push(agents[i],Math.cos(angle)*radius,Math.sin(angle)*radius);
 }
 push(merge,14,0,true);push(review,22,0);push(end,review?30:22,0,!take('end'));
 return stations;
}
export function agentSignal(event){
 if(event?.type!=='team')return null;
 const modes={'message':'signal','task-request':'drone','task':'drone','task-completed':'signal'};
 const transport=modes[event.kind];
 if(!transport||typeof event.from!=='string'||typeof event.to!=='string')return null;
 return{source:event.from,target:event.to,kind:event.kind,transport,port:'team-'+event.kind,progress:0};
}
