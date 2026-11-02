const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LiveCodex,graph}=require('./live-input-fake.cjs'),{createApp}=require('../src/server.cjs'),{setup}=require('./auth-helper.cjs'),{createRunInput}=require('../src/run-input.cjs'),{runWorkflow}=require('../src/codex.cjs');
async function until(fn){for(let i=0;i<1000;i++){if(await fn())return;await new Promise(r=>setTimeout(r,2));}assert.fail('Workflow did not advance');}
async function server(t,prompt='Build both'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-live-')),c=new LiveCodex(),app=createApp({dataDir:dir,codexFactory:()=>c});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,{token}=await setup(base);
 const raw=(route,method='GET',body,extra={})=>fetch(base+'/api/'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});
 const api=async(...args)=>{const r=await raw(...args);const b=await r.json();assert.ok(r.ok,JSON.stringify(b));return b;};
 const project=await api('projects','POST',{name:'Live messages'});await api('projects/'+project.id,'PATCH',{graph:graph(),startNodeId:'s'});
 const run=await api('runs','POST',{projectId:project.id,prompt});return{app,c,api,raw,base,id:run.id,dir};
}
test('extra input is analyzed and distributed before steering only its selected active agent',async t=>{
 const {c,api,raw,base,id,app}=await server(t);await until(()=>c.workers.a.length&&c.workers.b.length);
 assert.equal((await fetch(base+'/api/runs/'+id+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'only-b'})})).status,401);
 assert.equal((await raw('runs/'+id+'/messages','POST',{text:'only-b'},{Origin:'https://wrong.example'})).status,403);
 assert.equal((await raw('runs/'+id+'/messages','POST',{text:' '})).status,400);
 const body=await api('runs/'+id+'/messages','POST',{text:'only-b fix the API',clientId:'message-1'});
 const duplicate=await api('runs/'+id+'/messages','POST',{text:'only-b fix the API',clientId:'message-1'});assert.equal(duplicate.message.id,body.message.id);
 await until(()=>c.steers.length===1);assert.deepEqual(c.analysis,['Build both','only-b fix the API']);
 assert.equal(c.steers[0].threadId,c.workers.b[0].threadId);assert.equal(c.steers[0].expectedTurnId,'turn-'+c.workers.b[0].threadId);assert.match(c.steers[0].input[0].text,/fix the API/);
 assert.equal(c.workers.a.length,1);assert.equal(c.workers.b.length,1);
 c.finish(c.workers.b[0],'Backend fixed');c.finish(c.workers.a[0],'Frontend done');let done;await until(async()=>{done=await api('runs/'+id);return done.status!=='running';});
 assert.equal(done.status,'completed',done.error);assert.match(c.reviews[0].extraMessages,/fix the API/);assert.deepEqual(done.messages[0].targets,['b']);assert.deepEqual(done.messages[0].deliveredTo,['b']);
 assert.equal((await raw('runs/'+id+'/messages','POST',{text:'too late'})).status,409);assert.equal(c.listenerCount('message'),0);
 const saved=JSON.parse(fs.readFileSync(app.store.file,'utf8'));assert.equal(saved.runs.at(-1).messages[0].text,'only-b fix the API');
});
test('a completed selected agent reopens with its role and previous result before collection/review',async t=>{
 const {c,api,id}=await server(t);await until(()=>c.workers.a.length&&c.workers.b.length);c.finish(c.workers.a[0],'Frontend first result');
 await until(async()=>{const r=await api('runs/'+id);return r.events.some(e=>e.type==='node-completed'&&e.nodeId==='a');});
 await api('runs/'+id+'/messages','POST',{text:'only-a add a heading'});await until(()=>c.workers.a.length===2);
 const second=c.workers.a[1];assert.match(second.input[0].text,/add a heading/);assert.match(second.input[0].text,/Frontend first result/);assert.equal(c.threads.get(second.threadId).sandbox,'workspace-write');assert.equal(c.steers.length,0);
 c.finish(second,'Frontend revised');c.finish(c.workers.b[0],'Backend done');let done;await until(async()=>{done=await api('runs/'+id);return done.status!=='running';});assert.equal(done.status,'completed',done.error);assert.match(done.answers.find(a=>a.nodeId==='review').text,/Frontend revised/);assert.equal(c.workers.b.length,1);
});
test('a new message can select a branch skipped by the original distributor',async t=>{
 const {c,api,id}=await server(t,'only-a first');await until(()=>c.workers.a.length===1);assert.equal(c.workers.b.length,0);
 await api('runs/'+id+'/messages','POST',{text:'only-b add backend work'});await until(()=>c.workers.b.length===1);assert.equal(c.steers.length,0);
 c.finish(c.workers.a[0],'A done');c.finish(c.workers.b[0],'B added');let done;await until(async()=>{done=await api('runs/'+id);return done.status!=='running';});assert.equal(done.status,'completed',done.error);assert.match(done.answers.at(-1).text,/B added/);
});
test('a message arriving during archive starts a new turn in the selected role instead of being lost',async t=>{
 const c=new LiveCodex(),bus=createRunInput(),controller=new AbortController();t.after(()=>controller.abort());let injected=false;
 c.onArchive=async()=>{if(!injected){injected=true;const m=bus.append('late requested change');bus.assigned(m,['a']);}};
 const pending=runWorkflow({codex:c,steps:[{id:'a',name:'A',instructions:'WORKER_A',access:'read'}],prompt:'Task',cwd:process.cwd(),runInput:bus,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]),emit:()=>{}});
 await until(()=>c.workers.a.length===1);c.finish(c.workers.a[0],'First answer');await until(()=>c.workers.a.length===2);assert.match(c.workers.a[1].input[0].text,/late requested change/);c.finish(c.workers.a[1],'Updated answer');assert.equal((await pending)[0].text,'Updated answer');assert.equal(c.listenerCount('message'),0);
});

test('input assigned while review is active invalidates that old verdict and reviews the revised worker result',async t=>{
 const {c,api,id}=await server(t);c.holdReview=true;await until(()=>c.workers.a.length&&c.workers.b.length);c.finish(c.workers.a[0],'A first');c.finish(c.workers.b[0],'B first');await until(()=>c.reviewTurns.length===1);
 await api('runs/'+id+'/messages','POST',{text:'only-a new requirement'});await until(()=>c.workers.a.length===2);c.holdReview=false;
 c.finish(c.reviewTurns[0],JSON.stringify({approved:true,summary:'Old verdict',corrections:[]}));c.finish(c.workers.a[1],'A revised');
 let done;await until(async()=>{done=await api('runs/'+id);return done.status!=='running';});assert.equal(done.status,'completed',done.error);assert.equal(c.reviews.length,2);assert.match(done.answers.at(-1).text,/A revised/);assert.equal(c.workers.b.length,1);
});

test('project conversation context preserves the extra messages',async()=>{
 const {projectContext}=require('../src/context.cjs');const history=await projectContext({project:{id:'p'},runs:[{id:'r',projectId:'p',status:'completed',prompt:'Initial',messages:[{text:'Updated requirement'}],answers:[{name:'A',text:'Result'}]}],emit:()=>{},save:()=>{},summarize:()=>assert.fail()});assert.match(history,/Updated requirement/);
});

test('routing failures stop the run with the actual routing error and clean up active workers',async t=>{
 const {c,api,id}=await server(t);await until(()=>c.workers.a.length&&c.workers.b.length);const original=c.rpc.bind(c);
 c.rpc=async(method,p)=>{if(method==='turn/start'&&p.outputSchema?.properties.intent){setImmediate(()=>c.finish(p,JSON.stringify({summary:'Bad route',intent:'update',decisions:[{routerId:'router',ports:['unwired']}]})));return{turn:{id:'bad-routing-turn'}};}return original(method,p);};
 await api('runs/'+id+'/messages','POST',{text:'only-b broken route'});let done;await until(async()=>{done=await api('runs/'+id);return done.status!=='running';});assert.equal(done.status,'failed');assert.match(done.error,/ekstra besked kunne ikke fordeles/);assert.equal(done.messages[0].status,'failed');await until(()=>c.listenerCount('message')===0);
});

test('Stop cancels both the original workers and a pending extra-message analysis',async t=>{
 const {c,api,id}=await server(t);await until(()=>c.workers.a.length&&c.workers.b.length);const original=c.rpc.bind(c);let routing;
 c.rpc=async(method,p)=>{if(method==='turn/start'&&p.outputSchema?.properties.intent){routing=p;return{turn:{id:'routing-turn'}};}return original(method,p);};
 await api('runs/'+id+'/messages','POST',{text:'only-b pending analysis'});await until(()=>routing);await api('runs/'+id+'/stop','POST');let done;await until(async()=>{done=await api('runs/'+id);return done.status!=='running';});assert.equal(done.status,'interrupted');assert.match(done.error,/manuelt/);await until(()=>c.listenerCount('message')===0);assert.equal(c.steers.length,0);
});

test('extra-message inbox validates bounds and rejects a reused id with changed text',()=>{
 const inbox=createRunInput();assert.throws(()=>inbox.append(''),/Skriv/);assert.throws(()=>inbox.append('x'.repeat(20001)),/20.000/);assert.throws(()=>inbox.append('text','bad id'),/besked-id/);
 inbox.append('one','same-id');assert.throws(()=>inbox.append('two','same-id'),/allerede brugt/);for(let i=1;i<32;i++)inbox.append('message '+i);assert.throws(()=>inbox.append('overflow'),/grænsen/);
});
