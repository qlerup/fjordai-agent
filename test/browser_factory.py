"""Drive real run events through the factory UI without using an OpenAI account."""
import json
from pathlib import Path
import re
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

root=Path(__file__).resolve().parents[1]
fixture=r"""
const {createApp}=require('./src/server.cjs');const {EventEmitter}=require('events');
class Fake extends EventEmitter{
 constructor(){super();this.threads=new Map();this.next=0;}
 async rpc(method,p){
  if(method==='model/list')return{data:[{model:'test-model',displayName:'Test model',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]}],nextCursor:null};
  if(method==='account/read')return{account:{type:'chatgpt'}};
  if(method==='thread/start'){const id='t'+this.next++;this.threads.set(id,p);return{thread:{id}};}
  if(method==='turn/start'){
   const config=this.threads.get(p.threadId),route=config.developerInstructions.startsWith('ROUTER'),source=config.developerInstructions.startsWith('SOURCE');
   const text=route?JSON.stringify({routes:['design'],reason:'Design task'}):source?'A complete source answer':'A complete design answer';
   setTimeout(()=>{this.emit('message',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',text}}});this.emit('message',{method:'turn/completed',params:{threadId:p.threadId,turn:{status:'completed'}}});},route?200:source?3500:6500);
   return{turn:{id:'turn-'+p.threadId}};
  }return{};
 }close(){}}
const app=createApp({dataDir:process.argv[1],codexFactory:()=>new Fake()});app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:app.server.address().port})));
"""
def edge(source,target,port='out'):
    return dict(source=source,target=target,port=port)
def agent(ident,x,y,instructions):
    return dict(id=ident,type='agent',name=ident.capitalize(),x=x,y=y,instructions=instructions,access='read',model='test-model',reasoningEffort='low')
graph=dict(nodes=[dict(id='start',type='start',name='Start',x=60,y=220),agent('source',370,220,'SOURCE'),
    dict(id='router',type='router',name='Fordeler',x=700,y=220,instructions='ROUTER',model='test-model',routeMode='one',routingInput='both',routes=[dict(id='design',name='Design',rule='UI and visual work'),dict(id='code',name='Kode',rule='Backend code')]),
    agent('design',1050,100,'DESIGN'),agent('code',1050,430,'CODE'),dict(id='end',type='end',name='Levering',x=1410,y=220)],
    edges=[edge('start','source'),edge('source','router'),edge('router','design','design'),edge('router','code','code'),edge('design','end'),edge('code','end')])
with tempfile.TemporaryDirectory() as folder:
    process=subprocess.Popen(['node','-e',fixture,folder],cwd=root,stdout=subprocess.PIPE,text=True)
    try:
        base='http://127.0.0.1:'+str(json.loads(process.stdout.readline())['port'])
        with sync_playwright() as p:
            browser=p.chromium.launch(args=['--enable-unsafe-swiftshader']);context=browser.new_context(viewport={'width':1920,'height':1080})
            assert context.request.post(base+'/api/setup',data={'username':'owner','password':'test-password-123'}).ok
            project=context.request.post(base+'/api/projects',data={'name':'Agentfabrik'}).json()
            assert context.request.patch(base+'/api/projects/'+project['id'],data={'name':'Agentfabrik','graph':graph,'startNodeId':'start'}).ok
            page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base);page.locator('[data-tab=workflows]').click()
            expect(page.locator('#factory-view')).to_be_visible();expect(page.locator('#workflow-form')).to_be_hidden()
            page.wait_for_function('window.fjordFactory?.diagnostics().webgl')
            assert page.evaluate('fjordFactory.diagnostics().machines')==6
            assert page.evaluate('fjordFactory.diagnostics().belts')==6
            page.locator('#edit-workflow').click();page.locator('.flow-node[data-node-id=router]').click()
            expect(page.get_by_label('Grundlag for valg')).to_have_value('both')
            expect(page.locator('.flow-port.out[data-node=router]')).to_have_count(2)
            page.get_by_role('button',name='+ Tilf\u00f8j udgang',exact=True).click()
            expect(page.locator('.flow-port.out[data-node=router]')).to_have_count(3)
            page.locator('.routing-route').last.get_by_role('button',name='Fjern udgang',exact=True).click()
            page.get_by_role('button',name='Gem projekt',exact=True).click()
            expect(page.locator('#factory-view')).to_be_visible();expect(page.locator('#workflow-form')).to_be_hidden()
            page.locator('#factory-fullscreen').click();page.locator('#factory-fit').click()
            started=context.request.post(base+'/api/runs',data={'projectId':project['id'],'prompt':'Design the interface','files':[{'path':'README.md','content':'Synthetic factory test project'}]})
            assert started.ok,started.text()
            source=page.locator('.factory-machine-label[data-node-id=source]')
            expect(source).to_have_attribute('data-state','running',timeout=10000)
            assert page.evaluate('fjordFactory.diagnostics().flowing.every(e=>e.source!=="source")')
            expect(page.locator('.factory-machine-label[data-node-id=router]')).to_have_attribute('data-state','idle')
            target=page.locator('.factory-machine-label[data-node-id=design]')
            page.wait_for_function('fjordFactory.diagnostics().flowing.some(e=>e.source==="router"&&e.port==="design")',timeout=15000)
            assert not page.evaluate('fjordFactory.diagnostics().flowing.some(e=>e.source==="router"&&e.port==="code")')
            expect(target).to_have_attribute('data-state','running',timeout=12000)
            expect(source).to_have_attribute('data-state','completed')
            (root/'test-results').mkdir(exist_ok=True)
            page.screenshot(path=str(root/'test-results/factory-running-1920.png'))
            source.click();expect(page.locator('#factory-details')).to_contain_text('A complete source answer')
            page.emulate_media(reduced_motion='reduce')
            assert page.evaluate('fjordFactory.diagnostics().reducedMotion')
            page.emulate_media(reduced_motion='no-preference')
            expect(page.locator('#factory-view')).to_have_attribute('data-run-state','completed',timeout=15000)
            page.wait_for_function('!fjordFactory.diagnostics().queued&&!fjordFactory.diagnostics().active&&!fjordFactory.diagnostics().flowing.length')
            expect(page.locator('.factory-machine-label[data-node-id=code]')).to_have_attribute('data-state','idle')
            assert page.evaluate('fjordFactory.diagnostics().flowing.length')==0
            page.locator('#factory-fullscreen').click()
            for width in (1440,390):
                page.set_viewport_size({'width':width,'height':1000});page.locator('#factory-fit').click()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.screenshot(path=str(root/f'test-results/factory-completed-{width}.png'))
            assert not errors,errors
            browser.close()
    finally:
        process.terminate();process.wait(timeout=10)
print('PASS named router outputs, real factory states, no premature transfer, selected conveyor, completion, reduced motion and desktop/mobile')
