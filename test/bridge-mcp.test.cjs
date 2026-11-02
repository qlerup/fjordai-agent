const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),{spawn}=require('node:child_process'),{createInterface}=require('node:readline');

test('project MCP tools distinguish local execution from read-only access and serve every declared tool',async t=>{
 const calls=[];const server=http.createServer(async(req,res)=>{let text='';for await(const part of req)text+=part;calls.push(JSON.parse(text));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({marker:'project context'}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../src/bridge.cjs')],{env:{...process.env,FJORDAGENT_BRIDGE_URL:'http://127.0.0.1:'+server.address().port,FJORDAGENT_BRIDGE_TOKEN:'test-token',FJORDAGENT_ALLOW_COMMAND:'1'},stdio:['pipe','pipe','ignore']});
 t.after(()=>{child.kill();server.close();});let next=0;const pending=new Map();
 createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);p.resolve(m.result);}});
 function rpc(method,params){return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>reject(Error('Bridge RPC timeout')),5000);pending.set(id,{resolve,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
 assert.equal((await rpc('initialize',{})).serverInfo.name,'fjordagent-project');
 const {tools}=await rpc('tools/list',{});
 assert.deepEqual(tools.map(t=>t.name),['project_run_command','project_list_projects','project_list_files','project_read_file','project_search']);
 for(const tool of tools){
  const command=tool.name==='project_run_command';assert.deepEqual(tool.annotations,{readOnlyHint:!command,destructiveHint:command,idempotentHint:!command,openWorldHint:command});
  const result=await rpc('tools/call',{name:tool.name,arguments:{path:'src/example.js',query:'example',command:'docker compose ps'}});
  assert.equal(result.isError,undefined);assert.equal(JSON.parse(result.content[0].text).marker,'project context');
 }
 assert.equal(calls.length,5);assert.equal((await rpc('tools/call',{name:'project_write_file'})).isError,true);assert.equal(calls.length,5);
});
