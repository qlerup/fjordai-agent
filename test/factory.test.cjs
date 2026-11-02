const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {validateGraph,runGraph}=require('../src/graph.cjs');
const edge=(source,target,port='out')=>({source,target,port});
const agent=id=>({id,name:id,type:'agent',instructions:id,access:'read'});
function graph(mode='one'){return{nodes:[{id:'s',name:'Start',type:'start'},agent('source'),{id:'r',name:'Router',type:'router',instructions:'Route',routeMode:mode,routingInput:'result',routes:[{id:'design',name:'Design',rule:'UI tasks'},{id:'code',name:'Code',rule:'Backend tasks'}]},agent('a'),agent('b'),{id:'end',name:'End',type:'end'}],edges:[edge('s','source'),edge('source','r'),edge('r','a','design'),edge('r','b','code'),edge('a','end'),edge('b','end')]};}
class Controlled extends EventEmitter{
 constructor(){super();this.threads=[];this.turns=[];}
 async rpc(method,p){if(method==='thread/start'){const id='t'+this.threads.length;this.threads.push(p);return{thread:{id}};}if(method==='turn/start'){this.turns.push(p);return{turn:{id:'turn'+this.turns.length}};}}
 complete(text,threadId=this.turns.at(-1).threadId){this.emit('message',{method:'item/completed',params:{threadId,item:{type:'agentMessage',text}}});this.emit('message',{method:'turn/completed',params:{threadId,turn:{status:'completed'}}});}
}
async function until(fn){for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setImmediate(r));}throw new Error('Test workflow did not advance');}
test('agent must finish with a real answer before the router or next machine receives anything',async()=>{
 const codex=new Controlled(),events=[];const running=runGraph({workflow:{graph:graph()},codex,prompt:'private prompt',cwd:'/tmp',emit:e=>events.push(e)});
 await until(()=>codex.turns.length===1);
 codex.emit('message',{method:'item/agentMessage/delta',params:{threadId:'t0',delta:'Partial'}});
 await new Promise(r=>setImmediate(r));assert.equal(codex.turns.length,1);assert.ok(!events.some(e=>e.type==='node-started'&&e.nodeId==='r'));
 codex.complete('SOURCE RESULT');await until(()=>codex.turns.length===2);
 assert.ok(events.some(e=>e.type==='node-completed'&&e.nodeId==='source'));
 const routerInput=JSON.parse(codex.turns[1].input[0].text.split('\n\nTidligere')[0]);
 assert.equal(routerInput.previousResult,'SOURCE RESULT');assert.equal(routerInput.task,undefined);assert.equal(routerInput.routes[0].rule,'UI tasks');
 codex.complete(JSON.stringify({routes:['design'],reason:'UI'}));await until(()=>codex.turns.length===3);codex.complete('DESIGN DONE');
 assert.deepEqual((await running).map(a=>a.name),['source','a']);
 const route=events.find(e=>e.type==='node-completed'&&e.nodeId==='r');assert.deepEqual(route.edges,[{port:'design',target:'a'}]);assert.ok(!events.some(e=>e.type==='node-started'&&e.nodeId==='b'));
});
test('an empty completed answer stops the factory without forwarding',async()=>{
 const codex=new Controlled(),events=[];const running=runGraph({workflow:{graph:graph()},codex,prompt:'Test',cwd:'/tmp',emit:e=>events.push(e)});
 const failed=assert.rejects(running,/uden et svar/);await until(()=>codex.turns.length===1);codex.complete('');await failed;
 assert.equal(codex.turns.length,1);assert.ok(!events.some(e=>e.type==='node-completed'&&e.nodeId==='source'));
});
test('one-output routers reject multiple choices; multi-output routers forward to both selected paths',async()=>{
 for(const mode of ['one','multiple']){
  const codex=new Controlled();const running=runGraph({workflow:{graph:graph(mode)},codex,prompt:'Test',cwd:'/tmp',emit:()=>{}});
  const failed=mode==='one'?assert.rejects(running,/ugyldig udgang/):null;
  await until(()=>codex.turns.length===1);codex.complete('SOURCE');await until(()=>codex.turns.length===2);codex.complete(JSON.stringify({routes:['design','code'],reason:'Both'}));
  if(failed)await failed;else{await until(()=>codex.turns.length===4);codex.complete('B',codex.turns[3].threadId);codex.complete('A',codex.turns[2].threadId);assert.deepEqual((await running).map(a=>a.name),['source','a','b']);}
 }
});
test('named output IDs are validated, must be connected, and unknown IDs cannot be executed',()=>{
 const valid=graph();assert.doesNotThrow(()=>validateGraph(valid));
 const unwired=graph();unwired.edges=unwired.edges.filter(e=>e.port!=='code');unwired.nodes=unwired.nodes.filter(n=>n.id!=='b');unwired.edges=unwired.edges.filter(e=>e.source!=='b');assert.throws(()=>validateGraph(unwired),/Forbind udgangen Code/);
 const unknown=graph();unknown.edges[2].port='invented';assert.throws(()=>validateGraph(unknown),/Ugyldig forbindelse/);
});
