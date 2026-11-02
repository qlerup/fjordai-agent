const {createInterface}=require('node:readline');
const tools=[
 {name:'team_message',description:'Post a short coordination message to a teammate. They can read it with team_context; it does not start work or interrupt them. Use team_request for implementation tasks.',inputSchema:{type:'object',properties:{teamId:{type:'string'},to:{type:'string'},text:{type:'string',maxLength:4000}},required:['to','text'],additionalProperties:false}},
 {name:'team_context',description:'Read the shared task, teammate roles, distributor-routed extra tasks, their status and latest completed results for this task only.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'team_request',description:'Send a concrete extra implementation task back to the distributor that formed this team. The distributor chooses the right active teammate and queues real work with their role/access, even if they already finished. Returns pending, NOT completed; the workflow executes it before merge/review. Do not repeat an identical task. If you belong to multiple teams, include teamId from team_context.',inputSchema:{type:'object',properties:{teamId:{type:'string'},task:{type:'string',maxLength:4000}},required:['task'],additionalProperties:false}}
];
for(const tool of tools)tool.annotations={readOnlyHint:tool.name==='team_context',destructiveHint:false,idempotentHint:tool.name==='team_context',openWorldHint:false};
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
createInterface({input:process.stdin}).on('line',async line=>{
 let m;try{m=JSON.parse(line);}catch{return;}if(m.id===undefined)return;
 try{let result;
  if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fjordagent-team',version:'0.1.0'}};
  else if(m.method==='tools/list')result={tools};
  else if(m.method==='ping')result={};
  else if(m.method==='tools/call'){
   if(!tools.some(t=>t.name===m.params?.name))throw Error('Ukendt teamværktøj');
   const r=await fetch(process.env.FJORDAGENT_TEAM_URL,{method:'POST',headers:{Authorization:'Bearer '+process.env.FJORDAGENT_TEAM_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(m.params),signal:AbortSignal.timeout(175000)}),body=await r.json();
   if(!r.ok||body.error)throw Error(body.error||'Teamforbindelsen fejlede');result={content:[{type:'text',text:JSON.stringify(body)}]};
  }else return send({id:m.id,error:{code:-32601,message:'Unknown method'}});
  send({id:m.id,result});
 }catch(e){send({id:m.id,result:{isError:true,content:[{type:'text',text:e.message}]}});}
});
