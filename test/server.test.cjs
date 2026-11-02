const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {EventEmitter}=require('node:events');const {createApp}=require('../src/server.cjs');
class Fake extends EventEmitter{async rpc(method,p){if(method==='account/read')return{account:{type:'chatgpt',email:'test@example.com'}};if(method==='thread/start'){this.cwd=p.cwd;return{thread:{id:'thread'}};}if(method==='turn/start'){setImmediate(()=>{fs.writeFileSync(path.join(this.cwd,'hello.txt'),'updated');this.emit('message',{method:'item/agentMessage/delta',params:{threadId:'thread',delta:'Done'}});this.emit('message',{method:'turn/completed',params:{threadId:'thread',turn:{status:'completed'}}});});return{turn:{id:'turn'}};}return{};}close(){}}
test('authenticated project workflow and file execution persist; hostile origins rejected',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjordagent-api-'));const app=createApp({dataDir:dir,codexFactory:()=>new Fake()});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,{token}=await require('./auth-helper.cjs').setup(base);const api=(route,method='GET',body,headers={})=>fetch(base+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await fetch(base+'/api/state')).status,401);assert.equal((await api('/api/state','GET',null,{Origin:'https://evil.invalid'})).status,403);
 assert.equal((await api('/api/projects','POST',{name:''})).status,400);
 const login=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:"owner",password:"test-password-123"})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie}})).status,200);
 const project=await(await api('/api/projects','POST',{name:'Test'})).json();assert.ok(project.id);
 assert.equal((await api('/api/workflows','POST',{name:'bad',steps:[]})).status,400);
 const run=await(await api('/api/runs','POST',{projectId:project.id,workflowId:'ask',prompt:'Edit',files:[{path:'hello.txt',content:'before'}]})).json();assert.ok(run.id);
 let result;for(let i=0;i<20;i++){result=await(await api('/api/runs/'+run.id)).json();if(result.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(result.status,'completed');assert.equal(result.changes[0].content,'updated');assert.equal(result.changes[0].kind,'modify');assert.equal(result.answers[0].text,'Done');
 const persisted=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));assert.equal(persisted.runs[0].status,'completed');
 assert.equal((await api('/api/runs','POST',{projectId:project.id,workflowId:'ask',prompt:'bad',files:[{path:'../escape',content:'x'}]})).status,400);
 await fetch(base+'/api/session',{method:'DELETE',headers:{Cookie:cookie}});assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie}})).status,401);
});
