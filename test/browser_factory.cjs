// npm install --no-save playwright, or set PLAYWRIGHT_MODULE to its installed path.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createApp}=require('../src/server.cjs');const {EventEmitter}=require('node:events');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
class Fake extends EventEmitter{
 constructor(imageFile){super();this.imageFile=imageFile;this.threads=new Map();this.next=0;}
 async rpc(method,p){
  if(method==='account/read')return {account:{type:'chatgpt'}};
  if(method==='model/list')return {data:[],nextCursor:null};
  if(method==='thread/start'){const id='t'+this.next++;this.threads.set(id,p);return {thread:{id}};}
  if(method==='turn/start'){const router=this.threads.get(p.threadId).developerInstructions.includes('ROUTER'),text=p.outputSchema?.properties.summary?JSON.stringify({summary:'Understand the task only',intent:'test'}):router?JSON.stringify({routes:['chosen'],reason:'Chosen route'}):'A complete answer';setImmediate(()=>{if(!p.outputSchema&&this.imageFile)this.emit('message',{method:'item/completed',params:{threadId:p.threadId,item:{type:'imageGeneration',status:'completed',savedPath:this.imageFile,result:''}}});this.emit('message',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',text}}});this.emit('message',{method:'turn/completed',params:{threadId:p.threadId,turn:{status:'completed'}}});});return {turn:{id:'turn'}};}return {};
 }close(){}
}
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-visual-')),imageFile=path.join(dir,'codex','generated_images','bird.png');fs.mkdirSync(path.dirname(imageFile),{recursive:true});fs.writeFileSync(imageFile,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));const app=createApp({dataDir:dir,codexFactory:()=>new Fake(imageFile)});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  browser=await chromium.launch({args:['--enable-unsafe-swiftshader'],...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
  const base='http://127.0.0.1:'+app.server.address().port,context=await browser.newContext({viewport:{width:1600,height:1000}}),request=context.request;
  assert.ok((await request.post(base+'/api/setup',{data:{username:'owner',password:'test-password-123'}})).ok());
  const project=await(await request.post(base+'/api/projects',{data:{name:'Factory preview'}})).json();
  const types=['start','analysis','agent','router','condition','text','merge','end'];
  const nodes=types.map((type,i)=>({id:type,type,name:type,x:60+i*310,y:200,instructions:type==='router'?'ROUTER':'BUILD',access:'write',...(type==='router'?{routes:[{id:'chosen',name:'Chosen',rule:''},{id:'unused',name:'Unused',rule:''}],routeMode:'one',routingInput:'both'}:{}),...(type==='condition'?{match:'all',rules:[{source:'prompt',op:'contains',value:'Test'}]}:{}),...(type==='text'?{template:'{{input}}'}:{})}));
  const edges=nodes.slice(0,-1).map((n,i)=>({source:n.id,target:nodes[i+1].id,port:n.type==='router'?'chosen':n.type==='condition'?'yes':'out'}));
  edges.push({source:'router',target:'end',port:'unused'},{source:'condition',target:'end',port:'no'});
  assert.ok((await request.patch(base+'/api/projects/'+project.id,{data:{name:project.name,graph:{nodes,edges},startNodeId:'start'}})).ok());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(base);await page.locator('[data-tab=workflows]').click();await page.waitForFunction(()=>window.fjordFactory?.diagnostics().webgl);
  await page.getByRole('button',{name:'Skjul skilte',exact:true}).click();assert.equal(await page.locator('.factory-labels').isVisible(),false);
  const machinePoint=await page.evaluate(()=>{const f=fjordFactory,m=f.machines.find(m=>m.node.id==='agent'),p=m.position.clone();p.y=2.6;p.project(f.camera);const r=f.renderer.domElement.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(-p.y+1)*r.height/2};});await page.mouse.click(machinePoint.x,machinePoint.y);assert.equal(await page.evaluate(()=>fjordFactory.selected),'agent');
  await page.getByRole('button',{name:'Vis skilte',exact:true}).click();
  await request.post(base+'/api/runs',{data:{projectId:project.id,prompt:'Test instant answer'}});
  await page.waitForFunction(()=>fjordFactory.diagnostics().active==='start');
  const visited=new Set(),transferred=new Set(),opened=new Set();let moving=false,arrived=false;
  for(let i=0;i<250;i++){
   const d=await page.evaluate(()=>{const f=fjordFactory;return {...f.diagnostics(),progress:f.playback.transfers.map(t=>t.progress),lights:f.machines.filter(m=>m.workLight.material.emissiveIntensity>0).map(m=>m.node.id),doors:f.machines.flatMap(m=>m.doors.filter(d=>d.open>.75).map(d=>m.node.id+':'+d.side))};});
   for(const door of d.doors)opened.add(door);
   if(d.active)visited.add(d.active);for(const e of d.flowing)transferred.add(e.source+':'+e.port+'>'+e.target);
   if(d.progress.some(p=>p>0&&p<1))moving=true;
   if(d.active==='agent'&&!visited.has('agent-captured')){await page.screenshot({path:'test-results/factory-working.png'});assert.ok(d.lights.includes('agent'));visited.add('agent-captured');}
   if(visited.has('end')&&!d.active&&!d.queued&&!d.flowing.length){arrived=true;break;}
   await page.waitForTimeout(100);
  }
  assert.ok(arrived,'animation must finish');assert.equal(visited.size,9);assert.equal(transferred.size,7);assert.ok(moving);assert.ok(![...transferred].some(e=>e.includes('unused')||e.includes(':no>')));
  for(const door of ['start:out','analysis:in','analysis:out','agent:in','agent:out','text:in','text:out','end:in'])assert.ok(opened.has(door),'port must open during its transfer: '+door);
  assert.ok(!opened.has('start:in'));assert.ok(!opened.has('end:out'));
  await page.waitForFunction(()=>fjordFactory.machines.every(m=>m.doors.every(d=>d.open===0)));
  await page.locator('#factory-fullscreen').click();await page.locator('#factory-fit').click();await page.screenshot({path:'test-results/factory-textures.png'});
  // A closer look at intake, agent and delivery with the same production geometry.
  await page.evaluate(()=>{const f=fjordFactory;const nodes=f.project.graph.nodes.filter(n=>['start','agent','end'].includes(n.type)).map((n,i)=>({...n,x:60+i*310,y:200}));f.set({...f.project,graph:{nodes,edges:[{source:'start',target:'agent',port:'out'},{source:'agent',target:'end',port:'out'}]}});});
  await page.screenshot({path:'test-results/factory-closeup.png'});
  await page.evaluate(()=>{const f=fjordFactory;f.camera.position.copy(f.controls.target).add({x:16,y:6,z:24});f.camera.lookAt(f.controls.target);f.controls.update();f.render();});
  await page.screenshot({path:'test-results/factory-doors-closed.png'});
  // Three belts from one named output have distinct physical machine exits.
  const bays=await page.evaluate(()=>{
   const f=fjordFactory,router={...f.project.graph.nodes.find(n=>n.type==='start'),id:'split',type:'router',name:'Fordeler',x:60,y:300,routes:[{id:'chosen',name:'Billede'},{id:'unused',name:'Tekst'}]};
   const nodes=[router,...['agent','text','end'].map((type,i)=>({id:'branch-'+i,type,name:'Modtager '+(i+1),x:650,y:30+i*270,access:'read'}))];
   f.set({...f.project,graph:{nodes,edges:nodes.slice(1).map(n=>({source:'split',target:n.id,port:'chosen'}))}});
   f.playback.transfers=[{source:'split',target:'branch-0',port:'chosen',progress:.2}];f.updateVisuals();f.animate(0,200);f.render();
   return{starts:f.belts.map(b=>b.curve.getPoint(0).z),doors:f.machines.find(m=>m.node.id==='split').doors.map(d=>({target:d.edge?.target,open:d.open}))};
  });
  assert.equal(new Set(bays.starts).size,3);assert.ok(bays.starts[1]-bays.starts[0]>=1.11);assert.ok(bays.starts[2]-bays.starts[1]>=1.11);
  assert.equal(bays.doors.length,4);assert.deepEqual(bays.doors.filter(d=>d.open>.75).map(d=>d.target),['branch-0']);
  await page.screenshot({path:'test-results/factory-multiple-exits.png'});
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>fjordFactory.diagnostics().reducedMotion&&fjordFactory.diagnostics().flowing.length===0&&fjordFactory.machines.every(m=>m.doors.every(d=>d.open===0)));
  await page.locator('#factory-fullscreen').click();await page.setViewportSize({width:390,height:1000});await page.locator('#factory-fit').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/factory-mobile.png'});assert.deepEqual(errors,[]);
  await page.locator('#factory-label-toggle').click();await page.reload();await page.locator('[data-tab=workflows]').click();await page.getByRole('button',{name:'Vis skilte',exact:true}).waitFor();assert.equal(await page.locator('.factory-labels').isVisible(),false);
  await page.locator('[data-tab=chat]').click();await page.evaluate(()=>history());await page.waitForFunction(()=>[...document.querySelectorAll('.generated-image img')].some(img=>img.complete&&img.naturalWidth>0));await page.screenshot({path:'test-results/generated-image-chat.png'});
  // Exercise the production composer HTML and script, with the VS Code host API mocked.
  const composer=await context.newPage();const source=fs.readFileSync(path.join(__dirname,'../extension/extension.cjs'),'utf8');const html=source.match(/panel\.webview\.html=`([\s\S]*?)`;/)[1].replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,'').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link rel="stylesheet"[^>]+>/g,'').replace(/\$\{nonce\}/g,'qa');await composer.setContent(html);
  await composer.evaluate(()=>{window.sent=[];window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:m=>sent.push(m)});});await composer.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../public/change-view.js'),'utf8')});await composer.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../public/change-view.css'),'utf8')});await composer.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../extension/chat.js'),'utf8')});
  await composer.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{type:'connection',connected:true,url:'test'}})));
  await composer.setViewportSize({width:390,height:900});await composer.addStyleTag({content:':root{--vscode-font-size:13px;--vscode-font-family:system-ui;--vscode-foreground:#d4d4d4;--vscode-descriptionForeground:#aaa;--vscode-input-foreground:#eee;--vscode-input-background:#252526;--vscode-button-background:#256b9b;--vscode-button-foreground:#fff;--vscode-focusBorder:#5caaff;--vscode-textBlockQuote-background:#2c333a}body{background:#1e1e1e}'});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  await composer.evaluate(data=>dispatchEvent(new MessageEvent('message',{data:{type:'image',name:'Artist',runId:'run',image:{id:'bird',data:'data:image/png;base64,'+data}}})),png.toString('base64'));await composer.waitForFunction(()=>document.querySelector('.generated-image')?.naturalWidth>0);await composer.getByRole('button',{name:'Gem billede',exact:true}).click();assert.equal(await composer.evaluate(()=>sent.some(m=>m.type==='save-image'&&m.imageId==='bird')),true);
  await composer.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{type:'compaction',state:'started',scope:'project'}})));assert.match(await composer.locator('#context-info').textContent(),/Komprimerer/);
  await composer.locator('#attachment-input').setInputFiles([{name:'screen.png',mimeType:'image/png',buffer:png},{name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('blue header')}]);await composer.waitForFunction(()=>document.querySelectorAll('.attachment').length===2);assert.equal(await composer.locator('.attachment img').count(),1);
  await composer.screenshot({path:'test-results/composer-attachments.png'});
  await composer.locator('#prompt').fill('Read these');await composer.locator('#prompt').press('Enter');const sent=await composer.evaluate(()=>sent.find(m=>m.type==='run'));assert.equal(sent.attachments.length,2);assert.equal(sent.attachments[0].data,png.toString('base64'));await composer.locator('#prompt').press('Enter');assert.equal(await composer.evaluate(()=>sent.filter(m=>m.type==='run').length),1);
  await composer.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{type:'error',text:'Retry'}})));assert.equal(await composer.locator('.attachment').count(),2);
  await composer.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{type:'started',prompt:'Read these',attachments:[{name:'screen.png'},{name:'notes.txt'}]}})));assert.equal(await composer.locator('.attachment').count(),0);assert.ok((await composer.locator('#messages').textContent()).includes('screen.png'));
  await composer.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{type:'idle'}})));await composer.locator('#prompt').fill('line1');await composer.locator('#prompt').press('Shift+Enter');assert.ok((await composer.locator('#prompt').inputValue()).includes('\n'));
  // Clipboard and drop use the same size checks and selection UI.
  await composer.evaluate(()=>{const data=new DataTransfer();data.items.add(new File(['paste'],'clipboard.txt',{type:'text/plain'}));document.querySelector('#prompt').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});await composer.waitForFunction(()=>document.querySelectorAll('.attachment').length===1);
  await composer.evaluate(()=>{const data=new DataTransfer();data.items.add(new File(['drop'],'dropped.txt',{type:'text/plain'}));document.querySelector('#form').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));});await composer.waitForFunction(()=>document.querySelectorAll('.attachment').length===2);
  await composer.getByRole('button',{name:'Fjern clipboard.txt',exact:true}).click();assert.equal(await composer.locator('.attachment').count(),1);
  await composer.locator('#prompt').fill('');await composer.locator('#send').click();assert.equal(await composer.evaluate(()=>sent.filter(m=>m.type==='run').length),2);
  await composer.screenshot({path:'test-results/composer.png'});
  await composer.evaluate(()=>{for(const data of [{type:'team',kind:'task-request',fromName:'Backend',toName:'Fordeler',text:'Byg en Gem-knap'},{type:'team',kind:'task',fromName:'Fordeler',toName:'Frontend',text:'Knappen skal kalde POST /api/save'}])dispatchEvent(new MessageEvent('message',{data}));});
  await composer.locator('#team-toggle').click();assert.equal(await composer.locator('#team-panel').isVisible(),true);assert.match(await composer.locator('#team-log').textContent(),/POST \/api\/save/);await composer.screenshot({path:'test-results/team-thread-vscode.png'});await composer.locator('#team-panel button').click();assert.equal(await composer.locator('#team-panel').isVisible(),false);await composer.locator('#team-toggle').click();await composer.keyboard.press('Escape');assert.equal(await composer.locator('#team-panel').isVisible(),false);await composer.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{type:'history-start'}})));assert.equal(await composer.locator('#team-log article').count(),0);
  await composer.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{type:'done',runId:'change-run',autoApplying:true,changes:[{path:'fjordseed/static/nordic-caravan.js',kind:'modify'}],report:{added:24,removed:15,files:[{path:'fjordseed/static/nordic-caravan.js',kind:'modify',added:24,removed:15,diff:'--- a/file.js\n+++ b/file.js\n@@ -1 +1 @@\n-old\n+<script>window.bad=true</script>\n'}]}}})));
  assert.match(await composer.locator('.change-report').textContent(),/1 fil ændret/);assert.match(await composer.locator('.change-report').textContent(),/24 tilføjede/);await composer.locator('.change-report summary').click();assert.equal(await composer.evaluate(()=>window.bad),undefined);await composer.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{type:'applied',runId:'change-run',automatic:true}})));assert.match(await composer.locator('.change-application').textContent(),/Anvendt og gemt/);await composer.screenshot({path:'test-results/change-report-vscode-mobile.png'});assert.ok(await composer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await composer.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{type:'auto-apply-stopped',runId:'change-run',text:'Lokal filkonflikt; ingen ændringer blev anvendt.'}})));assert.match(await composer.locator('.change-application').textContent(),/filkonflikt/);
  await composer.setViewportSize({width:900,height:1000});await composer.screenshot({path:'test-results/change-report-vscode-desktop.png'});
  await composer.evaluate(()=>{dispatchEvent(new MessageEvent('message',{data:{type:'history-start'}}));dispatchEvent(new MessageEvent('message',{data:{type:'change-report',runId:'old',application:'verified',changes:[{path:'old.js',kind:'modify'}]}}));});assert.match(await composer.locator('.change-application').textContent(),/matcher de gemte ændringer/);assert.equal(await composer.locator('.change-report').count(),1);assert.match(await composer.locator('.change-report').textContent(),/old.js/);
  console.log('PASS fast-run replay, all seven machines, selected transfers, lights, desktop/mobile, reduced motion, attachments and composer keyboard behavior');
 }finally{await browser?.close();app.close();fs.rmSync(dir,{recursive:true,force:true});}
}
fs.mkdirSync('test-results',{recursive:true});main().catch(e=>{console.error(e);process.exitCode=1;});
