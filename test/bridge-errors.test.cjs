const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createApp}=require('../src/server.cjs');
class BridgeFailure extends EventEmitter{
 constructor(code){super();this.code=code;}
 async rpc(method,p){if(method==='account/read')return{account:{type:'chatgpt'}};if(method==='thread/start'){this.config=p.config;return{thread:{id:'t'}};}if(method==='turn/start'){setImmediate(()=>this.work().catch(e=>this.emit('closed',e)));return{turn:{id:'turn'}};}return{};}
 async work(){const env=this.config.mcp_servers.fjordagent_project.env;const get=async name=>{const r=await fetch(env.FJORDAGENT_BRIDGE_URL,{method:'POST',headers:{Authorization:'Bearer '+env.FJORDAGENT_BRIDGE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({name,arguments:name==='project_read_file'?{path:'missing.js'}:{}})});return{status:r.status,body:await r.json()};};
  this.error=await get('project_read_file');if(this.code!=='PROJECT_TOOL_ERROR')return;
  this.next=await get('project_list_projects');
  this.emit('message',{method:'item/completed',params:{threadId:'t',item:{type:'agentMessage',text:'Missing file reported; project discovery continued'}}});this.emit('message',{method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});
 }
 close(){}
}
for(const code of ['PROJECT_TOOL_ERROR','WORKSPACE_UNTRUSTED','BRIDGE_TIMEOUT'])test('bridge error '+code+' keeps the correct run status and cause',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-bridge-error-')),c=new BridgeFailure(code),app=createApp({dataDir:dir,codexFactory:()=>c});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+app.server.address().port,{token}=await require('./auth-helper.cjs').setup(base);
 const api=async(route,method='GET',data)=>{const r=await fetch(base+'/api/'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return r.json();};
 const project=await api('projects','POST',{name:'Error test'});await api('projects/'+project.id,'PATCH',{graph:require('../src/graph.cjs').legacyGraph([{name:'Worker',instructions:'Read files',access:'read'}])});const start=await api('runs','POST',{projectId:project.id,prompt:'Inspect',files:[],bridge:true});let run;
 const message=code==='PROJECT_TOOL_ERROR'?'File not found: missing.js':code==='WORKSPACE_UNTRUSTED'?'Workspace er ikke længere betroet':'VS Code svarede ikke inden 25 sekunder. Projektforbindelsen er afbrudt.';
 for(let i=0;i<100;i++){run=await api('runs/'+start.id);for(const req of run.bridgeRequests||[])await api('bridge-results/'+req.id,'POST',req.name==='project_read_file'?{error:message,code}:{projects:[]});if(run.status!=='running')break;await new Promise(r=>setTimeout(r,5));}
 if(code==='PROJECT_TOOL_ERROR'){assert.equal(run.status,'completed');assert.equal(c.error.status,400);assert.equal(c.next.status,200);}
 else{assert.equal(run.status,'failed');assert.equal(run.error,message);assert.notEqual(run.error,'Opgaven blev stoppet');}
 assert.equal(run.stopCause,undefined);
});
