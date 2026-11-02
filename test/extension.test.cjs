const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const vm=require('node:vm');const {hash}=require('../src/workspace.cjs');
test('VS Code client sends no ChatGPT login, detects local conflicts and applies reviewed edits',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjordagent-extension-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'README.md'),'original');fs.mkdirSync(path.join(dir,'nested-project'));fs.writeFileSync(path.join(dir,'nested-project/package.json'),'{}');
 const uri=p=>({fsPath:p,path:p,toString:()=>p});const folder={name:'test-project',uri:uri(dir)};let handler,provider,applied=false;const commands={},messages=[],requests=[];
 class Edit{replace(...args){this.change=args;}createFile(){}insert(){}deleteFile(){}}
 const vscode={Uri:{joinPath:(u,...p)=>uri(path.join(u.fsPath,...p))},ViewColumn:{Beside:2},FileType:{File:1,Directory:2,SymbolicLink:64},Range:class{},Position:class{},WorkspaceEdit:Edit,
  commands:{registerCommand:(name,fn)=>{commands[name]=fn;return{};},executeCommand:async name=>{if(commands[name])return commands[name]();if(name==='fjordagent.chatView.focus')provider.resolveWebviewView({webview:{asWebviewUri:()=> 'script.js',postMessage:m=>messages.push(m),onDidReceiveMessage:fn=>{handler=fn;}},onDidDispose:()=>{}});}},
  workspace:{isTrusted:true,workspaceFolders:[folder],textDocuments:[],getConfiguration:()=>({get:()=> 'http://test-server'}),fs:{readDirectory:async u=>fs.readdirSync(u.fsPath,{withFileTypes:true}).map(e=>[e.name,e.isDirectory()?2:1]),stat:async u=>{try{const s=fs.lstatSync(u.fsPath);return{size:s.size,type:s.isSymbolicLink()?64:s.isDirectory()?2:1};}catch(e){e.code='FileNotFound';throw e;}},readFile:async u=>fs.readFileSync(u.fsPath)},openTextDocument:async u=>({getText:()=>fs.readFileSync(u.fsPath,'utf8'),positionAt:n=>n}),applyEdit:async e=>{applied=true;assert.equal(e.change[2],'updated');return true;}},
  window:{registerWebviewViewProvider:(id,p)=>{assert.equal(id,'fjordagent.chatView');provider=p;return{};},showQuickPick:()=>{throw new Error('Send must use Explorer without opening a picker');},showInformationMessage:()=>{},showErrorMessage:e=>{throw new Error(e);}}
 };
 const fetch=async(url,opts={})=>{requests.push({url,opts});let result;
  if(url.endsWith('/api/state'))result={projects:[{id:'project',name:'My agent workflow'},{id:'other-project',name:'test-project'}],workflows:[{id:'ask',name:'Ask',steps:[]}]};
  else if(url.endsWith('/api/runs')){const b=JSON.parse(opts.body);assert.equal(b.projectId,'project');assert.equal(b.bridge,true);assert.equal(b.projectName,'test-project');assert.equal(b.files[0].path,'README.md');assert.equal(b.attachments[0].name,'notes.txt');assert.equal(b.attachments[0].data,'aGVq');result={id:'run'};}
  else if(url.endsWith('/api/runs/run'))result={status:'completed',events:[],changes:[{path:'README.md',kind:'modify',content:'updated',baseHash:hash('original')}]};
  else throw new Error('Unexpected request '+url);
  return{ok:true,json:async()=>result};
 };
 const sandbox={module:{exports:{}},require:name=>name==='vscode'?vscode:name==='./runtime/workspace.cjs'?require('../src/workspace.cjs'):name==='./local-command.cjs'?require('../extension/local-command.cjs'):require(name),fetch,Buffer,URL,TextDecoder,AbortController,AbortSignal,setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/extension.cjs'),'utf8'),sandbox);
 sandbox.module.exports.activate({subscriptions:[],secrets:{get:async()=> 'test-key'},extensionUri:uri('/extension')});await commands['fjordagent.chat']();await handler({type:'ready'});await handler({type:'run',projectId:'project',workflowId:'ask',prompt:'hej',attachments:[{name:'notes.txt',data:'aGVq'}]});for(let i=0;i<20&&!messages.some(m=>m.type==='done');i++)await new Promise(r=>setTimeout(r,5));assert.ok(messages.some(m=>m.type==='done'));
 fs.writeFileSync(path.join(dir,'README.md'),'local edit');await handler({type:'apply'});assert.equal(applied,false);assert.ok(messages.some(m=>m.type==='error'&&m.text.includes('ændret siden')));
 fs.writeFileSync(path.join(dir,'README.md'),'original');await handler({type:'apply'});assert.equal(applied,true);assert.ok(messages.some(m=>m.type==='applied'));assert.ok(!requests.some(r=>r.url.includes('/account/login')));
});
test('sidebar opens before connection and gives a visible setup action',async()=>{
 const commands={},messages=[];let provider,handler;
 const view={webview:{asWebviewUri:()=> 'chat.js',postMessage:m=>messages.push(m),onDidReceiveMessage:fn=>handler=fn},onDidDispose:()=>{}};
 const vscode={Uri:{joinPath:()=>({})},commands:{registerCommand:(name,fn)=>{commands[name]=fn;return{};},executeCommand:async name=>{if(name==='fjordagent.chatView.focus')provider.resolveWebviewView(view);}},window:{registerWebviewViewProvider:(id,p)=>{provider=p;return{};},showErrorMessage:e=>{throw new Error(e);}},workspace:{getConfiguration:()=>({get:()=>''})}};
 const sandbox={module:{exports:{}},require:name=>name==='vscode'?vscode:name==='./runtime/workspace.cjs'?require('../src/workspace.cjs'):name==='./local-command.cjs'?require('../extension/local-command.cjs'):require(name),fetch:()=>{throw new Error('Unconfigured sidebar must not make requests');},Buffer,URL,TextDecoder,AbortController,AbortSignal,setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/extension.cjs'),'utf8'),sandbox);
 sandbox.module.exports.activate({subscriptions:[],secrets:{get:async()=>null},extensionUri:{}});await commands['fjordagent.chat']();await handler({type:'ready'});
 assert.match(view.webview.html,/id="connect"/);assert.ok(messages.some(m=>m.type==='connection'&&m.connected===false));assert.equal(view.webview.options.enableScripts,true);
 const manifest=require('../extension/package.json');assert.equal(manifest.contributes.views.fjordagent[0].id,'fjordagent.chatView');assert.equal(manifest.contributes.views.fjordagent[0].type,'webview');assert.ok(fs.existsSync(path.join(__dirname,'../extension',manifest.contributes.viewsContainers.secondarySidebar[0].icon)));
});


test('VS Code bridge runs local commands only after approval or Full access and returns the actual host result',async()=>{
 for(const mode of ['reject','approve','full']){
  const commands={},messages=[];let provider,handler,posted,polls=0,asked=0;
  const uri=p=>({fsPath:p,path:p,toString:()=>p}),folder={name:'local',uri:uri(os.tmpdir())};
  const fake={Uri:{joinPath:(u,...p)=>uri(path.join(u.fsPath,...p))},FileType:{Directory:2,SymbolicLink:64},
   commands:{registerCommand:(n,f)=>{commands[n]=f;return{};},executeCommand:async n=>{if(n==='fjordagent.chatView.focus')provider.resolveWebviewView({webview:{asWebviewUri:()=>'',postMessage:m=>messages.push(m),onDidReceiveMessage:f=>handler=f},onDidDispose(){}});}},
   window:{registerWebviewViewProvider:(n,p)=>{provider=p;return{};},showWarningMessage:async()=>{asked++;return mode==='approve'?'K?r kommando':undefined;},showErrorMessage:e=>{throw Error(e);}},
   workspace:{isTrusted:true,workspaceFolders:[folder],textDocuments:[],getConfiguration:()=>({get:()=> 'http://test'}),fs:{readDirectory:async()=>[],stat:async()=>{throw Object.assign(Error('missing'),{code:'FileNotFound'});}}}};
  const fetch=async(url,opts={})=>{let result;
   if(url.endsWith('/api/runs'))result={id:'run'};
   else if(url.endsWith('/api/runs/run')){polls++;result={status:posted?'completed':'running',fullAccess:mode==='full',events:[],changes:[],bridgeRequests:posted?[]:[{id:'command',name:'project_run_command',arguments:{command:process.platform==='win32'?"Write-Output 'local-ok'":"echo local-ok"}}]};}
   else if(url.endsWith('/api/bridge-results/command')){posted=JSON.parse(opts.body);result={ok:true};}
   else result={projects:[]};return{ok:true,json:async()=>result};
  };
  const sandbox={module:{exports:{}},require:n=>n==='vscode'?fake:n==='./runtime/workspace.cjs'?require('../src/workspace.cjs'):n==='./local-command.cjs'?require('../extension/local-command.cjs'):require(n),fetch,Buffer,URL,TextDecoder,AbortController,AbortSignal,setTimeout:(f,m)=>setTimeout(f,Math.min(m,10)),clearTimeout};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/extension.cjs'),'utf8'),sandbox);sandbox.module.exports.activate({subscriptions:[],secrets:{get:async()=> 'key'},extensionUri:uri('/extension')});await commands['fjordagent.chat']();await handler({type:'run',projectId:'p',prompt:'Run locally'});
  for(let i=0;i<300&&!messages.some(m=>m.type==='idle');i++)await new Promise(r=>setTimeout(r,10));
  assert.ok(posted,mode);assert.equal(asked,mode==='full'?0:1);
  if(mode==='reject')assert.match(posted.error,/godkendt/);else{assert.equal(posted.exitCode,0);assert.match(posted.output,/local-ok/);assert.equal(posted.host,'vscode');}
 }
});
