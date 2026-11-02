const http=require('node:http'),path=require('node:path'),{randomBytes}=require('node:crypto');
const validText=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max;

// One in-memory channel per graph run. No messages or credentials cross runs.
function createTeam({nodes,prompt,emit,signal,route}){
 const byId=new Map(nodes.map(n=>[n.id,n])),groups=[],caps=new Map(),tasks=[];let server,starting,closed=false;
 function register(source,edges){
  const members=[...new Set(edges.map(e=>e.target))].filter(id=>byId.get(id)?.type==='agent');
  if(members.length<2)return;
  const id=source+':'+groups.length;
  groups.push({id,source,members,messages:[],results:new Map(),requests:0,queue:Promise.resolve()});
  emit({type:'team',kind:'assignment',teamId:id,from:'Fælles opgave',text:members.map(id=>byId.get(id).name).join(', ')+' arbejder sammen om samme forespørgsel.'});
 }
 const teamsFor=id=>groups.filter(g=>g.members.includes(id));
 function context(id){return teamsFor(id).map(g=>({teamId:g.id,task:prompt,members:g.members.map(key=>({id:key,name:byId.get(key).name,role:byId.get(key).instructions})),messages:g.messages.slice(-24),tasks:tasks.filter(t=>t.teamId===g.id),results:[...g.results].map(([nodeId,text])=>({nodeId,name:byId.get(nodeId).name,text}))}));}
 function post(g,kind,from,text,to){
  if(g.messages.length>=64)g.messages.shift();
  const message={kind,from,text,...(to?{to}: {}),...(['task-request','task'].includes(kind)?{transport:'drone'}:{})};g.messages.push(message);
  emit({type:'team',teamId:g.id,...message,fromName:byId.get(from)?.name||from,...(to?{toName:byId.get(to)?.name||to}:{})});
 }
 async function call(id,name,args={}){
  signal?.throwIfAborted();if(closed)throw Error('Teamforbindelsen er afsluttet');
  const teams=teamsFor(id);if(!teams.length)throw Error('Agenten har ikke et aktivt team');
  if(name==='team_context')return{teams:context(id)};
  if(name==='team_message'){
   if(!validText(args.text,4000))throw Error('En besked skal indeholde 1-4000 tegn');
   const g=args.teamId?teams.find(g=>g.id===args.teamId):teams.length===1?teams[0]:null;
   if(!g||!g.members.includes(args.to)||args.to===id)throw Error('V?lg en anden agent i dit team fra team_context');
   if(g.chatCount>=64)throw Error('Teamet har n?et gr?nsen p? 64 beskeder');
   g.chatCount=(g.chatCount||0)+1;post(g,'message',id,args.text.trim(),args.to);
   return{status:'posted',message:'Beskeden er synlig i team_context. Nye opgaver skal sendes med team_request.'};
  }
  if(name==='team_request'){
   if(!validText(args.task,4000))throw Error('En teamopgave skal indeholde 1-4000 tegn');
   const g=args.teamId?teams.find(g=>g.id===args.teamId):teams.length===1?teams[0]:null;
   if(!g)throw Error('Vælg teamId fra team_context for den fælles opgave');
   const job=g.queue.then(async()=>{
    signal?.throwIfAborted();if(closed)throw Error('Teamforbindelsen er afsluttet');
    const duplicate=tasks.find(t=>t.teamId===g.id&&t.from===id&&t.text===args.task.trim());if(duplicate)return{taskId:duplicate.id,status:duplicate.status};
    if(g.requests>=8)throw Error('Teamet har nået grænsen på 8 ekstra opgaver');g.requests++;
    post(g,'task-request',id,args.task.trim(),g.source);
    const choice=await route({source:g.source,members:g.members,from:id,task:args.task.trim(),context:context(id)});
    signal?.throwIfAborted();if(!g.members.includes(choice.target)||choice.target===id||!validText(choice.reason,4000))throw Error('Fordeleren valgte en ugyldig teammodtager');
    const task={id:randomBytes(12).toString('hex'),teamId:g.id,from:id,via:g.source,to:choice.target,text:args.task.trim(),status:'pending'};tasks.push(task);post(g,'task',g.source,choice.reason+'\n\nOpgave: '+task.text,choice.target);
    return{taskId:task.id,target:choice.target,status:'pending',message:'Fordeleren har sat opgaven i kø hos modtageren. Den udføres før samling/review; den er endnu ikke færdig.'};
   });g.queue=job.catch(e=>{g.failed=e.message;if(!closed)post(g,'error',g.source,'Fordeling mislykkedes: '+e.message,id);});return job;
  }
  throw Error('Ukendt teamværktøj. Nye opgaver skal sendes til fordeleren med team_request.');
 }
 async function start(){
  if(starting)return starting;
  starting=new Promise((resolve,reject)=>{
   server=http.createServer(async(req,res)=>{
    const id=caps.get((req.headers.authorization||'').replace(/^Bearer /,''));
    const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if(!id||closed)return reply(401,{error:'Teamforbindelsen er udløbet'});
    if(req.method!=='POST'||req.url!=='/team')return reply(404,{error:'Ukendt teamværktøj'});
    try{let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>12000)throw Error('Teambeskeden er for stor');}const b=JSON.parse(raw);reply(200,await call(id,b.name,b.arguments));}
    catch(e){reply(400,{error:e.message});}
   });server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
  });return starting;
 }
 async function connect(id){
  if(!teamsFor(id).length)return null;
  await start();signal?.throwIfAborted();const token=randomBytes(32).toString('hex');caps.set(token,id);
  return{context:JSON.stringify(context(id)).slice(-36000),config:{fjordagent_team:{command:process.execPath,args:[path.join(__dirname,'team-bridge.cjs')],env:{FJORDAGENT_TEAM_URL:'http://127.0.0.1:'+server.address().port+'/team',FJORDAGENT_TEAM_TOKEN:token},default_tools_approval_mode:'approve',tool_timeout_sec:180}},close:()=>caps.delete(token)};
 }
 function result(id,text){for(const g of teamsFor(id)){g.results.set(id,text.slice(-6000));post(g,'result',id,text.slice(-4000));}}
 const takeTasks=id=>tasks.filter(t=>t.to===id&&t.status==='pending').map(t=>{t.status='running';return{...t};});
 function finishTasks(taken,failed=false){for(const item of taken){const task=tasks.find(t=>t.id===item.id);task.status=failed?'failed':'completed';const g=groups.find(g=>g.id===task.teamId);post(g,failed?'error':'task-completed',task.to,(failed?'Teamopgaven mislykkedes: ':'Teamopgaven er udført: ')+task.text,task.via);}}
 const pendingTargets=()=>[...new Set(tasks.filter(t=>t.status==='pending').map(t=>t.to))];
 const relevantGroups=ids=>groups.filter(g=>!ids||g.members.some(id=>ids.has(id)));
 function assertSettled(ids){const relevant=relevantGroups(ids),failed=relevant.find(g=>g.failed);if(failed)throw Error('En ekstra teamopgave kunne ikke fordeles: '+failed.failed);if(tasks.some(t=>(!ids||ids.has(t.to))&&t.status!=='completed'))throw Error('Teamet har ekstra opgaver, som endnu ikke er udført. Resultatet er ikke sendt videre.');}
 function close(){closed=true;caps.clear();server?.close();server?.closeAllConnections();}
 const reviewContext=ids=>JSON.stringify(groups.filter(g=>g.members.some(id=>ids.includes(id))).map(g=>({teamId:g.id,messages:g.messages.slice(-24)}))).slice(-36000);
 return{register,connect,result,context,reviewContext,takeTasks,finishTasks,pendingTargets,assertSettled,close};
}
module.exports={createTeam};
