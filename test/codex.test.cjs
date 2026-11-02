const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {runWorkflow}=require('../src/codex.cjs');
class Fake extends EventEmitter{constructor(mode='ok'){super();this.mode=mode;this.calls=[];this.id=0;}async rpc(method,params){this.calls.push({method,params});if(method==='thread/start')return{thread:{id:'thread'+(++this.id)}};if(method==='turn/start'){const id=params.threadId;setImmediate(()=>{this.emit('message',{method:'turn/started',params:{threadId:id,turn:{id:'turn'}}});if(this.mode==='hang')return;this.emit('message',{method:'item/agentMessage/delta',params:{threadId:id,delta:'answer '+id}});this.emit('message',{method:'turn/completed',params:{threadId:id,turn:{status:this.mode==='fail'?'failed':'completed',error:{message:'Test failure'}}}});});return{turn:{id:'turn'}};}return{};}}
test('agents execute sequentially with previous output and correct access',async()=>{const c=new Fake();const events=[];const result=await runWorkflow({codex:c,cwd:'/tmp',prompt:'task',steps:[{name:'Build',instructions:'build',access:'write'},{name:'Review',instructions:'review',access:'read'}],emit:e=>events.push(e)});assert.equal(result.length,2);assert.equal(c.calls.filter(x=>x.method==='thread/start')[1].params.sandbox,'read-only');assert.match(c.calls.filter(x=>x.method==='turn/start')[1].params.input[0].text,/answer thread1/);assert.equal(events.filter(x=>x.type==='delta').length,2);});
test('failed turn stops the workflow',async()=>{const c=new Fake('fail');await assert.rejects(runWorkflow({codex:c,cwd:'/tmp',prompt:'task',steps:[{name:'A',access:'read'},{name:'B',access:'write'}],emit:()=>{}}),/Test failure/);assert.equal(c.id,1);});
test('cancellation interrupts the active turn',async()=>{const c=new Fake('hang'),abort=new AbortController();const p=runWorkflow({codex:c,cwd:'/tmp',prompt:'task',steps:[{name:'A',access:'write'}],emit:()=>{},signal:abort.signal});setTimeout(()=>abort.abort(),20);await assert.rejects(p,/stoppet/);assert.ok(c.calls.some(x=>x.method==='turn/interrupt'));assert.equal(c.listenerCount('message'),0);});

test('fresh node threads release their project connections on success, failure and cancellation',async()=>{
 for(const mode of ['ok','fail','hang']){
  const c=new Fake(mode),controller=new AbortController();
  const result=runWorkflow({codex:c,cwd:'/tmp',prompt:'task',steps:[{name:'Worker',access:'read'}],emit:()=>{},signal:controller.signal});
  if(mode==='hang')setTimeout(()=>controller.abort(),10);
  if(mode==='ok')await result;else await assert.rejects(result);
  assert.deepEqual(c.calls.filter(x=>x.method==='thread/archive').map(x=>x.params),[{threadId:'thread1'}]);
  assert.equal(c.listenerCount('message'),0);
 }
});

test('automatic cancellation preserves a concrete failure reason instead of claiming user stop',async()=>{
 const c=new Fake('hang'),controller=new AbortController();const pending=runWorkflow({codex:c,cwd:'/tmp',prompt:'task',steps:[{name:'A',access:'read'}],emit:()=>{},signal:controller.signal});
 setTimeout(()=>controller.abort(new Error('Projektforbindelsen er afbrudt')),10);await assert.rejects(pending,/Projektforbindelsen er afbrudt/);
});

test('optional server SSH context advertises aliases without changing sandbox or approvals',async t=>{
 const previous=process.env.FJORDAGENT_SSH_HOSTS;t.after(()=>{if(previous===undefined)delete process.env.FJORDAGENT_SSH_HOSTS;else process.env.FJORDAGENT_SSH_HOSTS=previous;});
 process.env.FJORDAGENT_SSH_HOSTS='proxmox (pve)';
 const c=new Fake();await runWorkflow({codex:c,cwd:'/tmp',prompt:'List containers',steps:[{name:'Worker',instructions:'Only list containers',access:'read'},{name:'Analysis',instructions:'Classify only',taskMode:'analysis',access:'read'}],emit:()=>{}});
 const threads=c.calls.filter(x=>x.method==='thread/start').map(x=>x.params);
 assert.match(threads[0].developerInstructions,/proxmox \(pve\)/);assert.match(threads[0].developerInstructions,/Only list containers/);
 assert.equal(threads[0].sandbox,'read-only');assert.equal(threads[0].approvalPolicy,'on-request');assert.doesNotMatch(threads[1].developerInstructions,/SSH/);
 delete process.env.FJORDAGENT_SSH_HOSTS;
 const plain=new Fake();await runWorkflow({codex:plain,cwd:'/tmp',prompt:'Task',steps:[{name:'Worker',instructions:'Work',access:'write'}],emit:()=>{}});
 assert.doesNotMatch(plain.calls.find(x=>x.method==='thread/start').params.developerInstructions,/SSH/);
});
