const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div style="display:grid;grid-template-columns:1fr 270px"><div class="flow-canvas" id="canvas"></div><aside class="flow-inspector" id="inspector"></aside></div><p id="status"></p>');
  await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../public/style.css'),'utf8')});
  await page.addScriptTag({path:path.join(__dirname,'../public/flow.js')});
  await page.evaluate(()=>{
   window.editor=new FjordFlow.FlowEditor({canvas:document.querySelector('#canvas'),inspector:document.querySelector('#inspector'),status:document.querySelector('#status'),onChange:()=>window.changes++});window.changes=0;
   window.project={startNodeId:'start',graph:{nodes:[{id:'start',type:'start',name:'Start',x:30,y:80},{id:'analysis',type:'agent',name:'Analyse',x:370,y:80,access:'read'},{id:'end',type:'end',name:'Svar',x:1130,y:80},{id:'router',type:'router',name:'Fordeler',x:710,y:320,routes:[{id:'image',name:'Billede'},{id:'text',name:'Tekst'}]}],edges:[{source:'start',target:'analysis',port:'out'},{source:'analysis',target:'end',port:'out'},{source:'analysis',target:'router',port:'out'}]}};
  });
  for(const zoom of [1,.5,1.25]){
   await page.evaluate(zoom=>{editor.zoom=zoom;editor.set(project);},zoom);
   // Real pointer clicks beside the visible dashed belt, not DOM-dispatched events.
   const point=await page.locator('.flow-wire-hit').nth(1).evaluate(el=>{const p=el.getPointAtLength(el.getTotalLength()*.6),m=el.getScreenCTM();return{x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f+10};});
   await page.mouse.click(point.x,point.y);
   assert.equal(await page.locator('.flow-wire-hit[aria-pressed=true]').count(),1);
   assert.equal(await page.evaluate(()=>editor.selectedEdge),1);
   if(zoom===.5)await page.keyboard.press('Delete');
   else await page.getByRole('button',{name:'Slet forbindelse',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>editor.graph.edges.map(e=>e.source+'>'+e.target)),['start>analysis','analysis>router']);
   assert.equal(await page.locator('.flow-node').count(),4);
   // Curved branch remains selectable and Enter selects without deleting it.
   await page.locator('.flow-wire-hit').nth(1).focus();await page.keyboard.press('Enter');
   assert.equal(await page.locator('.flow-wire-hit').count(),2);
   await page.keyboard.press('Delete');assert.equal(await page.locator('.flow-wire-hit').count(),1);
  }
  // Changing projects clears the edge selection; ports and dragging still work.
  await page.evaluate(()=>{editor.zoom=1;editor.set(project);});
  await page.locator('.flow-port.out[data-node=start]').click();await page.locator('.flow-port.in[data-node=router]').click();
  assert.equal(await page.evaluate(()=>editor.graph.edges.length),4);
  const card=page.locator('[data-node-id=analysis]'),box=await card.boundingBox();
  await page.mouse.move(box.x+50,box.y+30);await page.mouse.down();await page.mouse.move(box.x+80,box.y+60);await page.mouse.up();
  assert.equal(await page.evaluate(()=>editor.graph.nodes.find(n=>n.id==='analysis').x),400);
  await page.locator('.flow-wire-hit').nth(1).click();
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/flow-edge-selection.png'});
  assert.deepEqual(errors,[]);console.log('PASS wide belt selection, exact deletion, keyboard, three zoom levels, curved branches, ports and node dragging');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
