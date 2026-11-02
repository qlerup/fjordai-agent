const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {validateGraph,runGraph,legacyGraph,evaluateCondition,buildDynamicGraph}=require('../src/graph.cjs');
const start={id:'s',type:'start',name:'Start'},end={id:'e',type:'end',name:'Slut'};
const agent=id=>({id,type:'agent',name:id,instructions:'Do '+id,access:'read',model:''});
const edge=(source,target,port='out')=>({source,target,port});
class Fake extends EventEmitter{constructor(choice){super();this.choice=choice;this.calls=[];this.i=0;}async rpc(method,p){if(method==='thread/start'){this.calls.push(p);return{thread:{id:'t'+(++this.i)}};}if(method==='turn/start'){setImmediate(()=>{const text=p.outputSchema?JSON.stringify({targets:this.choice,reason:'Chosen'}):'answer '+this.i;this.emit('message',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',text}}});this.emit('message',{method:'turn/completed',params:{threadId:p.threadId,turn:{status:'completed'}}});});return{turn:{id:'turn'}};}}}
function conditionGraph(){return{nodes:[start,{id:'c',type:'condition',name:'Kode?',match:'all',rules:[{source:'prompt',op:'contains',value:'kode'}]},agent('yes'),agent('no'),{id:'m',type:'merge',name:'Saml'},end],edges:[edge('s','c'),edge('c','yes','yes'),edge('c','no','no'),edge('yes','m'),edge('no','m'),edge('m','e')]};}
test('graph validation rejects cycles, disconnected nodes and missing condition branches',()=>{assert.doesNotThrow(()=>validateGraph(conditionGraph()));const g=legacyGraph([{name:'A',instructions:'a',access:'read'}]);g.edges.push(edge('agent-0','agent-0'));assert.throws(()=>validateGraph(g));const d=conditionGraph();d.nodes.push(agent('orphan'));assert.throws(()=>validateGraph(d),/forbundet/);const c=conditionGraph();c.edges=c.edges.filter(e=>e.port!=='no');assert.throws(()=>validateGraph(c));});
test('AND and OR rules evaluate prompt and previous results without executing code',()=>{const n={match:'all',rules:[{source:'prompt',op:'contains',value:'KODE'},{source:'input',op:'notContains',value:'fejl'}]};assert.equal(evaluateCondition(n,'Ret kode','alt godt'),true);assert.equal(evaluateCondition(n,'Ret kode','fejl'),false);n.match='any';assert.equal(evaluateCondition(n,'Ret kode','fejl'),true);});
test('only the selected condition branch executes and shared merge runs once',async()=>{const c=new Fake(),events=[];const r=await runGraph({workflow:{graph:conditionGraph()},codex:c,prompt:'ret KODE',cwd:'/tmp',emit:e=>events.push(e)});assert.deepEqual(r.map(a=>a.name),['yes']);assert.equal(c.calls.length,1);assert.deepEqual(events.find(e=>e.type==='node-completed'&&e.nodeId==='c').targets,['yes']);assert.equal(events.filter(e=>e.type==='node-started'&&e.nodeId==='m').length,1);});
test('router can only send work to directly wired nodes',async()=>{const graph={nodes:[start,{id:'r',type:'router',name:'Fordeler',instructions:'Route',model:'small'},agent('a'),agent('b'),end],edges:[edge('s','r'),edge('r','a'),edge('r','b'),edge('a','e'),edge('b','e')]};const c=new Fake(['b']);const r=await runGraph({workflow:{graph},codex:c,prompt:'task',cwd:'/tmp',emit:()=>{}});assert.deepEqual(r.map(a=>a.name),['b']);assert.equal(c.calls[0].model,'small');await assert.rejects(runGraph({workflow:{graph},codex:new Fake(['unwired']),prompt:'task',cwd:'/tmp',emit:()=>{}}),/uden tilladt/);});
test('selected project start gates execution and unconnected branch context does not leak',async()=>{const graph={nodes:[{id:'left',type:'start',name:'Left'},{id:'right',type:'start',name:'Right'},agent('a'),agent('b'),end],edges:[edge('left','a'),edge('right','b'),edge('a','e'),edge('b','e')]};const r=await runGraph({workflow:{graph},startNodeId:'right',codex:new Fake(),prompt:'x',cwd:'/tmp',emit:()=>{}});assert.deepEqual(r.map(a=>a.name),['b']);});
test('existing project/workflow data migrates into one project graph without duplication',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Store}=require('../src/store.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjordagent-graph-migration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({projects:[{id:'p',name:'My project',workflowId:'w'}],workflows:[{id:'w',name:'My workflow',steps:[{name:'Specialist',access:'read',instructions:'do work'}]},{id:'unbound',name:'Other setup',steps:[{name:'Other',access:'read',instructions:'other'}]}],runs:[]}));
 const first=new Store(dir);assert.equal(first.state.projects.length,2);assert.equal(first.state.projects[0].graph.nodes.find(n=>n.type==='agent').name,'Specialist');assert.equal(first.state.projects[0].workflowId,undefined);assert.equal(first.state.projects[0].startNodeId,'start');assert.equal(new Store(dir).state.projects.length,2);
});
test('numeric conditions use the incoming value rather than formatted context labels',async()=>{const graph={nodes:[start,{id:'value',type:'text',name:'Value',template:'{{prompt}}'},{id:'c',type:'condition',name:'Number?',match:'all',rules:[{source:'input',op:'greater',value:'3'}]},agent('yes'),agent('no'),end],edges:[edge('s','value'),edge('value','c'),edge('c','yes','yes'),edge('c','no','no'),edge('yes','e'),edge('no','e')]};const r=await runGraph({workflow:{graph},codex:new Fake(),prompt:'5',cwd:'/tmp',emit:()=>{}});assert.deepEqual(r.map(a=>a.name),['yes']);});

// Connectionless teams are opt-in; the saved manual topology is never overwritten.
test('dynamic workflows allow disconnected specialists and synthesize a temporary route',()=>{
 const saved={executionMode:'dynamic',maxActiveAgents:2,nodes:[start,agent('frontend'),agent('backend'),end],edges:[]};
 assert.doesNotThrow(()=>validateGraph(saved));
 assert.throws(()=>validateGraph({...saved,executionMode:'manual'}),/forbundet|Forbind/);
 const original=JSON.stringify(saved);
 const runtime=buildDynamicGraph(validateGraph(saved),'s');
 assert.doesNotThrow(()=>validateGraph(runtime));
 assert.equal(runtime.edges.filter(e=>e.source==='s').length,1);
 assert.equal(runtime.edges.filter(e=>e.target==='frontend').length,1);
 assert.equal(runtime.edges.filter(e=>e.target==='backend').length,1);
 assert.equal(JSON.stringify(saved),original);
});
test('dynamic team chooses only required agents and returns a combined output',async()=>{
 const graph={executionMode:'dynamic',maxActiveAgents:1,nodes:[start,agent('frontend'),agent('backend'),end],edges:[]};
 const c=new Fake(['backend']),events=[];
 const result=await runGraph({workflow:{graph},codex:c,prompt:'Build API',cwd:'/tmp',emit:e=>events.push(e)});
 assert.deepEqual(result.filter(r=>r.nodeId==='frontend'||r.nodeId==='backend').map(r=>r.nodeId),['backend']);
 assert.equal(result.at(-1).name,'Fælles resultat');
 assert.match(result.at(-1).text,/backend:/);
 assert.ok(events.some(e=>e.type==='branch'&&e.targets.includes('backend')));
 assert.equal(graph.edges.length,0);
 await assert.rejects(runGraph({workflow:{graph},codex:new Fake(['frontend','backend']),prompt:'Build API',cwd:'/tmp',emit:()=>{}}),/uden tilladt forbindelse|ugyldig/);
});
test('dynamic mode rejects unsupported nodes, limits and ambiguous orchestrators',()=>{
 const graph={executionMode:'dynamic',maxActiveAgents:4,nodes:[start,agent('a'),end],edges:[]};
 assert.throws(()=>validateGraph({...graph,maxActiveAgents:20}),/1–16/);
 assert.throws(()=>validateGraph({...graph,nodes:[...graph.nodes,{id:'t',type:'text',name:'Text',template:'x'}]}),/Dynamisk team/);
 const router=id=>({id,type:'router',name:id,instructions:'Route',routingMode:'ai',access:'read'});
 assert.throws(()=>validateGraph({...graph,nodes:[...graph.nodes,router('r1'),router('r2')]}),/højst én Fordeler/);
});
