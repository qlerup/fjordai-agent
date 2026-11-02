const vscode=require('vscode');
const {runLocalCommand}=require('./local-command.cjs');
const {randomBytes}=require('node:crypto');
const {safePath,hash,MAX_BYTES,MAX_FILE_BYTES,MAX_FILES}=require('./runtime/workspace.cjs');
let remoteFileLimit=MAX_FILE_BYTES;
let panel,activeRun,activeProjectId,activeFolder,baseline,changes,changesRunId,pollTimer,starting=false,activeProjects=[],historyGeneration=0;let localController,activeFullAccess=false;const bridgeInFlight=new Set();
function activate(context){
  function workingFolder(){const roots=vscode.workspace.workspaceFolders||[];const file=vscode.window.activeTextEditor?.document.uri.toString();return file?roots.filter(f=>file.startsWith(f.uri.toString().replace(/\/$/,'')+'/')).sort((a,b)=>b.uri.toString().length-a.uri.toString().length)[0]||roots[0]:roots[0];}
  async function connection(){const url=vscode.workspace.getConfiguration('fjordagent').get('serverUrl');const token=await context.secrets.get('serverToken');if(!url||!token)throw new Error('Kør først FjordAI Agent: Connect to server');return{url,token};}
  async function api(route,method='GET',data){const {url,token}=await connection();const r=await fetch(url+'/api/'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(120000)});const b=await r.json();if(!r.ok)throw new Error(b.error||'Serverfejl');return b;}
  const send=m=>panel?.webview.postMessage(m);
  async function loadImage(runId,imageId){
    if(!/^[\w-]+$/.test(runId)||! /^[\w-]+$/.test(imageId))throw new Error('Ugyldigt billede');
    const {url,token}=await connection(),r=await fetch(url+'/api/runs/'+runId+'/images/'+imageId,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
    const mime=r.headers.get('content-type');if(!r.ok||!['image/png','image/jpeg','image/webp','image/gif'].includes(mime)||Number(r.headers.get('content-length'))>20*1024*1024)throw new Error('Billedet kunne ikke hentes');
    const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>20*1024*1024)throw new Error('Billedet er for stort');return{bytes,mime};
  }
  async function refreshState(){
    const url=vscode.workspace.getConfiguration('fjordagent').get('serverUrl');const token=await context.secrets.get('serverToken');
    if(!url||!token){send({type:'connection',connected:false});return;}
    const s=await api('state');remoteFileLimit=s.limits?.fileBytes||MAX_FILE_BYTES;send({type:'connection',connected:true,url});
    if(activeRun||starting)send({type:'busy',runId:activeRun});
    send({type:'state',projects:s.projects,activeProjectId:activeRun?activeProjectId:undefined,workspace:workingFolder()?.uri.fsPath||'Åbn en projektmappe først'});
  }
  async function connect(){
    if(activeRun||starting)throw new Error('Stop den aktive opgave før du skifter server');
    const input=await vscode.window.showInputBox({title:'FjordAI Agent-server',prompt:'Eksempel: http://192.168.1.50:3080',value:vscode.workspace.getConfiguration('fjordagent').get('serverUrl')});if(!input)return;
    let url;try{url=new URL(input);}catch{throw new Error('Ugyldig serveradresse');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Brug serverens http(s)-adresse uden sti eller loginoplysninger');
    if(url.protocol==='http:'){const accepted=await vscode.window.showWarningMessage('Forbindelsen er ukrypteret. Brug kun HTTP på dit eget betroede lokalnet.',{modal:true},'Brug lokal server');if(!accepted)return;}
    const token=await vscode.window.showInputBox({title:'Forbindelsesnøgle fra appens Forbindelser',password:true,ignoreFocusOut:true});if(!token)return;
    const r=await fetch(url.origin+'/api/state',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Kunne ikke forbinde. Kontrollér adresse og forbindelsesnøgle.');
    await context.secrets.store('serverToken',token);await vscode.workspace.getConfiguration('fjordagent').update('serverUrl',url.origin,vscode.ConfigurationTarget.Global);vscode.window.showInformationMessage('FjordAI Agent-serveren er forbundet. ChatGPT-login styres i appen.');if(panel)await refreshState();
  }
  async function textAt(uri){const open=vscode.workspace.textDocuments.find(d=>d.uri.toString()===uri.toString());if(open)return open.getText();const bytes=await vscode.workspace.fs.readFile(uri);if(bytes.includes(0))throw new Error('Binær fil');return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  async function noSymlink(root,relative){let uri=root;for(const segment of relative.split('/')){uri=vscode.Uri.joinPath(uri,segment);try{const stat=await vscode.workspace.fs.stat(uri);if(stat.type&vscode.FileType.SymbolicLink)throw new Error('Symlinks kan ikke overføres: '+relative);}catch(e){if(e.code==='FileNotFound')return;throw e;}}}
  async function projects(){
    const roots=vscode.workspace.workspaceFolders||[], result=[];
    for(const root of roots){
      result.push(root);
      const children=await vscode.workspace.fs.readDirectory(root.uri);
      for(const [name,type]of children){
        if(!(type&vscode.FileType.Directory)||(type&vscode.FileType.SymbolicLink)||!safePath(name))continue;
        const uri=vscode.Uri.joinPath(root.uri,name);
        try{const entries=await vscode.workspace.fs.readDirectory(uri);if(entries.some(([n])=>['.git','package.json','pyproject.toml','compose.yaml','docker-compose.yml','Cargo.toml','pom.xml','go.mod'].includes(n)))result.push({name,uri,index:0});}catch{}
      }
    }
    return result.filter((p,i)=>result.findIndex(q=>q.uri.toString()===p.uri.toString())===i);
  }
  async function snapshot(folder){
    const files=[];
    for(const name of ['AGENTS.md','README.md','package.json','pyproject.toml','Cargo.toml','go.mod']){
      try{await noSymlink(folder.uri,name);const uri=vscode.Uri.joinPath(folder.uri,name);const stat=await vscode.workspace.fs.stat(uri);if(stat.size>64000)continue;files.push({path:name,content:await textAt(uri)});}catch{}
    }
    send({type:'context',project:folder.uri.fsPath,text:'Projektforbindelsen er åben. Agenterne kan søge, liste og hente flere filer fra alle tilknyttede projekter undervejs.',files:files.map(f=>f.path),bytes:files.reduce((n,f)=>n+Buffer.byteLength(f.content),0)});return files;
  }
  async function bridgeRequest(request){
    if(bridgeInFlight.has(request.id))return;bridgeInFlight.add(request.id);
    try{
      if(!vscode.workspace.isTrusted)throw Object.assign(new Error('Workspace er ikke længere betroet'),{code:'WORKSPACE_UNTRUSTED'});
      const args=request.arguments||{};let result;
      if(request.name==='project_run_command'){
        if(args.project)throw Error('Kommandoer m? kun k?re i arbejdsprojektet');
        const controller=localController,folder=activeFolder;
        if(!controller||controller.signal.aborted)throw Error('Opgaven er afsluttet');
        if(typeof args.command!=='string'||!args.command.trim()||args.command.length>8000)throw Error('Ugyldig lokal kommando');
        if(!activeFullAccess){const askedAt=Date.now(),accepted=await vscode.window.showWarningMessage('Agenten vil k?re denne kommando p? din pc i '+folder.uri.fsPath+'\n\n'+args.command,{modal:true},'K?r kommando');if(accepted!=='K?r kommando'||Date.now()-askedAt>60000)throw Error('Den lokale kommando blev ikke godkendt inden 60 sekunder');}
        controller.signal.throwIfAborted();if(!vscode.workspace.isTrusted)throw Error('Projektmappen er ikke l?ngere betroet');
        send({type:'notice',text:'K?rer lokalt: '+args.command});
        result=await runLocalCommand({command:args.command,cwd:folder.uri.fsPath,timeoutMs:args.timeoutMs??120000,signal:controller.signal});
        send({type:'activity',text:'Lokal kommando: '+args.command+'\nExitkode: '+result.exitCode+'\n'+result.output});
      }else if(request.name==='project_list_projects')result={projects:activeProjects.map(p=>({name:p.name,workingProject:p.uri.toString()===activeFolder.uri.toString()}))};
      else{
        const matches=args.project?activeProjects.filter(p=>p.name===args.project):[activeFolder];
        if(matches.length!==1)throw new Error('Projektet findes ikke entydigt. Brug project_list_projects.');const folder=matches[0];
        if(request.name==='project_read_file'){
          if(!safePath(args.path))throw new Error('Filstien er ikke tilladt');await noSymlink(folder.uri,args.path);
          const uri=vscode.Uri.joinPath(folder.uri,args.path),stat=await vscode.workspace.fs.stat(uri);if(stat.size>remoteFileLimit)throw new Error('Filen overskrider serverens filgrænse på '+remoteFileLimit/1024/1024+' MB');
          const content=await textAt(uri),referenceOnly=folder.uri.toString()!==activeFolder.uri.toString();
          if(!referenceOnly&&!baseline.has(args.path))baseline.set(args.path,content);
          result={path:args.path,project:folder.name,content,referenceOnly};
        }else{
          if(args.prefix&&(!safePath(args.prefix.replace(/\/$/,''))))throw new Error('Ugyldigt søgepræfiks');
          const exclude='**/{.git,.ssh,.aws,.codex,.config,node_modules,dist,build,coverage,.next,.venv,venv,__pycache__}/**';
          const uris=await vscode.workspace.findFiles(new vscode.RelativePattern(folder,'**/*'),exclude,10001);
          const entries=uris.map(uri=>({uri,path:uri.path.slice(folder.uri.path.length+1)})).filter(f=>safePath(f.path)&&(!args.prefix||f.path.startsWith(args.prefix)));
          if(request.name==='project_list_files')result={project:folder.name,paths:entries.slice(0,5000).map(f=>f.path),truncated:uris.length>10000||entries.length>5000};
          else if(request.name==='project_search'){
            if(typeof args.query!=='string'||!args.query||args.query.length>200)throw new Error('Søg med 1–200 tegn');
            const matches=[];let inspected=0,total=0;
            for(const f of entries){
              if(matches.length>=100||total>8*1024*1024)break;
              try{await noSymlink(folder.uri,f.path);const stat=await vscode.workspace.fs.stat(f.uri);if(stat.size>262144)continue;const text=await textAt(f.uri);total+=Buffer.byteLength(text);inspected++;const lines=text.split('\n');for(let i=0;i<lines.length&&matches.length<100;i++)if(lines[i].toLocaleLowerCase().includes(args.query.toLocaleLowerCase()))matches.push({path:f.path,line:i+1,text:lines[i].slice(0,500)});}catch{}
            }
            result={project:folder.name,matches,inspected,truncated:matches.length>=100||total>8*1024*1024||uris.length>10000};
          }else throw new Error('Ukendt projektværktøj');
        }
      }
      await api('bridge-results/'+request.id,'POST',result);
    }catch(e){await api('bridge-results/'+request.id,'POST',{error:e.message,code:e.code==='WORKSPACE_UNTRUSTED'?e.code:'PROJECT_TOOL_ERROR'}).catch(()=>{});}finally{bridgeInFlight.delete(request.id);}
  }
  async function applyChanges({automatic=false}={}){
    if(!changes?.length||!activeFolder)return;
    if(!vscode.workspace.isTrusted)throw new Error('Projektmappen skal være betroet');
    const edit=new vscode.WorkspaceEdit();
    for(const c of changes){
      if(!safePath(c.path)||!['create','modify','delete'].includes(c.kind))throw new Error('Ugyldigt filresultat fra serveren');
      await noSymlink(activeFolder.uri,c.path);const uri=vscode.Uri.joinPath(activeFolder.uri,c.path);
      const original=baseline.get(c.path);
      if(c.kind==='create'){
        if(original!==undefined||c.baseHash!==null)throw new Error('Ugyldigt grundlag for ny fil: '+c.path);
        try{await vscode.workspace.fs.stat(uri);throw new Error('Filen findes allerede: '+c.path);}catch(e){if(e.code!=='FileNotFound')throw e;}
        edit.createFile(uri,{overwrite:false});edit.insert(uri,new vscode.Position(0,0),c.content);
      }else{
        if(original===undefined||hash(original)!==c.baseHash)throw new Error('Forkert versionsgrundlag: '+c.path);
        const current=await textAt(uri);if(hash(current)!==c.baseHash)throw new Error('Filen er ændret siden opgaven startede: '+c.path+'. Ingen ændringer blev anvendt.');
        if(c.kind==='delete')edit.deleteFile(uri,{ignoreIfNotExists:false});else{const doc=await vscode.workspace.openTextDocument(uri);edit.replace(uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),c.content);}
      }
    }
    if(!await vscode.workspace.applyEdit(edit))throw new Error('VS Code kunne ikke anvende alle ændringer. Kontrollér Source Control.');
    if(automatic)for(const change of changes.filter(c=>c.kind!=='delete')){const document=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(activeFolder.uri,change.path));if(!await document.save())throw new Error('Kunne ikke gemme '+change.path+'. Ændringerne ligger fortsat i editoren.');}
    changes=null;send({type:'applied',automatic,runId:changesRunId});vscode.window.showInformationMessage(automatic?'Kodeændringer anvendt og gemt automatisk.':'Kodeændringer anvendt. Gennemgå dem i Source Control, og gem filerne.');
    if(changesRunId)await api('runs/'+changesRunId+'/application','POST',{status:automatic?'saved':'applied'}).catch(()=>send({type:'notice',text:'Ændringerne er anvendt, men kvitteringen kunne ikke gemmes på serveren.'}));
  }
  async function savedChangesMatch(items){
    const folder=workingFolder();if(!folder||!vscode.workspace.isTrusted||!items?.length)return false;
    try{for(const c of items){if(!safePath(c.path))return false;await noSymlink(folder.uri,c.path);const uri=vscode.Uri.joinPath(folder.uri,c.path);if(c.kind==='delete'){try{await vscode.workspace.fs.stat(uri);return false;}catch(e){if(e.code!=='FileNotFound')return false;}}else{const disk=await vscode.workspace.fs.readFile(uri);if(hash(Buffer.from(disk))!==hash(c.content))return false;}}return true;}catch{return false;}
  }
  async function watch(id,offset=0){
    try{const run=await api('runs/'+id);if(activeRun!==id)return;activeFullAccess=run.fullAccess===true;for(const event of run.events.slice(offset)){if(event.type==='image'){const {bytes,mime}=await loadImage(id,event.image.id);send({...event,runId:id,image:{...event.image,data:'data:'+mime+';base64,'+bytes.toString('base64')}});}else send(event);}for(const message of run.messages||[])send({type:'user-message',message});for(const request of run.bridgeRequests||[])bridgeRequest(request);
      if(run.status==='running'){pollTimer=setTimeout(()=>watch(id,run.events.length),700);return;}
      if(run.status==='completed'){if(!run.events.some(e=>e.type==='result'))send({type:'result',answer:run.answers?.at(-1),details:run.answers?.slice(0,-1)||[]});changes=run.changes||[];changesRunId=id;const automatic=run.autoApply===true&&changes.length>0;send({type:'done',runId:id,report:run.changeReport,changes:changes.map(c=>({path:c.path,kind:c.kind})),autoApplying:automatic});if(automatic){try{await applyChanges({automatic:true});}catch(e){send({type:'auto-apply-stopped',runId:id,text:'Automatisk overførsel stoppet: '+e.message});}}}
      else send({type:'error',text:run.error||run.status});
      localController?.abort();activeRun=null;send({type:'idle'});
    }catch(e){send({type:'error',text:'Forbindelsen afbrudt: '+e.message+'. Forsøger igen…'});if(activeRun===id)pollTimer=setTimeout(()=>watch(id,offset),3000);}
  }
  const register=(name,fn)=>context.subscriptions.push(vscode.commands.registerCommand(name,async()=>{try{await fn();}catch(e){vscode.window.showErrorMessage(e.message);}}));
  register('fjordagent.connect',connect);
  register('fjordagent.chat',async()=>{
    await vscode.commands.executeCommand('workbench.view.extension.fjordagent');
    await vscode.commands.executeCommand('fjordagent.chatView.focus');
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('fjordagent.chatView',{resolveWebviewView:mountChat},{webviewOptions:{retainContextWhenHidden:true}}));
  if(context.globalState&&!context.globalState.get('sidebarShown')){
    context.globalState.update('sidebarShown',true);
    vscode.commands.executeCommand('fjordagent.chat').then(undefined,e=>vscode.window.showErrorMessage(e.message));
  }
  function mountChat(view){
    panel=view;
    view.webview.options={enableScripts:true,localResourceRoots:[context.extensionUri]};
    const nonce=randomBytes(16).toString('hex'), script=panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,'chat.js')),changeScript=panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,'runtime','change-view.js')),changeStyle=panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,'runtime','change-view.css'));
    panel.webview.html=`<!doctype html><html lang="da"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${panel.webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${changeStyle}"><style nonce="${nonce}">
    #team-toggle{align-self:flex-start;font-size:11px}#team-panel{position:absolute;z-index:10;top:65px;left:12px;right:12px;max-height:70%;display:flex;flex-direction:column;border:1px solid var(--vscode-focusBorder,#527788);border-radius:12px;background:var(--vscode-editor-background,#1e1e1e);box-shadow:0 16px 50px #0008;overflow:hidden}#team-panel header{display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid var(--vscode-widget-border,#454545)}#team-log{overflow:auto;overscroll-behavior:contain;padding:10px;min-height:80px}#team-log article{border:1px solid var(--vscode-widget-border,#454545);border-radius:10px;padding:10px;margin:8px 0;background:var(--vscode-textBlockQuote-background)}#team-log article[data-kind=task]{margin-left:18px;border-left:3px solid #a7ebce}#team-log strong{font-size:10px;color:#a7ebce}#team-log p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;font-size:12px;margin:6px 0}.context-info{font-size:10px;color:var(--vscode-descriptionForeground);margin:0}.generated-image{display:block;max-width:100%;max-height:650px;object-fit:contain;border-radius:8px;margin:8px 0}*{box-sizing:border-box}html,body{height:100%;margin:0}body{font:var(--vscode-font-size) var(--vscode-font-family);color:var(--vscode-foreground);padding:12px;display:flex;flex-direction:column;gap:10px}button,select,textarea{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);border-radius:7px;padding:7px}button{cursor:pointer}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:1px solid var(--vscode-focusBorder)}button:disabled{opacity:.4;cursor:default}.chat-heading{display:flex;align-items:center;justify-content:space-between}.chat-heading strong{font-size:14px}.chat-heading span{font-size:9px;letter-spacing:1px;color:var(--vscode-descriptionForeground)}.settings{font-size:11px;color:var(--vscode-descriptionForeground)}.settings summary{cursor:pointer}.row{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.settings p{font-size:11px;overflow-wrap:anywhere;margin:7px 0}#messages{flex:1;min-height:0;overflow:auto;padding:8px 0;scroll-behavior:smooth}.welcome{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:var(--vscode-descriptionForeground);gap:12px}.welcome .mark{font-size:34px;color:#a7ebce}.welcome strong{font-size:18px;color:var(--vscode-foreground)}.welcome p{font-size:12px;max-width:240px;line-height:1.6;margin:0}.message{padding:12px 5px;margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}.message.user{background:var(--vscode-textBlockQuote-background);border-radius:12px;padding:12px}.author{font-size:10px;color:#a7ebce;display:block;margin-bottom:6px;letter-spacing:.5px}#form{border:1px solid var(--vscode-input-border,#454545);border-radius:14px;background:var(--vscode-input-background);padding:9px;flex-shrink:0}#form:focus-within{border-color:var(--vscode-focusBorder)}textarea{display:block;width:100%;resize:vertical;border:0;background:transparent;min-height:78px;max-height:220px;padding:4px;outline:none}textarea:focus-visible{outline:0}.composer-tools{display:flex;align-items:center;gap:7px;margin-top:8px}.flow-select{display:flex;align-items:center;gap:4px;min-width:0;flex:1;color:#a7ebce}.flow-select select{width:100%;min-width:0;max-width:100%;font-size:11px;border:0;background:transparent;text-overflow:ellipsis}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}#send{border-radius:50%;width:30px;height:30px;padding:0;font-size:18px}#status{font-size:11px;line-height:1.5;max-height:75px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--vscode-descriptionForeground);margin:0;flex-shrink:0}#status.working:before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#a7ebce;margin-right:7px;animation:working 1.4s infinite}#apply{flex-shrink:0}#workspace{font-size:10px;color:var(--vscode-descriptionForeground);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}[hidden]{display:none!important}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@keyframes working{50%{opacity:.25}}@media(prefers-reduced-motion:reduce){*{animation:none!important;scroll-behavior:auto!important}}
    .work-details{border:1px solid var(--vscode-widget-border,#454545);border-radius:8px;margin:10px 0;padding:9px;color:var(--vscode-descriptionForeground);font-size:11px}.work-details summary{cursor:pointer}.work-details>div{max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.work-details p{border-top:1px solid var(--vscode-widget-border,#454545);padding-top:8px}\n    .attachments{display:flex;gap:6px;flex-wrap:wrap;margin:5px 0}.attachment{display:flex;align-items:center;gap:5px;max-width:100%;padding:4px 6px;border:1px solid var(--vscode-input-border,#454545);border-radius:7px;font-size:11px}.attachment span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.attachment img{width:36px;height:36px;object-fit:cover;border-radius:4px}.attachment button{padding:0 4px}.drop-active{outline:2px dashed var(--vscode-focusBorder)}
    </style></head><body><div class="chat-heading"><strong>FjordAI Agent</strong><span>AGENT WORKSPACE</span></div><details class="settings" id="connection-settings"><summary>Server og forbindelser</summary><div class="row"><button id="connect">Forbind til server</button><button id="app">Åbn FjordAI Agent ↗</button><button id="refresh">Opdater agentflows</button></div><p id="connection-status" role="status">Forbind til din FjordAI Agent-server for at komme i gang.</p></details><div id="messages" aria-live="polite"><div class="welcome" id="welcome"><span class="mark">◈</span><strong>Hvad skal vi bygge?</strong><p>Vælg dit agentflow nedenfor.<br>Dit team tager opgaven herfra.</p></div></div><button id="apply" class="primary" hidden>Anvend kodeændringer i VS Code</button><p id="workspace"></p><form id="form"><label class="sr-only" for="prompt">Din opgave</label><textarea id="prompt" rows="3" maxlength="20000" placeholder="Beskriv din opgave…" ></textarea><div id="attachments" class="attachments" aria-live="polite"></div><input id="attachment-input" type="file" multiple hidden><div class="composer-tools"><button id="attach" type="button" title="Vedhæft filer eller billeder (højst 8 filer / 10 MB)" aria-label="Vedhæft filer eller billeder">+</button><label class="flow-select" for="project"><span>⤳</span><select id="project" aria-label="Agentflow"><option value="">Vælg agentflow</option></select></label><button id="stop" type="button" hidden>Stop</button><button id="send" class="primary" title="Send opgave" aria-label="Send opgave" >↑</button></div></form><p id="status" role="status"></p><script nonce="${nonce}" src="${changeScript}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
    // The workspace bridge belongs to the run, not to a particular chat view.
    view.onDidDispose(()=>{if(panel===view)panel=null;});
    view.webview.onDidReceiveMessage(async m=>{try{
      if(m.type==='connect'){await connect();return;}
      if(m.type==='ready'||m.type==='refresh'){await refreshState();return;}
      if(m.type==='history'&&!activeRun&&!starting){
        const generation=++historyGeneration,state=await api('state'),runs=state.runs.filter(r=>r.projectId===m.projectId&&r.conversationId===state.projects.find(p=>p.id===m.projectId)?.conversationId&&r.status!=='running').slice(-4);if(generation!==historyGeneration||activeRun||starting)return;send({type:'history-start'});
        for(const summary of runs){const run=await api('runs/'+summary.id);if(generation!==historyGeneration||activeRun||starting)return;send({type:'history-text',name:'Dig',text:run.prompt});if(run.id===runs.at(-1)?.id)for(const event of run.events||[])if(event.type==='team')send(event);for(const message of run.messages||[])send({type:'user-message',message});send({type:'history-result',answer:run.answers?.at(-1),details:run.answers?.slice(0,-1)||[]});for(const image of run.images||[]){const {bytes,mime}=await loadImage(run.id,image.id);if(generation!==historyGeneration||activeRun||starting)return;send({type:'image',runId:run.id,name:image.name,image:{...image,data:'data:'+mime+';base64,'+bytes.toString('base64')}});}if(run.error)send({type:'history-text',name:'Status',text:run.error});if(run.status==='completed'&&run.source==='vscode'){const application=run.application?.status||(await savedChangesMatch(run.changes)?'verified':'unknown');if(generation!==historyGeneration||activeRun||starting)return;send({type:'change-report',runId:run.id,report:run.changeReport,changes:(run.changes||[]).map(c=>({path:c.path,kind:c.kind})),application});}}return;
      }
      if(m.type==='new-conversation'){if(activeRun||starting)throw new Error('Afslut eller stop opgaven først');historyGeneration++;await api('projects/'+m.projectId+'/conversation','POST',{});changes=null;changesRunId=undefined;send({type:'conversation-started'});return;}
      if(m.type==='app'){const {url}=await connection();await vscode.env.openExternal(vscode.Uri.parse(url));return;}
      if(m.type==='followup'){if(!activeRun)throw new Error('Opgaven er afsluttet. Send beskeden som en ny opgave.');const reply=await api('runs/'+activeRun+'/messages','POST',{text:m.text,clientId:m.clientId,includePreviousConversations:m.includePreviousConversations===true});send({type:'followup-sent',message:reply.message});return;}
      if(m.type==='stop'){localController?.abort();if(activeRun)await api('runs/'+activeRun+'/stop','POST');return;}
      if(m.type==='apply'){await applyChanges();return;}
      if(m.type==='save-image'){const image=await loadImage(m.runId,m.imageId),ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[image.mime];const uri=await vscode.window.showSaveDialog({saveLabel:'Gem billede',filters:{Billede:[ext]}});if(uri)await vscode.workspace.fs.writeFile(uri,image.bytes);return;}
      if(m.type==='approval'){if(!activeRun)return;const run=await api('runs/'+activeRun);if(!run.events.some(e=>e.type==='approval'&&e.id===m.id))throw new Error('Ukendt godkendelse');await api('approvals/'+m.id,'POST',{accept:m.accept===true});send({type:'approved',id:m.id});return;}
      if(m.type!=='run'||activeRun||starting)return;
      if(!vscode.workspace.isTrusted)throw new Error('Projektmappen skal være betroet');
      if(typeof m.prompt!=='string'||!m.prompt.trim()||m.prompt.length>20000)throw new Error('Skriv en opgave på højst 20.000 tegn');
      historyGeneration++;starting=true;send({type:'busy'});
      try{
        const folders=await projects();if(!folders?.length)throw new Error('Åbn først en projektmappe');
        const folder=workingFolder();if(!folder)throw new Error('Åbn først en mappe i Explorer');
        const projectId=m.projectId;
        const files=await snapshot(folder);activeProjects=folders;
        const run=await api('runs','POST',{projectId,prompt:m.prompt,includePreviousConversations:m.includePreviousConversations===true,files,attachments:m.attachments,bridge:true,projectName:folder.name});
        localController?.abort();localController=new AbortController();activeFullAccess=false;activeFolder=folder;baseline=new Map(files.map(f=>[f.path,f.content]));changes=null;activeRun=run.id;activeProjectId=projectId;send({type:'started',runId:run.id,prompt:m.prompt,attachments:(m.attachments||[]).map(a=>({name:a.name}))});watch(run.id);
      }finally{starting=false;if(!activeRun)send({type:'idle'});}
    }catch(e){send({type:m.type==='followup'?'followup-error':m.type==='new-conversation'?'conversation-error':'error',text:e.message});if(!activeRun&&!starting)send({type:'idle'});}});
  }
}
function deactivate(){clearTimeout(pollTimer);}
module.exports={activate,deactivate};
