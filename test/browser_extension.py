from pathlib import Path
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
# Exercise the real composer script; host selection is covered by extension.test.cjs.
html='<form id="form"><div id="attachments"></div><input id="attachment-input" type="file" multiple><button id="attach" type="button">Attach</button><textarea id="prompt"></textarea><select id="project"><option value="test">Test</option></select><button id="send">Send</button><button id="stop" type="button" hidden>Stop</button></form><div id="status"></div><div id="messages"></div><div id="connection-status"></div><button id="connect"></button><details id="connection-settings"></details><div id="workspace"></div><button id="apply"></button><button id="app"></button><button id="refresh"></button>'
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page();page.set_content(html)
 page.evaluate('window.sent=[];window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:m=>sent.push(m)})')
 page.add_script_tag(content=(root/'extension/chat.js').read_text(encoding='utf-8'))
 page.evaluate("dispatchEvent(new MessageEvent('message',{data:{type:'connection',connected:true,url:'test'}}))")
 page.locator('#prompt').fill('hej');page.locator('#prompt').press('Enter')
 assert page.evaluate('sent.filter(m=>m.type==="run").length')==1
 assert page.locator('#stop').is_visible()
 page.locator('#prompt').press('Enter')
 assert page.evaluate('sent.filter(m=>m.type==="run").length')==1
 page.evaluate("dispatchEvent(new MessageEvent('message',{data:{type:'idle'}}))")
 page.locator('#prompt').fill('line1');page.locator('#prompt').press('Shift+Enter');page.locator('#prompt').press('l')
 assert '\n' in page.locator('#prompt').input_value()
 assert page.evaluate('sent.filter(m=>m.type==="run").length')==1
 page.locator('#send').click()
 assert page.evaluate('sent.filter(m=>m.type==="run").length')==2
 browser.close()
print('PASS Enter sends, Shift+Enter adds a newline, click sends and duplicate submissions are blocked')
