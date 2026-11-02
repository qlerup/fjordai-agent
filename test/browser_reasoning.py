"""Real dropdown, model switching and save/reload against an isolated fake catalog."""
import json
from pathlib import Path
import re
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

root=Path(__file__).resolve().parents[1]
fixture=r"""
const {createApp}=require('./src/server.cjs');const {EventEmitter}=require('events');
class Fake extends EventEmitter{async rpc(method){
 if(method==='model/list')return{data:[
  {model:'large',displayName:'Large',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'},{reasoningEffort:'ultra'}]},
  {model:'small',displayName:'Small',hidden:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}]}
 ],nextCursor:null};
 if(method==='account/read')return{account:{type:'chatgpt'}};return{};
}close(){}}
const app=createApp({dataDir:process.argv[1],codexFactory:()=>new Fake()});
app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:app.server.address().port})));
"""
with tempfile.TemporaryDirectory() as folder:
    process=subprocess.Popen(['node','-e',fixture,folder],cwd=root,stdout=subprocess.PIPE,text=True)
    try:
        base='http://127.0.0.1:'+str(json.loads(process.stdout.readline())['port'])
        with sync_playwright() as p:
            browser=p.chromium.launch()
            context=browser.new_context(viewport={'width':1440,'height':1000})
            assert context.request.post(base+'/api/setup',data={'username':'owner','password':'test-password-123'}).ok
            project=context.request.post(base+'/api/projects',data={'name':'Reasoning test'}).json()
            page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base);page.locator('[data-tab=workflows]').click();page.locator('#edit-workflow').click()
            page.locator('.flow-node[data-node-id="agent-0"]').click()
            model=page.get_by_label('Model',exact=True)
            expect(model.locator('option')).to_have_count(3)
            model.select_option('large')
            effort=page.get_by_label(re.compile('Reasoning /'))
            expect(effort.locator('option')).to_have_count(4)
            effort.select_option('high')
            page.get_by_role('button',name='Gem projekt',exact=True).click()
            expect(page.locator('#flow-status')).to_have_text('Gemt')
            saved=context.request.get(base+'/api/state').json()['projects']
            assert next(x for x in saved if x['id']==project['id'])['graph']['nodes'][1]['reasoningEffort']=='high'
            page.reload();page.locator('[data-tab=workflows]').click();page.locator('#edit-workflow').click();page.locator('.flow-node[data-node-id="agent-0"]').click()
            expect(page.get_by_label(re.compile('Reasoning /'))).to_have_value('high')
            page.get_by_label('Model',exact=True).select_option('small')
            expect(page.get_by_label(re.compile('Reasoning /'))).to_have_value('')
            assert page.get_by_label(re.compile('Reasoning /')).locator('option').evaluate_all('(options)=>options.map(o=>o.value)')==['','low','medium']
            for width in (1440,390):
                page.set_viewport_size({'width':width,'height':1000})
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.get_by_label(re.compile('Reasoning /')).scroll_into_view_if_needed()
                (root/'test-results').mkdir(exist_ok=True)
                page.screenshot(path=str(root/f'test-results/reasoning-{width}.png'),full_page=True)
            assert not errors,errors
            browser.close()
    finally:
        process.terminate();process.wait(timeout=10)
print('PASS real model/effort dropdowns, hidden catalog entry, save/reload, model compatibility and desktop/mobile')
