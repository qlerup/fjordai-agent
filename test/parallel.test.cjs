const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {runGraph}=require('../src/graph.cjs');
const agent=id=>({id,name:id,type:'agent',instructions:id,access:'read'});
const edge=(source,target,port='out')=>({source,target,port});
const graph=()=>({nodes:[{id:'s',name:'Start',type:'start'},agent('a'),agent('b'),agent('next'),{id:'m',name:'Merge',type:'merge'},{id:'e',name:'End',type:'end'}],edges:[edge('s','a'),edge('s','b'),edge('a','next'),edge('next','m'),edge('b','m'),edge('m','e')]});
class Controlled extends EventEmitter{
 constructor(){super();this.threads=new Map();this.turns=new Map();this.interrupts=[];this.archived=[];}
 async rpc(method,p){
  if(method==='thread/start'){const id='t'+this.threads.size;this.threads.set(id,p);return{thread:{id}};}
  if(method==='turn/start'){const name=this.threads.get(p.threadId).developerInstructions.match(/rolle\. (a|b|next)(?:\n|$)/)[1];this.turns.set(name,p);return{turn:{id:'turn-'+name}};}
  if(method==='turn/interrupt')this.interrupts.push(p.threadId);
  if(method==='thread/archive')this.archived.push(p.threadId);
  return{};
 }
 finish(name,error){const threadId=this.turns.get(name).threadId;this.emit('message',{method:'item/completed',params:{threadId,item:{type:'agentMessage',text:'result '+name}}});this.emit('message',{method:'turn/completed',params:{threadId,turn:{status:error?'failed':'completed',error:{message:error}}}});}
}
async function until(fn){for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setImmediate(r));}assert.fail('Workflow did not advance');}
function run(t,g=graph()){
 const codex=new Controlled(),events=[],controller=new AbortController();t.after(()=>controller.abort());
 const pending=runGraph({workflow:{graph:g},codex,prompt:'Task',cwd:process.cwd(),emit:e=>events.push(e),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])});
 return{codex,events,controller,pending};
}
test('all ready agents overlap; a fast branch continues immediately and merge waits for both',async t=>{
 const {codex:c,events,pending}=run(t);
 await until(()=>c.turns.size===2);assert.ok(c.turns.has('a')&&c.turns.has('b'));
 assert.ok(!events.some(e=>e.nodeId==='next'&&e.type==='node-started'));
 c.finish('a');await until(()=>c.turns.has('next'));
 assert.match(c.turns.get('next').input[0].text,/result a/);assert.doesNotMatch(c.turns.get('next').input[0].text,/result b/);
 c.finish('next');await until(()=>events.some(e=>e.nodeId==='next'&&e.type==='node-completed'));
 assert.ok(!events.some(e=>e.nodeId==='m'&&e.type==='node-started'));
 c.finish('b');const answers=await pending;assert.deepEqual(answers.map(a=>a.nodeId),['a','b','next']);
 const merge=events.find(e=>e.nodeId==='m'&&e.type==='node-completed');assert.match(merge.result,/result next/);assert.match(merge.result,/result b/);
 assert.equal(c.listenerCount('message'),0);assert.equal(c.archived.length,3);
});
test('failure interrupts parallel siblings and never starts downstream work',async t=>{
 const {codex:c,events,pending}=run(t),rejected=assert.rejects(pending,/worker failed/);
 await until(()=>c.turns.size===2);c.finish('a','worker failed');await rejected;
 assert.ok(c.interrupts.includes(c.turns.get('b').threadId));assert.equal(c.archived.length,2);assert.equal(c.listenerCount('message'),0);
 assert.ok(!events.some(e=>['next','m','e'].includes(e.nodeId)&&e.type==='node-started'));
});
test('Stop interrupts every active branch and releases all listeners',async t=>{
 const {codex:c,controller,pending}=run(t),rejected=assert.rejects(pending,/stoppet/);
 await until(()=>c.turns.size===2);controller.abort();await rejected;
 assert.equal(c.interrupts.length,2);assert.equal(c.archived.length,2);assert.equal(c.listenerCount('message'),0);
});

test('an intermediate merge never waits for a teammate that depends on that merge',async t=>{
 const g={nodes:[{id:'s',name:'Start',type:'start'},agent('a'),agent('b'),{id:'m',name:'Merge',type:'merge'},{id:'e',name:'End',type:'end'}],edges:[edge('s','a'),edge('s','b'),edge('a','m'),edge('m','b'),edge('b','e')]};
 const {codex:c,pending}=run(t,g);await until(()=>c.turns.has('a'));assert.equal(c.turns.has('b'),false);
 c.finish('a');await until(()=>c.turns.has('b'));assert.match(c.turns.get('b').input[0].text,/result a/);c.finish('b');assert.deepEqual((await pending).map(a=>a.nodeId),['a','b']);
});

test('merge on a fast branch continues while an unconnected teammate is still working',async t=>{
 const g=graph();g.edges=[edge('s','a'),edge('s','b'),edge('a','m'),edge('m','next'),edge('next','e'),edge('b','e')];
 const {codex:c,pending,events}=run(t,g);await until(()=>c.turns.size===2);c.finish('a');
 await until(()=>c.turns.has('next'));assert.ok(events.some(e=>e.nodeId==='m'&&e.type==='node-completed'));
 assert.ok(!events.some(e=>e.nodeId==='b'&&e.type==='node-completed'));c.finish('next');c.finish('b');await pending;
});
