const http = require('node:http');
const {validateAttachments,writeAttachments}=require('./attachments.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Auth } = require('./auth.cjs');
const { Sessions } = require('./sessions.cjs');
const { saveImage } = require('./images.cjs');
const {changeReport}=require('./changes.cjs');
const { projectContext,archivedContext } = require('./context.cjs');
const {createRunInput}=require('./run-input.cjs');
const {routeLiveMessage}=require('./live-router.cjs');
const { Store, validateWorkflow } = require('./store.cjs');
const { runGraph,legacyGraph,validateGraph }=require('./graph.cjs');
const { Codex, runWorkflow } = require('./codex.cjs');
const { listModels } = require('./models.cjs');
const { validateSnapshot, writeSnapshot, collectChanges, safePath, hash,MAX_BYTES,MAX_FILE_BYTES,MAX_WORKSPACE_BYTES } = require('./workspace.cjs');

function createApp({ dataDir = process.env.DATA_DIR || path.resolve('data'), codexFactory } = {}) {
  const store = new Store(dataDir);
  const auth = new Auth(dataDir);
  const home = path.join(dataDir, 'codex'); fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const workRoot = path.join(dataDir, 'workspaces'); fs.mkdirSync(workRoot, { recursive: true });
  for(const project of store.state.projects)fs.mkdirSync(path.join(workRoot,project.id),{recursive:true});
  const codex = codexFactory ? codexFactory() : new Codex({ home, cwd: workRoot });
  
  const active = new Map();const startingProjects=new Set(); const bridgeCaps = new Map(); const bridgePending = new Map();
  const approvals = new Map(); const sessions = new Sessions(dataDir); const attempts = new Map();
  const browserSession = req => {
    const cookie = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('fjordagent='))?.slice(11);
    return sessions.valid(cookie);
  };
  const authorized = req => auth.bearer(req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'') || browserSession(req);
  const newSession = res => {
    const session=sessions.issue();
    json(res,200,{ok:true},{'Set-Cookie':`fjordagent=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.SECURE_COOKIE==='true'?'; Secure':''}`});
  };
  const json = (res, code, value, headers = {}) => { res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers }); res.end(JSON.stringify(value)); };
  async function body(req) {
    let size=0, chunks=[];
    for await (const c of req) { size+=c.length; if(size>Math.max(17*1024*1024,MAX_BYTES*4)) throw Object.assign(new Error('Beskeden er for stor'), { status:413 }); chunks.push(c); }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw Object.assign(new Error('Ugyldig JSON'), { status:400 }); }
  }
  const cleanup = setInterval(() => {
    sessions.prune();
    for (const [key, value] of attempts) if (value.until < Date.now()) attempts.delete(key);
  }, 60000); cleanup.unref();
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost'); const p=url.pathname;
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res,403,{error:'Forkert origin'});
      if (p==='/healthz') return json(res,200,{ok:true,version:'0.1.0'});
      if (p==='/api/setup' && req.method==='GET') return json(res,200,{setupRequired:!auth.ready});
      if ((p==='/api/setup'||p==='/api/session') && req.method==='POST') {
        if(p==='/api/setup'&&(auth.ready||auth.creating))return json(res,409,{error:'Opsætningen er allerede gennemført eller i gang'});
        const ip=req.socket.remoteAddress;const existing=attempts.get(ip);const a=existing&&existing.until>Date.now()?existing:{count:0,until:Date.now()+60000};
        if(a.count>=10)return json(res,429,{error:'For mange forsøg. Vent et minut.'});
        a.count++;attempts.set(ip,a);
        const b=await body(req);
        if(p==='/api/setup')await auth.create(b.username,b.password);
        else {
          if(!auth.ready)return json(res,409,{error:'Gennemfør førstegangsopsætningen først'});
          if(!await auth.verify(b.username,b.password))return json(res,401,{error:'Forkert brugernavn eller adgangskode'});
        }
        attempts.delete(ip);return newSession(res);
      }
      if (p==='/internal/bridge' && req.method==='POST') {
        const cap=bridgeCaps.get((req.headers.authorization||'').replace(/^Bearer /,''));
        if(!cap)return json(res,401,{error:'Projektforbindelsen er udløbet'});
        const b=await body(req);const args=b.arguments||{};
        if(!['project_list_projects','project_list_files','project_read_file','project_search','project_run_command'].includes(b.name))return json(res,400,{error:'Ukendt projektværktøj'});
        if(b.name==='project_read_file'&&!safePath(args.path))return json(res,400,{error:'Filstien er ikke tilladt'});
        if(b.name==='project_read_file'&&(!args.project||args.project===cap.projectName)&&cap.files.some(f=>f.path===args.path)){
          let target=cap.cwd;for(const segment of args.path.split('/')){target=path.join(target,segment);if(fs.lstatSync(target).isSymbolicLink())return json(res,400,{error:'Symlink er ikke tilladt'});}
          const file=path.join(cap.cwd,args.path);const stat=fs.lstatSync(file);
          if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1||stat.size>MAX_FILE_BYTES)return json(res,400,{error:'Filen kan ikke læses'});
          return json(res,200,{path:args.path,content:fs.readFileSync(file,'utf8'),source:'working-copy'});
        }
        if(b.name==='project_run_command'&&(typeof args.command!=='string'||!args.command.trim()||args.command.length>8000||args.project||args.timeoutMs!==undefined&&(!Number.isInteger(args.timeoutMs)||args.timeoutMs<1000||args.timeoutMs>120000)))return json(res,400,{error:'Ugyldig lokal kommando'});
        const id=store.id();
        const result=await new Promise(resolve=>{
          const timer=setTimeout(()=>done({error:'VS Code svarede ikke inden 25 sekunder. Projektforbindelsen er afbrudt.',code:'BRIDGE_TIMEOUT'}),25000);
          const done=value=>{clearTimeout(timer);bridgePending.delete(id);resolve(value);};
          bridgePending.set(id,{id,runId:cap.runId,name:b.name,arguments:args,done});
        });
        if(result.error){
          const fatal=['BRIDGE_TIMEOUT','WORKSPACE_UNTRUSTED'].includes(result.code);
          if(fatal)active.get(cap.runId)?.controller.abort(Object.assign(new Error(result.error),{code:'PROJECT_CONNECTION_ERROR'}));
          return json(res,fatal?502:400,{error:result.error});
        }
        if(b.name==='project_read_file'&&!result.referenceOnly){
          if(typeof result.content!=='string'||Buffer.byteLength(result.content)>MAX_FILE_BYTES||result.content.includes('\0'))return json(res,400,{error:'Filindholdet er ugyldigt eller overskrider filgrænsen på '+MAX_FILE_BYTES/1024/1024+' MB'});
          const total=cap.files.reduce((n,f)=>n+Buffer.byteLength(f.content),0)+Buffer.byteLength(result.content);
          if(total>MAX_WORKSPACE_BYTES||cap.files.length>=1000)return json(res,400,{error:'Arbejdskopien har nået grænsen på '+MAX_WORKSPACE_BYTES/1024/1024+' MB / 1.000 filer'});
          const file=path.join(cap.cwd,args.path);
          // Never follow symlinks created by an agent in the partial working copy.
          let parent=cap.cwd;for(const part of args.path.split('/').slice(0,-1)){parent=path.join(parent,part);if(fs.existsSync(parent)&&!fs.lstatSync(parent).isDirectory())throw new Error('Ugyldig arbejdsmappe');if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw new Error('Symlink er ikke tilladt');}
          fs.mkdirSync(path.dirname(file),{recursive:true});
          try{fs.writeFileSync(file,result.content,{flag:'wx'});}catch(e){if(e.code==='EEXIST')return json(res,409,{error:'Filen findes allerede i arbejdskopien. Brug den lokale fil.'});throw e;}
          cap.files.push({path:args.path,content:result.content,hash:hash(result.content)});
        }
        return json(res,200,result);
      }
      if (p.startsWith('/api/') && !authorized(req)) return json(res,401,{error:'Log ind med din bruger'});
      if (p==='/api/session' && req.method==='DELETE') {
        const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('fjordagent='))?.slice(11); sessions.revoke(cookie);
        return json(res,200,{ok:true},{'Set-Cookie':'fjordagent=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
      }
      if (p==='/api/connection-key') {
        if(!browserSession(req))return json(res,403,{error:'Log ind i browseren for at administrere forbindelser'});
        if(req.method==='POST')return json(res,200,{token:auth.issue()});
        if(req.method==='DELETE'){auth.revoke();return json(res,200,{ok:true});}
      }
      if (p==='/api/state' && req.method==='GET') return json(res,200,{...store.state,limits:{fileBytes:MAX_FILE_BYTES,patchBytes:MAX_BYTES,workspaceBytes:MAX_WORKSPACE_BYTES},workflows:store.state.projects.map(p=>({id:p.id,name:p.name,graph:p.graph,steps:p.graph.nodes.filter(n=>n.type==='agent')})),runs:store.state.runs.map(({events,changes,changeReport,...r})=>({...r,changeCount:changes?.length||0,...(changeReport?{changeSummary:{...changeReport,files:changeReport.files.map(({diff,...f})=>f)}}:{})})),active:[...active.keys()]});
      if (p==='/api/account' && req.method==='GET') {
        try { return json(res,200,await codex.rpc('account/read',{refreshToken:false})); }
        catch(e) { return json(res,503,{error:e.message}); }
      }
      if (p==='/api/account/login' && req.method==='POST') return json(res,200,await codex.rpc('account/login/start',{type:'chatgptDeviceCode'}));
      if (p==='/api/account/logout' && req.method==='POST') {
        if(active.size) return json(res,409,{error:'Stop aktive opgaver først'});
        return json(res,200,await codex.rpc('account/logout'));
      }
      if (p==='/api/settings'&&req.method==='PUT'){
        const b=await body(req);if(typeof b.routerModel!=='string'||b.routerModel.length>100)return json(res,400,{error:'Ugyldig routermodel'});
        store.state.settings={routerModel:b.routerModel};store.save();return json(res,200,store.state.settings);
      }
      if (p==='/api/models' && req.method==='GET') return json(res,200,await listModels(codex));
      if (p==='/api/projects' && req.method==='POST') {
        const b=await body(req); if(typeof b.name!=='string'||!b.name.trim()||b.name.length>80) return json(res,400,{error:'Angiv et projektnavn på højst 80 tegn'});
        if(b.fullAccess!==undefined&&typeof b.fullAccess!=='boolean')return json(res,400,{error:'Full access skal være slået til eller fra'});
        if(store.state.projects.length>=100) return json(res,400,{error:'Maksimum 100 projekter i prototypen'});
        const project={id:store.id(),name:b.name.trim(),graph:legacyGraph([{name:'Udvikler',instructions:'Løs brugerens opgave. Undersøg projektet, lav fokuserede ændringer og kør relevante tests.',access:'write',model:''},{name:'Reviewer',instructions:'Gennemgå resultatet og find konkrete fejl. Ændr ikke filer.',access:'read',model:''}]),startNodeId:'start',createdAt:new Date().toISOString()};
        const cwd=path.join(workRoot,project.id); fs.mkdirSync(cwd);
        project.fullAccess=b.fullAccess===true;
        fs.writeFileSync(path.join(cwd,'README.md'),`# ${project.name}\n\nIsoleret testprojekt til FjordAgent.\n`);
        store.state.projects.push(project); store.save(); return json(res,201,project);
      }
      const conversationMatch=p.match(/^\/api\/projects\/([\w-]+)\/conversation$/);
      if(conversationMatch&&req.method==='POST'){
        const project=store.state.projects.find(p=>p.id===conversationMatch[1]);if(!project)return json(res,404,{error:'Projektet findes ikke'});
        if(startingProjects.has(project.id)||[...active.values()].some(a=>a.projectId===project.id))return json(res,409,{error:'Stop eller afslut den aktive opgave, før du starter en ny samtale.'});
        project.conversationId=store.id();delete project.memory;store.save();return json(res,201,{conversationId:project.conversationId});
      }
      const projectMatch=p.match(/^\/api\/projects\/([\w-]+)$/);
      if(projectMatch&&req.method==='DELETE'){
        const project=store.state.projects.find(p=>p.id===projectMatch[1]);if(!project)return json(res,404,{error:'Projektet findes ikke'});
        if(startingProjects.has(project.id)||[...active.values()].some(a=>a.projectId===project.id))return json(res,409,{error:'Stop eller afslut opgaven før workflowet slettes'});
        store.state.projects=store.state.projects.filter(p=>p.id!==project.id);store.state.runs=store.state.runs.filter(r=>r.projectId!==project.id);store.save();return json(res,200,{ok:true});
      }
      if(projectMatch&&req.method==='PATCH'){
        const project=store.state.projects.find(p=>p.id===projectMatch[1]);if(!project)return json(res,404,{error:'Projektet findes ikke'});
        const b=await body(req);let graph=project.graph;
        if(b.fullAccess!==undefined&&typeof b.fullAccess!=='boolean')return json(res,400,{error:'Full access skal være slået til eller fra'});
        try{if(b.graph)graph=validateGraph(b.graph);}catch(e){return json(res,400,{error:e.message});}
        const startNodeId=b.startNodeId||project.startNodeId;
        if(!graph.nodes.some(n=>n.id===startNodeId&&n.type==='start'))return json(res,400,{error:'Vælg en gyldig startnode i projektet'});
        if(b.name!==undefined&&(typeof b.name!=='string'||!b.name.trim()||b.name.length>80))return json(res,400,{error:'Ugyldigt projektnavn'});
        project.graph=graph;project.startNodeId=startNodeId;if(b.name)project.name=b.name.trim();if(b.fullAccess!==undefined)project.fullAccess=b.fullAccess;store.save();return json(res,200,project);
      }
      if (p==='/api/workflows' && req.method==='POST') {
        const b=await body(req); let validated; try{validated=validateWorkflow(b);}catch(e){return json(res,400,{error:e.message});}
        const item={id:store.id(),...validated}; store.state.workflows.push(item); store.save();return json(res,201,item);
      }
      const workflowMatch=p.match(/^\/api\/workflows\/([\w-]+)$/);
      if (workflowMatch && req.method==='PUT') {
        const index=store.state.workflows.findIndex(w=>w.id===workflowMatch[1]);if(index<0)return json(res,404,{error:'Workflow findes ikke'});
        let v;try{v=validateWorkflow(await body(req));}catch(e){return json(res,400,{error:e.message});}
        const item={id:workflowMatch[1],...v};store.state.workflows[index]=item;store.save();return json(res,200,item);
      }
      if (p==='/api/runs' && req.method==='POST') {
        const b=await body(req); const project=store.state.projects.find(x=>x.id===b.projectId); const workflow=project?{id:project.id,name:project.name,graph:project.graph,steps:project.graph.nodes.filter(n=>n.type==='agent')}:null;
        if(!project||!workflow||typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>20000) return json(res,400,{error:'Vælg projekt, og skriv en besked på højst 20.000 tegn'});
        if(startingProjects.has(project.id)||active.size+startingProjects.size>=2 || [...active.values()].some(a=>a.projectId===project.id)) return json(res,409,{error:'Projektet er optaget, eller begge kørselspladser er i brug'});
        const startNodeId=workflow.graph?(b.startNodeId||project.startNodeId||workflow.graph.nodes.find(n=>n.type==='start')?.id):undefined;
        if(workflow.graph&&!workflow.graph.nodes.some(n=>n.id===startNodeId&&n.type==='start'))return json(res,400,{error:'Projektets startnode er ændret. Vælg en ny startnode på projektets lærred.'});
        let snapshot; if(b.files!==undefined){try{snapshot=validateSnapshot(b.files,b.bridge===true);}catch(e){return json(res,400,{error:e.message});}}
        let uploads;try{uploads=validateAttachments(b.attachments);}catch(e){return json(res,400,{error:e.message});}
        let account;startingProjects.add(project.id);try{account=await codex.rpc('account/read',{refreshToken:false});}finally{startingProjects.delete(project.id);} if(!account.account) return json(res,409,{error:'Forbind først en ChatGPT-konto på serveren'});
        const run={id:store.id(),projectId:project.id,workflowId:workflow.id,conversationId:project.conversationId,startNodeId,prompt:b.prompt,status:'running',createdAt:new Date().toISOString(),events:[],answers:[],source:snapshot?'vscode':'server'};
        run.fullAccess=project.fullAccess===true;run.autoApply=run.fullAccess&&!!snapshot;
        run.images=[];
        const cwd=snapshot?path.join(workRoot,'runs',run.id):path.join(workRoot,project.id);
        if(snapshot)writeSnapshot(cwd,snapshot);
        const attachments=writeAttachments(path.join(dataDir,'attachments',run.id),uploads);
        run.attachments=attachments.map(({name,size,image})=>({name,size,image}));
        store.state.runs.push(run); if(store.state.runs.length>200) store.state.runs.splice(0,store.state.runs.length-200);store.save();
        const controller=new AbortController();active.set(run.id,{controller,projectId:project.id});
        let bridgeToken,config;if(snapshot&&b.bridge===true){bridgeToken=randomBytes(32).toString('hex');bridgeCaps.set(bridgeToken,{runId:run.id,cwd,files:snapshot,projectName:b.projectName});config={mcp_servers:{fjordagent_project:{command:process.execPath,args:[path.join(__dirname,'bridge.cjs')],env:{FJORDAGENT_BRIDGE_URL:'http://127.0.0.1:'+server.address().port+'/internal/bridge',FJORDAGENT_BRIDGE_TOKEN:bridgeToken},startup_timeout_sec:15,tool_timeout_sec:195,default_tools_approval_mode:'approve'}}};}
        let eventBytes=0;const emit=e=>{if(['delta','diff'].includes(e.type))return;const size=Buffer.byteLength(JSON.stringify(e));if(run.events.length<10000&&eventBytes+size<2097152){run.events.push({...e,at:Date.now()});eventBytes+=size;} };
        emit({type:'notice',text:bridgeToken?'Filadgang via VS Code er tilsluttet. Agenterne kan hente projektfiler undervejs.':'Denne opgave k?rer p? serveren uden adgang til lokale pc-filer. Start opgaven fra FjordAgent i VS Code for at forbinde den ?bne projektmappe.'});
        let conversationHistory='';run.messages=[];
        const runInput=createRunInput({messages:run.messages,emit,save:()=>store.save(),route:async message=>{
          controller.signal.throwIfAborted();
          if(message.includePreviousConversations)message.analysis='Brugeren har eksplicit bedt om tidligere samtaler:\n'+archivedContext(project,store.state.runs);
          if(workflow.graph.executionMode==='dynamic')return routeLiveMessage({codex,cwd,workflow,prompt:message.text,originalPrompt:run.prompt,projectConnected:run.source==='vscode',messages:run.messages,events:run.events,previousContext:message.includePreviousConversations?archivedContext(project,store.state.runs):'',signal:controller.signal,fullAccess:run.fullAccess,emit:e=>emit({type:'input-routing',messageId:message.id,event:e})});
          return runGraph({workflow:structuredClone(workflow),startNodeId,codex,cwd,attachments,fullAccess:run.fullAccess,signal:controller.signal,routeOnly:true,prompt:message.text,history:(conversationHistory+'\nDen oprindelige opgave: '+run.prompt+'\nTidligere ekstra beskeder:\n'+runInput.snapshot().text).slice(-40000),emit:event=>{if(event.type==='node-completed'&&workflow.graph.nodes.some(n=>n.id===event.nodeId&&n.type==='analysis'))message.analysis=event.result;emit({type:'input-routing',messageId:message.id,event});}});
        },onError:e=>controller.abort(Object.assign(new Error('Den ekstra besked kunne ikke fordeles: '+e.message),{code:'INPUT_ROUTING_ERROR'}))});active.get(run.id).runInput=runInput;
        const approve=request=>new Promise(resolve=>{
          const id=store.id();const timer=setTimeout(()=>done(false),5*60000);
          const done=value=>{clearTimeout(timer);controller.signal.removeEventListener('abort',cancel);approvals.delete(id);resolve(value);};
          const cancel=()=>done(false);controller.signal.addEventListener('abort',cancel,{once:true});
          approvals.set(id,{done,runId:run.id});emit({type:'approval',id,request});
        });
        (async()=>{
          const history=await projectContext({project,runs:store.state.runs,save:()=>store.save(),emit,summarize:async(summary,content)=>{
            const result=await runWorkflow({codex,cwd,fullAccess:run.fullAccess,prompt:JSON.stringify({previousSummary:summary,conversation:content}),steps:[{name:'Samtalehukommelse',taskMode:'analysis',access:'read',instructions:'Opsummér samtalen på dansk. Bevar brugerens mål, præferencer, beslutninger, begrænsninger, relevante filnavne og uafsluttede opgaver. Udfør ingen opgaver. Returnér kun JSON med summary på højst 12000 tegn.'}],structuredOutput:true,outputSchema:{type:'object',properties:{summary:{type:'string'}},required:['summary'],additionalProperties:false},emit,signal:controller.signal});
            const value=JSON.parse(result[0].text).summary;if(typeof value!=='string'||!value.trim()||value.length>12000)throw new Error('Samtalen kunne ikke komprimeres til en gyldig opsummering');return value;
          }});
          conversationHistory=history+(b.includePreviousConversations===true?'\nBrugeren har eksplicit bedt om tidligere samtaler:\n'+archivedContext(project,store.state.runs):'');
          const onImage=(item,step)=>{const image=saveImage(item,{root:path.join(home,'generated_images'),directory:path.join(dataDir,'images',run.id),runId:run.id,name:step.name});run.images.push(image);store.save();return image;};
          if(workflow.graph)return runGraph({workflow:structuredClone(workflow),startNodeId,codex,prompt:b.prompt,attachments,history:conversationHistory,cwd,emit,signal:controller.signal,approve,config,projectBridge:!!bridgeToken,onImage,fullAccess:run.fullAccess,runInput,getReviewEvidence:snapshot?()=>{const report=changeReport(collectChanges(cwd,snapshot),snapshot);if(report.error)throw new Error(report.error);return report.files.slice(0,24).map(f=>({id:'file-'+hash(f.path).slice(0,16),kind:'change',text:f.path+'\n'+f.diff}));}:undefined});
        })()
          .then(answers=>{run.answers=answers;if(snapshot){run.changes=collectChanges(cwd,snapshot);run.changeReport=changeReport(run.changes,snapshot);}run.status='completed';emit({type:'result',answer:answers.at(-1),details:answers.slice(0,-1)});})
          .catch(e=>{run.status=controller.signal.aborted&&!['PROJECT_CONNECTION_ERROR','INPUT_ROUTING_ERROR'].includes(controller.signal.reason?.code)?'interrupted':'failed';run.error=e.message;emit({type:'error',text:e.message});})
          .finally(()=>{controller.abort(new Error('Opgaven er afsluttet'));run.finishedAt=new Date().toISOString();active.delete(run.id);if(bridgeToken)bridgeCaps.delete(bridgeToken);for(const b of bridgePending.values())if(b.runId===run.id)b.done({error:'Opgaven er afsluttet'});for(const a of approvals.values())if(a.runId===run.id)a.done(false);store.save();});
        return json(res,202,{id:run.id});
      }
      const runMatch=p.match(/^\/api\/runs\/([\w-]+)(?:\/(stop))?$/);
      const messageMatch=p.match(/^\/api\/runs\/([\w-]+)\/messages$/);
      if(messageMatch&&req.method==='POST'){
        const run=store.state.runs.find(r=>r.id===messageMatch[1]);if(!run)return json(res,404,{error:'Opgaven findes ikke'});
        const b=await body(req),current=active.get(run.id);
        if(run.status!=='running'||!current?.runInput||current.controller.signal.aborted)return json(res,409,{error:'Opgaven er afsluttet. Send beskeden som en ny opgave.'});
        const message=current.runInput.append(b.text,b.clientId,b.includePreviousConversations===true);return json(res,202,{message});
      }
      const applicationMatch=p.match(/^\/api\/runs\/([\w-]+)\/application$/);
      if(applicationMatch&&req.method==='POST'){
        const run=store.state.runs.find(r=>r.id===applicationMatch[1]);if(!run)return json(res,404,{error:'Opgaven findes ikke'});
        const b=await body(req);if(run.status!=='completed'||run.source!=='vscode'||!['applied','saved'].includes(b.status))return json(res,400,{error:'Ugyldig status for lokale kodeændringer'});
        if(run.application?.status!=='saved')run.application={status:b.status,at:new Date().toISOString()};store.save();return json(res,200,{ok:true});
      }
      const imageMatch=p.match(/^\/api\/runs\/([\w-]+)\/images\/([\w-]+)$/);
      if(imageMatch&&req.method==='GET'){
        const run=store.state.runs.find(r=>r.id===imageMatch[1]),image=run?.images?.find(i=>i.id===imageMatch[2]);
        if(!image)return json(res,404,{error:'Billedet findes ikke'});
        const file=path.join(dataDir,'images',run.id,image.id+image.ext);
        const bytes=fs.readFileSync(file);res.writeHead(200,{'Content-Type':image.mime,'Content-Length':bytes.length,'Cache-Control':'private, no-store','Content-Disposition':`inline; filename="image-${image.id}${image.ext}"`});return res.end(bytes);
      }
      if(runMatch){
        const run=store.state.runs.find(r=>r.id===runMatch[1]);if(!run)return json(res,404,{error:'Opgaven findes ikke'});
        if(req.method==='GET'&&!runMatch[2])return json(res,200,{...run,bridgeRequests:[...bridgePending.values()].filter(b=>b.runId===run.id).map(({done,...b})=>b)});
        if(req.method==='POST'&&runMatch[2]){run.stopCause='manual';active.get(run.id)?.controller.abort(new Error('Opgaven blev stoppet manuelt.'));return json(res,200,{ok:true});}
      }
      const bridgeResult=p.match(/^\/api\/bridge-results\/([\w-]+)$/);
      if(bridgeResult&&req.method==='POST'){
        const b=bridgePending.get(bridgeResult[1]);if(!b)return json(res,410,{error:'Filforespørgslen er udløbet'});
        const value=await body(req);b.done(value);return json(res,200,{ok:true});
      }
      const approval=p.match(/^\/api\/approvals\/([\w-]+)$/);
      if(approval&&req.method==='POST'){
        const a=approvals.get(approval[1]);if(!a)return json(res,410,{error:'Godkendelsen er udløbet'});
        const b=await body(req);a.done(b.accept===true);return json(res,200,{ok:true});
      }
      if(p.startsWith('/api/'))return json(res,404,{error:'Ukendt endpoint'});
      const files={'/':'index.html','/app.js':'app.js','/change-view.js':'change-view.js','/change-view.css':'change-view.css','/style.css':'style.css','/flow.js':'flow.js','/factory3d.js':'factory3d.js','/three-LICENSE.txt':'three-LICENSE.txt','/fjordagent.vsix':'fjordagent.vsix'};
      if(req.method!=='GET'||!files[p])return json(res,404,{error:'Ikke fundet'});
      const file=path.join(__dirname,'..','public',files[p]);if(!fs.existsSync(file))return json(res,404,{error:'Filen er ikke bygget endnu'});
      const mime=p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.vsix')?'application/octet-stream':'text/html';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache',...(p.endsWith('.vsix')?{'Content-Disposition':'attachment; filename="fjordagent.vsix"'}:{})}); fs.createReadStream(file).pipe(res);
    } catch(e) { if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Handlingen fejlede: '+e.message});else res.end(); }
  });
  const close=()=>{clearInterval(cleanup);for(const a of active.values())a.controller.abort();codex.close();server.close();};
  return {server,close,store};
}
if(require.main===module){const app=createApp();app.server.listen(Number(process.env.PORT||3080),process.env.HOST||'0.0.0.0',()=>console.log('FjordAgent listening on port '+(process.env.PORT||3080)+'. Open the app to set up your account.'));process.on('SIGTERM',()=>{app.close();setTimeout(()=>process.exit(),2000).unref();});}
module.exports={createApp};
