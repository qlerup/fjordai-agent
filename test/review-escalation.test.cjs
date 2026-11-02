const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {runGraph,validateGraph}=require('../src/graph.cjs');
const {reviewSchema,validateReview}=require('../src/review.cjs');
const {evidencePacket,escalationReason}=require('../src/review-escalation.cjs');
const assessment=(category='none',severity='minor',evidenceIds=[])=>({category,severity,reason:category==='none'?'':'Concrete observed issue',evidenceIds});
const accept={approved:true,summary:'Verified current result',corrections:[],escalation:assessment()};
const reject=(escalation=assessment())=>({approved:false,summary:'Observed defect',corrections:[{nodeId:'dev',message:'Fix the observed defect and run its regression test'}],escalation});
const opt={enabled:true,model:'astra',reasoningEffort:'high'};
function graph(enabled=true,dynamic=false){return{...(dynamic?{executionMode:'dynamic',maxActiveAgents:4}:{}),nodes:[{id:'s',type:'start',name:'Start'},{id:'dev',type:'agent',name:'Developer',instructions:'Implement only assigned work',access:'write',model:'sol'},{id:'review',type:'review',name:'Reviewer',instructions:'Review actual work',model:'sol',reasoningEffort:'high',maxRounds:2,...(enabled?{escalation:opt}:{})},{id:'end',type:'end',name:'End'}],edges:dynamic?[]:[['s','dev'],['dev','review'],['review','end']].map(([source,target])=>({source,target,port:'out'}))};}
class Fake extends EventEmitter{
 constructor(normal=[accept],extra=[accept],{diff=true,failExtra=false}={}){super();this.normal=normal;this.extra=extra;this.diff=diff;this.failExtra=failExtra;this.threads=[];this.normalCalls=[];this.extraCalls=[];this.work=0;}
 async rpc(method,p){
  if(method==='model/list')return{data:['sol','astra'].map(model=>({model,supportedReasoningEfforts:[{reasoningEffort:'high'}]}))};
  if(method==='thread/start'){const id='t'+this.threads.length;this.threads.push(p);return{thread:{id}};}
  if(method!=='turn/start')return{};
  const thread=this.threads[Number(p.threadId.slice(1))];let text,failed=false;
  if(p.outputSchema?.properties.approved){const extra=thread.model==='astra',calls=extra?this.extraCalls:this.normalCalls,values=extra?this.extra:this.normal;calls.push({thread,p,input:JSON.parse(p.input[0].text.split('\n\nTidligere')[0])});text=JSON.stringify(values[Math.min(calls.length-1,values.length-1)]);failed=extra&&this.failExtra;}
  else if(p.outputSchema?.properties.targets)text=JSON.stringify({targets:['dev'],reason:'One specialist is sufficient'});
  else{this.work++;text='Implementation and test report v'+this.work;}
  setImmediate(()=>{if(!p.outputSchema&&this.diff)this.emit('message',{method:'turn/diff/updated',params:{threadId:p.threadId,diff:'--- a/auth.js\n+++ b/auth.js\n@@ -1 +1 @@\n-deny()\n+allow()'}});this.emit('message',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',text}}});this.emit('message',{method:'turn/completed',params:{threadId:p.threadId,turn:{status:failed?'failed':'completed',error:failed?{message:'Escalation unavailable'}:undefined}}});});return{turn:{id:'turn'}};
 }
}
const run=(c,g=graph(),events=[])=>runGraph({workflow:{graph:g},codex:c,cwd:'/tmp',prompt:'Implement a small change',emit:e=>events.push(e)});

test('escalation settings are opt-in, bounded and survive manual/dynamic graph validation',()=>{
 assert.equal(validateGraph(graph(false)).nodes.find(n=>n.type==='review').escalation,undefined);
 for(const dynamic of [false,true])assert.deepEqual(validateGraph(graph(true,dynamic)).nodes.find(n=>n.type==='review').escalation,opt);
 for(const escalation of [null,{...opt,enabled:'yes'},{...opt,model:''},{...opt,reasoningEffort:'invented'}]){const g=graph();g.nodes[2].escalation=escalation;assert.throws(()=>validateGraph(g),/eskalering|reasoning/);}
 assert.equal(reviewSchema([{id:'dev'}]).properties.escalation,undefined);
 assert.throws(()=>validateReview(JSON.stringify({...accept,escalation:{...assessment(),category:'critical-security'}}),[{id:'dev'}],true),/eskalering/);
});
test('evidence is bounded; unknown IDs, keywords, minor findings and early after-correction do not escalate',()=>{
 const packet=evidencePacket([{id:'user',kind:'prompt',text:'critical auth breach'},...Array.from({length:8},(_,i)=>({id:'f'+i,kind:'change',text:'x'.repeat(20000)}))]);assert.ok(packet.reduce((n,e)=>n+e.text.length,0)<=36000);assert.ok(!packet.some(e=>e.id==='user'));
 assert.equal(escalationReason(reject(assessment('critical-security','major',['missing'])),0,packet),null);
 assert.equal(escalationReason(reject(assessment('critical-security','minor',['f0'])),0,packet),null);
 assert.equal(escalationReason(reject(assessment('after-correction','major',['f0'])),0,packet),null);
 assert.equal(escalationReason(reject(assessment('architecture','major',['review-0'])),0,[{id:'review-0',kind:'feedback'}]),null);
 for(const category of ['architecture','critical-security','data-loss','uncertain'])assert.equal(escalationReason(reject(assessment(category,'major',['f0'])),0,packet).category,category);
});
test('simple successful Sol reviews do not invoke Astra in manual or dynamic workflows',async()=>{
 for(const dynamic of [false,true]){const c=new Fake();await run(c,graph(true,dynamic));assert.equal(c.normalCalls.length,1);assert.equal(c.extraCalls.length,0);assert.equal(c.work,1);}
});
test('legacy reviewers retain their original schema and correction behavior',async()=>{
 const c=new Fake([reject(),accept]);await run(c,graph(false));assert.equal(c.work,2);assert.equal(c.extraCalls.length,0);assert.equal(c.normalCalls[0].p.outputSchema.properties.escalation,undefined);
});
test('normal minor correction resolves with Sol only',async()=>{
 const c=new Fake([reject(),accept]);await run(c);assert.equal(c.normalCalls.length,2);assert.equal(c.extraCalls.length,0);assert.equal(c.work,2);
});
test('unresolved major findings after a correction escalate with prior feedback and current results',async()=>{
 const c=new Fake([reject(),reject(assessment('after-correction','major',['review-0']))]),events=[];await run(c,graph(),events);assert.equal(c.extraCalls.length,1);assert.equal(c.work,2);assert.ok(events.some(e=>e.type==='review-escalated'&&e.category==='after-correction'));
 const call=c.extraCalls[0];assert.equal(call.thread.sandbox,'read-only');assert.equal(call.p.effort,'high');assert.ok(call.input.reviewAssessment.previousFeedback.length>=2);assert.match(call.input.candidates[0].result,/v2/);assert.ok(call.input.reviewAssessment.evidence.some(e=>e.kind==='change'));
});
test('critical concrete changes can escalate immediately, but missing evidence never does',async()=>{
 const serious=reject(assessment('critical-security','critical',['runtime-1'])),c=new Fake([serious]);await run(c);assert.equal(c.extraCalls.length,1);assert.equal(c.work,1);
 const missing=new Fake([serious],[],{diff:false}),events=[];await assert.rejects(run(missing,graph(),events),/ikke godkendt/);assert.equal(missing.extraCalls.length,0);assert.ok(!events.some(e=>e.nodeId==='end'&&e.type==='node-started'));
});
test('only one extra review is permitted and unresolved failures never reach End',async()=>{
 const serious=reject(assessment('critical-security','major',['runtime-1'])),c=new Fake([serious],[reject()]),events=[];await assert.rejects(run(c,graph(),events),/ikke godkendt/);assert.equal(c.extraCalls.length,1);assert.equal(c.normalCalls.length,3);assert.equal(c.work,3);assert.ok(!events.some(e=>e.type==='review'&&e.approved));assert.ok(!events.some(e=>e.nodeId==='end'&&e.type==='node-started'));
});
test('an unavailable escalation model fails the workflow instead of silently approving',async()=>{
 const c=new Fake([reject(assessment('uncertain','major',['runtime-1']))],[],{failExtra:true}),events=[];await assert.rejects(run(c,graph(),events),/Escalation unavailable/);assert.equal(c.extraCalls.length,1);assert.ok(!events.some(e=>e.nodeId==='end'&&e.type==='node-started'));
});


test('extra user assignments cannot bypass the total dynamic specialist cap',async()=>{
 const {createRunInput}=require('../src/run-input.cjs');const inbox=createRunInput({route:async()=>['other']});
 const g=graph(false,true);g.maxActiveAgents=1;g.nodes.splice(2,0,{id:'other',type:'agent',name:'Other',instructions:'Different specialty',access:'read',model:'sol'});
 const c=new Fake(),original=c.rpc.bind(c);let appended=false;
 c.rpc=async(method,p)=>{const result=await original(method,p);if(method==='turn/start'&&!p.outputSchema&&!appended){appended=true;inbox.append('Ask a second specialist','extra');}return result;};
 await assert.rejects(runGraph({workflow:{graph:g},codex:c,cwd:'/tmp',prompt:'Simple work',runInput:inbox,emit:()=>{}}),/grænsen for aktive specialister/);
 assert.equal(c.work,1);
});
test('completed server and VS Code command results become bounded review evidence',async()=>{
 const {runWorkflow}=require('../src/codex.cjs');const c=new EventEmitter();
 c.rpc=async(method,p)=>{if(method==='thread/start')return{thread:{id:'t'}};if(method==='turn/start'){setImmediate(()=>{
  for(const item of [{type:'commandExecution',command:'npm test',exitCode:1,aggregatedOutput:'failure '.repeat(2000)},{type:'mcpToolCall',tool:'project_run_command',arguments:{command:'docker compose ps'},result:{content:[{type:'text',text:JSON.stringify({host:'vscode',exitCode:0,output:'local service running'})}]}},{type:'agentMessage',text:'Inspected'}])c.emit('message',{method:'item/completed',params:{threadId:'t',item}});
  c.emit('message',{method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});});return{turn:{id:'turn'}};}return{};};
 const events=[];await runWorkflow({codex:c,cwd:'/tmp',prompt:'Inspect',steps:[{name:'Developer',instructions:'Check',access:'write'}],emit:e=>events.push(e)});
 const results=events.filter(e=>e.type==='command-result');assert.equal(results.length,2);assert.equal(results[0].exitCode,1);assert.equal(results[0].output.length,8000);assert.equal(results[1].output,'local service running');
});


test('baseline file evidence is passed to Astra even when no runtime diff event was emitted',async()=>{
 const c=new Fake([reject(assessment('data-loss','critical',['actual-file']))],[accept],{diff:false});
 await runGraph({workflow:{graph:graph()},codex:c,cwd:'/tmp',prompt:'Check migration',emit:()=>{},getReviewEvidence:()=>[{id:'actual-file',kind:'change',text:'migration.sql\n-DROP TABLE users;\n+DROP TABLE accounts;'}]});
 assert.equal(c.extraCalls.length,1);assert.match(c.extraCalls[0].input.reviewAssessment.evidence.find(e=>e.id==='actual-file').text,/DROP TABLE accounts/);
});
