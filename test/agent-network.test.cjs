const {test}=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../public/agent-network.mjs');

test('dynamic map includes the exact virtual runtime coordination nodes',async()=>{
 const {agentNetworkStations}=await load();
 const project={startNodeId:'s',graph:{nodes:[{id:'s',type:'start',name:'Start'},...Array.from({length:13},(_,i)=>({id:'worker-'+i,type:'agent',name:'Agent '+i})),{id:'review',type:'review',name:'Reviewer'},{id:'end',type:'end',name:'Resultat'}]}};
 const stations=agentNetworkStations(project),ids=new Set(stations.map(s=>s.node.id));
 assert.equal(stations.length,18);
 assert.ok(ids.has('__fjord_team_router'));
 assert.ok(ids.has('__fjord_team_merge'));
 assert.ok(ids.has('worker-12'));
 assert.ok(ids.has('review'));
 assert.equal(stations.find(s=>s.node.id==='__fjord_team_router').internal,true);
 assert.equal(new Set(stations.map(s=>s.x+':'+s.z)).size,stations.length);
 assert.equal(project.graph.nodes.length,16,'source graph must be unchanged');
});

test('explicit orchestrator wins over virtual router and user coordinates are untouched',async()=>{
 const {agentNetworkStations}=await load();
 const project={startNodeId:'s',graph:{nodes:[{id:'s',type:'start',name:'Start',x:25,y:90},{id:'r',type:'router',name:'Custom Orchestrator',x:600,y:500},{id:'a',type:'agent',name:'Worker',x:300,y:200}]}};
 const result=agentNetworkStations(project);
 assert.ok(result.some(x=>x.node.id==='r'));
 assert.ok(!result.some(x=>x.node.id==='__fjord_team_router'));
 assert.equal(project.graph.nodes[1].x,600);
});

test('signals are created only for real agent-to-agent events with recipients',async()=>{
 const {agentSignal}=await load();
 assert.deepEqual(agentSignal({type:'team',kind:'message',from:'backend',to:'frontend'}),{source:'backend',target:'frontend',kind:'message',transport:'signal',port:'team-message',progress:0});
 assert.equal(agentSignal({type:'team',kind:'assignment',from:'orchestrator'}),null);
 assert.equal(agentSignal({type:'team',kind:'result',from:'backend'}),null);
 assert.equal(agentSignal({type:'team',kind:'message',from:'backend'}),null);
 assert.equal(agentSignal({type:'notice',text:'hello'}),null);
});
