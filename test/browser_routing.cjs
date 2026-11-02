const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const {createApp}=require('../src/server.cjs');
(async()=>{
 const dir=fs.mkdtempSync('/tmp/fjordagent-routing-');
 const app=createApp({dataDir:dir,codexFactory:()=>({rpc:async()=>({account:null}),close(){}})});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),base='http://127.0.0.1:'+app.server.address().port;
  assert.ok((await context.request.post(base+'/api/setup',{data:{username:'owner',password:'test-password-123'}})).ok());
  const project=await(await context.request.post(base+'/api/projects',{data:{name:'Routing test'}})).json();
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('[data-tab=workflows]').click();await page.locator('#edit-workflow').click();
  await page.locator('[data-node-type=router]').click();
  await page.getByLabel('Send videre til',{exact:true}).selectOption('multiple');
  await page.getByLabel('Navn på udgang 1',{exact:true}).fill('Kode');
  await page.getByLabel('Hvad skal sendes til udgang 1?',{exact:true}).fill('Opgaver der kræver kodeændringer');
  await page.getByLabel('Tilføj modtager til udgang 1',{exact:true}).selectOption('agent-0');
  assert.equal(await page.locator('.routing-route').first().getByRole('button').count(),2);
  const end=project.graph.nodes.find(n=>n.type==='end').id;
  await page.getByLabel('Tilføj modtager til udgang 2',{exact:true}).selectOption(end);
  await page.getByRole('button',{name:'+ Tilføj udgang',exact:true}).click();
  await page.getByLabel('Tilføj modtager til udgang 3',{exact:true}).selectOption('agent-0');
  const router=await page.locator('.flow-node.type-router').getAttribute('data-node-id');
  await page.locator('#flow-arrange').click();
  await page.locator('.flow-port.out[data-node="start"]').click();await page.locator('.flow-port.in[data-node="'+router+'"]').click();
  await page.locator('#flow-arrange').click();await page.locator('.flow-node.type-router .flow-node-title').click();
  // Each output may have more than one receiver.
  await page.getByLabel('Tilføj modtager til udgang 1',{exact:true}).selectOption(end);
  await page.getByRole('button',{name:'Gem projekt',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('flow-status').textContent==='Gemt');
  const saved=await(await context.request.get(base+'/api/state')).json();
  const graph=saved.projects.find(p=>p.id===project.id).graph,n=graph.nodes.find(n=>n.type==='router');
  assert.equal(n.routes.length,3);assert.equal(n.routeMode,'multiple');assert.equal(n.routes[0].rule,'Opgaver der kræver kodeændringer');
  assert.equal(graph.edges.filter(e=>e.source===router&&e.port===n.routes[0].id).length,2);
  await page.reload();await page.locator('[data-tab=workflows]').click();await page.locator('#edit-workflow').click();
  await page.locator('.flow-node.type-router .flow-node-title').click();assert.equal(await page.getByLabel('Navn på udgang 1',{exact:true}).inputValue(),'Kode');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.getByLabel('Tilføj modtager til udgang 3',{exact:true}).scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:'/tmp/fjordagent-routing-'+width+'.png',fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log('PASS router outputs, criteria, multiple recipients, save/reload and desktop/mobile');
 }finally{await browser.close();app.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
