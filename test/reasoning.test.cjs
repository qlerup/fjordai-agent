const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {validateGraph,legacyGraph}=require('../src/graph.cjs');const {validateWorkflow}=require('../src/store.cjs');const {runWorkflow}=require('../src/codex.cjs');
const step={name:'Developer',instructions:'Work',access:'read',model:'small',reasoningEffort:'high'};
class Fake extends EventEmitter{
 constructor(){super();this.turns=[];this.threads=[];}
 async rpc(method,p){
  if(method==='model/list')return{data:[{model:'small',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]}],nextCursor:null};
  if(method==='thread/start'){this.threads.push(p);return{thread:{id:'t'}};}
  if(method==='turn/start'){this.turns.push(p);setImmediate(()=>{this.emit('message',{method:'item/completed',params:{threadId:'t',item:{type:'agentMessage',text:'OK'}}});this.emit('message',{method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});});return{turn:{id:'turn'}};}
 }
}
test('reasoning survives graph and legacy workflow validation and defaults remain automatic',()=>{
 const graph=validateGraph(legacyGraph([step]));assert.equal(graph.nodes.find(n=>n.type==='agent').reasoningEffort,'high');
 assert.equal(validateWorkflow({name:'Work',steps:[step]}).steps[0].reasoningEffort,'high');
 assert.equal(validateGraph(legacyGraph([{...step,reasoningEffort:undefined}])).nodes.find(n=>n.type==='agent').reasoningEffort,'');
 assert.throws(()=>validateGraph(legacyGraph([{...step,reasoningEffort:'invented'}])),/reasoning/);
});
test('selected reasoning reaches the actual turn and automatic does not override the model default',async()=>{
 for(const reasoningEffort of ['high','']){
  const codex=new Fake();await runWorkflow({codex,steps:[{...step,reasoningEffort}],prompt:'Test',cwd:'/tmp',emit:()=>{}});
  assert.equal(codex.turns[0].effort,reasoningEffort||undefined);
  assert.equal(codex.threads[0].model,'small');assert.equal(codex.threads[0].sandbox,'read-only');
 }
});
test('an effort unsupported by the chosen model fails before creating a thread or consuming a turn',async()=>{
 const codex=new Fake();await assert.rejects(runWorkflow({codex,steps:[{...step,reasoningEffort:'ultra'}],prompt:'Test',cwd:'/tmp',emit:()=>{}}),/understøttes ikke/);
 assert.equal(codex.threads.length,0);assert.equal(codex.turns.length,0);
});
