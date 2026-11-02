const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {runGraph,validateGraph}=require('../src/graph.cjs');
function graph(){return{nodes:[{id:'s',type:'start',name:'Start'},{id:'a',type:'analysis',name:'Inputanalyse',instructions:'Understand only',model:'test'},{id:'r',type:'router',name:'Fordeler',instructions:'Route',routingMode:'analysis',routeMode:'one',routes:[{id:'image',name:'Billede',rule:'Create images'},{id:'text',name:'Tekst',rule:'Answer text'}]},{id:'image',type:'agent',name:'Billedagent',instructions:'Generate image',access:'read'},{id:'text',type:'agent',name:'Tekstagent',instructions:'Answer',access:'read'},{id:'e',type:'end',name:'Svar'}],edges:[['s','a'],['a','r'],['r','image','image'],['r','text','text'],['image','e'],['text','e']].map(([source,target,port='out'])=>({source,target,port}))};}
class Fake extends EventEmitter{constructor(port='image'){super();this.port=port;this.threads=[];this.turns=[];}async rpc(method,p){if(method==='thread/start'){this.threads.push(p);return{thread:{id:'t'+this.threads.length}};}if(method==='turn/start'){this.turns.push(p);const text=p.outputSchema?JSON.stringify({summary:'The user wants a cartoon bird',intent:'image generation',decisions:p.outputSchema.properties.decisions.items.properties.routerId.enum.map(routerId=>({routerId,ports:typeof this.port==='object'&&!Array.isArray(this.port)?this.port[routerId]:Array.isArray(this.port)?this.port:[this.port]}))}):'Done';setImmediate(()=>{this.emit('message',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',text}}});this.emit('message',{method:'turn/completed',params:{threadId:p.threadId,turn:{status:'completed'}}});});return{turn:{id:'turn'}};}return{};}}
test('input analysis classifies once and deterministic router performs no AI call',async()=>{
 const c=new Fake(),events=[],g=validateGraph(graph());assert.equal(g.nodes[1].access,'read');
 const result=await runGraph({workflow:{graph:g},codex:c,cwd:'/tmp',prompt:'Draw a bird',emit:e=>events.push(e)});
 assert.deepEqual(result.map(a=>a.name),['Billedagent']);assert.equal(c.threads.length,2);assert.equal(c.threads[0].config['features.image_generation'],false);assert.equal(c.threads[0].sandbox,'read-only');assert.match(c.threads[0].developerInstructions,/Udfør ikke selve opgaven/);
 assert.ok(!events.some(e=>e.type==='delta'&&e.text.includes('routerId')));assert.ok(!events.some(e=>e.type==='step'&&e.name==='Fordeler'));assert.deepEqual(events.find(e=>e.type==='branch').ports,['image']);
});
test('invalid classifications and missing analysis fail before executing a recipient',async()=>{
 const c=new Fake('unwired');await assert.rejects(runGraph({workflow:{graph:graph()},codex:c,cwd:'/tmp',prompt:'x',emit:()=>{}}),/ugyldig udgang/);assert.equal(c.threads.length,1);
 const g=graph();g.nodes=g.nodes.filter(n=>n.id!=='a');g.edges=g.edges.filter(e=>e.source!=='a'&&e.target!=='a');g.edges.push({source:'s',target:'r',port:'out'});
 const none=new Fake();await assert.rejects(runGraph({workflow:{graph:g},codex:none,cwd:'/tmp',prompt:'x',emit:()=>{}}),/Inputanalyse/);assert.equal(none.threads.length,0);
});
function directGraph(){const g=graph(),router=g.nodes.find(n=>n.id==='r'),analysis=g.nodes.find(n=>n.id==='a');analysis.routes=router.routes;analysis.routeMode='one';g.nodes=g.nodes.filter(n=>n.id!=='r');g.edges=g.edges.filter(e=>!(e.source==='a'&&e.target==='r')).map(e=>e.source==='r'?{...e,source:'a'}:e);return g;}
test('input analysis selects its own output directly without a router node or extra AI turn',async()=>{
 const c=new Fake(),events=[],result=await runGraph({workflow:{graph:directGraph()},codex:c,cwd:'/tmp',prompt:'Draw a bird',emit:e=>events.push(e)});
 assert.deepEqual(result.map(a=>a.name),['Billedagent']);assert.equal(c.threads.length,2);assert.deepEqual(events.find(e=>e.type==='node-completed'&&e.nodeId==='a').edges,[{port:'image',target:'image'}]);assert.ok(!events.some(e=>e.type==='node-started'&&e.nodeId==='text'));
});
test('direct analysis supports multiple chosen outputs and multiple receivers on one output',async()=>{
 const g=directGraph();g.nodes.find(n=>n.id==='a').routeMode='multiple';const c=new Fake(['image','text']);const result=await runGraph({workflow:{graph:g},codex:c,cwd:'/tmp',prompt:'Both',emit:()=>{}});assert.deepEqual(result.map(a=>a.name),['Billedagent','Tekstagent']);assert.equal(c.threads.length,3);
 const shared=directGraph();shared.nodes.find(n=>n.id==='a').routes=shared.nodes.find(n=>n.id==='a').routes.filter(r=>r.id==='image');shared.edges.find(e=>e.source==='a'&&e.target==='text').port='image';const both=await runGraph({workflow:{graph:shared},codex:new Fake(),cwd:'/tmp',prompt:'Both',emit:()=>{}});assert.equal(both.length,2);
});
test('direct analysis rejects invalid ports and preserves optional downstream routers',async()=>{
 const c=new Fake('unwired');await assert.rejects(runGraph({workflow:{graph:directGraph()},codex:c,cwd:'/tmp',prompt:'x',emit:()=>{}}),/ugyldig udgang/);assert.equal(c.threads.length,1);
 const g=graph();g.nodes.find(n=>n.id==='a').routes=[{id:'out',name:'Videre',rule:''}];const later=new Fake({a:['out'],r:['image']});const result=await runGraph({workflow:{graph:g},codex:later,cwd:'/tmp',prompt:'Bird',emit:()=>{}});assert.deepEqual(result.map(a=>a.name),['Billedagent']);assert.equal(later.threads.length,2);
 const invalid=directGraph();invalid.edges.find(e=>e.source==='a').port='missing';assert.throws(()=>validateGraph(invalid),/Ugyldig forbindelse/);
});
