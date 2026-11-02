// Minimal stdio MCP server. The workflow capability expires when its run finishes.
const {createInterface}=require('node:readline');
const tools=[
 {name:'project_run_command',description:'Run a command on the user?s PC through VS Code, in the selected working project. Use for local Docker Desktop (docker compose up -d, docker compose ps), builds and tests. Server shell commands do NOT run on the PC. Normal mode requires local approval; Full access runs automatically. Local files are the editor version: server edits return only after the workflow finishes, so do not claim a new server edit is already running locally. Check exitCode and output.',inputSchema:{type:'object',properties:{command:{type:'string',maxLength:8000},timeoutMs:{type:'integer',minimum:1000,maximum:120000}},required:['command'],additionalProperties:false}},
 {name:'project_list_projects',description:'List all projects exposed by the connected VS Code workspace. Use other projects as references throughout the workflow.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'project_list_files',description:'List source paths in the connected VS Code project. Use this throughout the workflow to discover additional files.',inputSchema:{type:'object',properties:{prefix:{type:'string'},project:{type:'string'}},additionalProperties:false}},
 {name:'project_read_file',description:'Read a UTF-8 project file on demand. The file is also placed in your working directory so shell and editing tools can use it. Files already fetched return the current working copy, including your edits.',inputSchema:{type:'object',properties:{path:{type:'string'},project:{type:'string'}},required:['path'],additionalProperties:false}},
 {name:'project_search',description:'Search text in the connected VS Code project. Returns matching file paths and line snippets. Use project_read_file to fetch files before editing. Search is over the editor source, not server edits.',inputSchema:{type:'object',properties:{query:{type:'string'},prefix:{type:'string'},project:{type:'string'}},required:['query'],additionalProperties:false}}
];
// These tools only read the connected editor. read_file caches a copy on the
// server; it never writes back to the user's project.
for(const tool of tools)tool.annotations={readOnlyHint:tool.name!=='project_run_command',destructiveHint:tool.name==='project_run_command',idempotentHint:tool.name!=='project_run_command',openWorldHint:tool.name==='project_run_command'};
const enabledTools=tools.filter(t=>t.name!=='project_run_command'||process.env.FJORDAGENT_ALLOW_COMMAND==='1');
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
createInterface({input:process.stdin}).on('line',async line=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.id===undefined)return;
 try{let result;
  if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fjordagent-project',version:'0.1.0'}};
  else if(m.method==='tools/list')result={tools:enabledTools};
  else if(m.method==='ping')result={};
  else if(m.method==='tools/call'){
   if(!enabledTools.some(t=>t.name===m.params?.name))throw new Error('Unknown project tool');
   const response=await fetch(process.env.FJORDAGENT_BRIDGE_URL,{method:'POST',headers:{Authorization:'Bearer '+process.env.FJORDAGENT_BRIDGE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(m.params),signal:AbortSignal.timeout(m.params.name==='project_run_command'?190000:35000)});
   const body=await response.json();if(!response.ok||body.error)throw new Error(body.error||'Project connection failed');
   result={content:[{type:'text',text:JSON.stringify(body)}]};
  }else{send({id:m.id,jsonrpc:'2.0',error:{code:-32601,message:'Unknown method'}});return;}
  send({id:m.id,jsonrpc:'2.0',result});
 }catch(e){send({id:m.id,jsonrpc:'2.0',result:{isError:true,content:[{type:'text',text:e.message}]}});}
});
