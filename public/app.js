'use strict';
const $=id=>document.getElementById(id);let setupRequired=false,state,editing,runId,poll,seen=0,currentMessage,sending=false,technical,technicalLog;const shownMessages=new Set();
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
async function api(route,method='GET',data){const r=await fetch('/api/'+route,{method,headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const b=await r.json();if(!r.ok){if(r.status===401){$('shell').hidden=true;$('login').hidden=false;}throw new Error(b.error||'Forbindelsen fejlede');}return b;}
function notice(text){$('notice').textContent=text;$('notice').hidden=false;}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){notice(e.message);}};}
async function load(){state=await api('state');$('login').hidden=true;$('shell').hidden=false;const old=$('project').value;options($('project'),state.projects);if(state.projects.some(p=>p.id===old))$('project').value=old;preview();workflowList();if(state.projects.length&&!editing)editWorkflow(state.projects[0]);}
function options(select,items){select.replaceChildren(...items.map(x=>{const o=el('option',x.name);o.value=x.id;return o;}));}
function preview(){const p=state.projects.find(p=>p.id===$('project').value);const w=p?{name:p.name,steps:p.graph.nodes.filter(n=>n.type==='agent')}:null;$('flow-name').textContent=w?.name||'AI vælger agenter';$('flow-preview').replaceChildren(...(w?.steps||[]).map(s=>{const d=el('div',undefined,'step-node');d.append(el('strong',s.name),el('small',s.access==='write'?'Kan ændre projektfiler':'Læseadgang'));return d;}));}
function message(author,text,cls=''){const d=el('div',undefined,'message '+cls);d.append(el('span',author,'author'));const content=el('pre',text);d.append(content);$('messages').append(d);return content;}
async function showChanges(run,history=false){if(history&&!run.changeSummary&&run.changeCount>0)run=await api('runs/'+run.id);const host=el('div');message('Kodeændringer','').replaceWith(host);const status=run.application?.status,labels={saved:'Anvendt og gemt i VS Code.',applied:'Anvendt i VS Code-editoren; lagring er ikke bekræftet.'};FjordChanges.render(host,run.changeReport||run.changeSummary,(run.changes||[]),labels[status]||'Lokal anvendelse er ikke registreret. Se status i VS Code.',history?async name=>{const full=await api('runs/'+run.id);return full.changeReport?.files.find(f=>f.path===name);}:undefined);}
function showImage(name,image){const body=message(name,'');const figure=el('figure',undefined,'generated-image'),img=el('img');img.src=image.url;img.alt='Billede fra '+name;const link=el('a','Åbn / gem billede');link.href=image.url;link.target='_blank';link.rel='noopener';figure.append(img,link);body.replaceWith(figure);}
function busy(value){$('send').disabled=sending;$('send').title=value?'Send ekstra besked':'Send opgave';$('send').textContent=value?'Send besked ↑':'Send opgave ↑';$('send').setAttribute('aria-label',$('send').title);$('prompt').placeholder=value?'Supplér eller ret opgaven undervejs…':'Beskriv din opgave…';$('stop').hidden=!value;$('project').disabled=value;}
function detail(text,full=false){if(!text)return;if(!technical){technical=el('details',undefined,'work-details');technicalLog=el('div');technical.append(el('summary','Arbejdsdetaljer'),technicalLog);$('messages').append(technical);}technicalLog.append(el('p',full?text:String(text).slice(0,3000)));while(technicalLog.children.length>80)technicalLog.firstChild.remove();}
function userMessage(messageData){if(!messageData||shownMessages.has(messageData.id))return;shownMessages.add(messageData.id);message('Dig',messageData.text,'user');}
function clientId(){return globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
// Enter sends while Shift+Enter keeps a newline, including during active work.
$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!sending)$('chat-form').requestSubmit();}});
function showResult(answer,details=[]){if(answer?.text)message('FjordAgent',answer.text);for(const item of details)detail(item.name+'\n'+item.text,true);}
const contextHint=el('p','','muted');contextHint.id='context-info';contextHint.hidden=true;$('activity').after(contextHint);
function showEvent(e){
 if(e.type==='node-started')$('activity').textContent=e.name+' arbejder…';
 if(e.type==='review')$('activity').textContent=e.approved?'Resultatet er kontrolleret':'Agenten retter resultatet efter review';
 if(e.type==='compaction'){contextHint.hidden=e.state!=='started';contextHint.textContent='Komprimerer konteksten…';}
 if(e.type==='image')showImage(e.name,e.image);
 if(['activity','branch','notice'].includes(e.type))detail(e.text);
 if(e.type==='model')detail(e.name+' · '+e.model);
 if(e.type==='notice')$('activity').textContent=e.text.slice(0,300);
 if(e.type==='error'||e.type==='input-routing-failed')message('Fejl',e.text,'error');
 if(e.type==='result')showResult(e.answer,e.details);
 if(e.type==='user-message'){userMessage(e.message);$('activity').textContent='Din ekstra besked bliver analyseret og fordelt…';}
 if(e.type==='input-routing'&&e.event.type==='node-started')$('activity').textContent=e.event.name+' behandler din ekstra besked…';
 if(e.type==='input-routed')$('activity').textContent='Din besked er fordelt til den valgte agent.';
 if(e.type==='input-delivered')$('activity').textContent=e.name+' har modtaget din ekstra besked.';
 if(e.type==='approval'){const d=el('div',undefined,'message');d.append(el('strong','Godkend handling'),el('pre',e.request.reason||JSON.stringify(e.request.command||e.request,null,2)));for(const [label,accept]of[['Godkend',true],['Afvis',false]]){const b=el('button',label);b.onclick=safe(async()=>{await api('approvals/'+e.id,'POST',{accept});d.remove();});d.append(b);}$('messages').append(d);}
}
async function watch(){if(!runId)return;const id=runId;try{const run=await api('runs/'+id);if(id!==runId)return;run.events.slice(seen).forEach(showEvent);for(const m of run.messages||[])userMessage(m);seen=run.events.length;if(run.status==='running'){poll=setTimeout(watch,650);}else{busy(false);if(run.status==='completed'){if(!run.events.some(e=>e.type==='result'))showResult(run.answers?.at(-1),run.answers?.slice(0,-1));if(run.source==='vscode')showChanges(run);}$('activity').textContent=run.status==='completed'?'Opgaven er færdig.':run.error||run.status;runId=null;await load();}}catch(e){busy(false);notice(e.message+' — hent opgaven igen ved at vælge projektet.');runId=null;}}
async function history(){clearTimeout(poll);runId=null;seen=0;currentMessage=null;shownMessages.clear();busy(false);$('messages').replaceChildren();state=await api('state');const runs=state.runs.filter(r=>r.projectId===$('project').value);for(const r of runs){technical=null;technicalLog=null;message('Dig',r.prompt,'user');for(const m of r.messages||[])userMessage(m);if(r.status==='running'){runId=r.id;busy(true);await watch();return;}showResult(r.answers?.at(-1),r.answers?.slice(0,-1));for(const image of r.images||[])showImage(image.name,image);if(r.error)message('Status',r.error,'error');if(r.status==='completed'&&r.source==='vscode')await showChanges(r,true);}if(!runs.length){const d=el('div',undefined,'empty');d.append(el('div','↗','orb'),el('h2','Klar til din første opgave.'),el('p','Skriv til agenten nedenfor.'));$('messages').append(d);}}
async function authScreen(){const status=await api('setup');setupRequired=status.setupRequired;$('login-title').textContent=setupRequired?'Dit eget agentværksted.':'Velkommen tilbage.';$('login-eyebrow').textContent=setupRequired?'FØRSTEGANGSOPSÆTNING':'FJORDAI AGENT';$('login-description').textContent=setupRequired?'Opret din bruger for at komme i gang. Vælg en adgangskode på mindst 10 tegn.':'Log ind for at åbne dit workspace.';$('confirm-label').hidden=!setupRequired;$('password-confirm').required=setupRequired;$('password').minLength=setupRequired?10:1;$('password').autocomplete=setupRequired?'new-password':'current-password';$('login-submit').textContent=setupRequired?'Opret bruger og kom i gang →':'Log ind →';$('login-submit').disabled=false;}
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-error').textContent='';if(setupRequired&&$('password').value!==$('password-confirm').value){$('login-error').textContent='Adgangskoderne er ikke ens.';return;}$('login-submit').disabled=true;try{await api(setupRequired?'setup':'session','POST',{username:$('username').value,password:$('password').value});$('password').value='';$('password-confirm').value='';setupRequired=false;await load();await history();}catch(e){$('login-error').textContent=e.message;await authScreen();}finally{$('login-submit').disabled=false;}};
$('logout').onclick=safe(async()=>{await api('session','DELETE');location.reload();});
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=safe(async()=>{for(const x of document.querySelectorAll('[data-tab]'))x.classList.toggle('active',x===b);for(const id of ['chat','workflows','connect'])$('tab-'+id).hidden=b.dataset.tab!==id;const labels={chat:['PROJEKTER','Fra idé til færdigt arbejde.'],workflows:['PROJEKTER','Dit projekt. Dit agent-workflow.'],connect:['FORBINDELSER','Forbind dine værktøjer.']};[$('crumb').textContent,$('page-title').textContent]=labels[b.dataset.tab];if(b.dataset.tab==='connect')await account();});
$('new-project').onclick=safe(async()=>{const name=prompt('Navn på det nye projekt');if(!name)return;const p=await api('projects','POST',{name});await load();$('project').value=p.id;await history();});
$('project').onchange=safe(async()=>{preview();await history();});
$('chat-form').onsubmit=safe(async e=>{e.preventDefault();const text=$('prompt').value.trim();if(!text||sending)return;sending=true;busy(!!runId);try{if(runId){const r=await api('runs/'+runId+'/messages','POST',{text,clientId:clientId()});userMessage(r.message);if($('prompt').value.trim()===text)$('prompt').value='';$('activity').textContent='Din ekstra besked bliver analyseret og fordelt…';return;}const r=await api('runs','POST',{projectId:$('project').value,prompt:text});$('messages').querySelector('.empty')?.remove();technical=null;technicalLog=null;message('Dig',text,'user');$('prompt').value='';runId=r.id;seen=0;currentMessage=null;busy(true);await watch();}finally{sending=false;busy(!!runId);}});
$('stop').onclick=safe(async()=>{if(runId)await api('runs/'+runId+'/stop','POST');});
function workflowList(){$('workflow-list').replaceChildren(...state.projects.map(w=>{const b=el('button',w.name+(editing?.id===w.id?' •':''));b.classList.toggle('selected',editing?.id===w.id);b.onclick=()=>{if($('flow-status').textContent==='Ikke gemt'&&!confirm('Du har ikke gemt ændringerne. Skift projekt alligevel?'))return;editWorkflow(w);};return b;}));}
const flowEditor=new FjordFlow.FlowEditor({canvas:$('flow-canvas'),inspector:$('flow-inspector'),status:$('flow-status'),onChange:(graph,startId)=>{if(!editing)return;editing.graph=graph;editing.startNodeId=startId;entryLabel();}});
const factoryView=$('factory-view');
let teamThreadKey='';
function renderTeamThread(run){
 const events=(run?.events||[]).filter(e=>e.type==='team'&&['message','task-request','task'].includes(e.kind)),key=(run?.id||'empty')+':'+events.length;
 if(key===teamThreadKey)return;teamThreadKey=key;
 const list=$('team-thread-messages'),nearEnd=list.scrollHeight-list.scrollTop-list.clientHeight<70;
 $('team-thread-count').textContent=String(events.length);
 if(!events.length){list.replaceChildren(el('p','Når flere agenter får samme opgave, kan du følge ekstra opgaver og fordelerens valg her.','team-thread-empty'));return;}
 const existing=list.querySelectorAll('.team-bubble').length;
 if(!list.dataset.run||list.dataset.run!==(run?.id||'')||existing>events.length){list.replaceChildren();list.dataset.run=run?.id||'';}
 list.querySelector('.team-thread-empty')?.remove();
 const count=list.querySelectorAll('.team-bubble').length;
 for(const event of events.slice(count)){
  const bubble=el('article',undefined,'team-bubble');bubble.dataset.kind=event.kind;
  const kinds={message:'Besked',assignment:'Team dannet','task-request':'Opgave til fordeleren',task:'Fordelt opgave','task-completed':'Opgave udført',result:'Delresultat',error:'Opgave fejlede'};
  bubble.append(el('small',kinds[event.kind]||'Besked'),el('strong',(event.fromName||event.from||'Team')+(event.toName?' → '+event.toName:'')),el('p',event.text));
  if(event.at){const time=el('time',new Date(event.at).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}));time.dateTime=new Date(event.at).toISOString();bubble.append(time);}
  list.append(bubble);
 }
 if(nearEnd)list.scrollTop=list.scrollHeight;
}
function toggleTeamThread(open){$('team-thread').hidden=!open;$('team-thread-toggle').setAttribute('aria-expanded',String(open));if(open){$('team-thread-close').focus();const list=$('team-thread-messages');list.scrollTop=list.scrollHeight;}else $('team-thread-toggle').focus();}
$('team-thread-toggle').onclick=()=>toggleTeamThread($('team-thread').hidden);
$('team-thread-close').onclick=()=>toggleTeamThread(false);
$('team-thread').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();toggleTeamThread(false);}});
const factoryScene=new FjordFactory.FactoryScene($('factory-stage'),{onSelect:showMachine});
window.fjordFactory=factoryScene;
function showMachine(n,live){const box=$('factory-details');box.replaceChildren(el('p','VALGT MASKINE','eyebrow'),el('h3',n.name),el('p',FjordFlow.labels[n.type]||n.type,'muted'));if(n.type==='review'||n.type==='analysis'||n.type==='agent'||(n.type==='router'&&n.routingMode!=='analysis')){box.append(el('p','Model: '+(live.models?.[n.id]||n.model||'Serverens standard')),el('p','Reasoning: '+(n.reasoningEffort||'Modellens standard')),el('p',n.access==='write'?'Kan redigere projektfiler':'Læseadgang'));}if(n.instructions)box.append(el('h4','Opgave'),el('p',n.instructions));if(n.type==='analysis'||n.type==='router')for(const route of n.routes||[])box.append(el('strong',route.name),el('p',route.rule||'Ingen kriterier angivet','muted'));const answer=live.answers?.findLast(a=>a.nodeId===n.id);if(answer){box.append(el('h4','Færdigt svar'),el('pre',answer.text,'factory-answer'));}else box.append(el('p',live.nodes[n.id]==='running'?'Maskinen arbejder. Intet færdigt svar endnu.':'Der er endnu ikke et færdigt svar fra denne maskine.','muted'));const edit=el('button','Rediger denne maskine');edit.type='button';edit.onclick=()=>{openWorkflowEditor();flowEditor.selected=n.id;flowEditor.render();};box.append(edit);}
async function showFactory(){if(document.fullscreenElement===editor)await document.exitFullscreen();editor.classList.remove('expanded');factoryView.hidden=false;editor.hidden=true;$('factory-draft').hidden=$('flow-status').textContent!=='Ikke gemt';syncFullscreen();factoryScene.size();}
function openWorkflowEditor(){factoryView.hidden=true;$('workflow-form').hidden=false;if(document.fullscreenElement===factoryView)document.exitFullscreen();factoryView.classList.remove('expanded');flowEditor.wires();syncFullscreen();}
const labelToggle=$('factory-label-toggle');function syncLabels(){labelToggle.textContent=factoryScene.labelsVisible?'Skjul skilte':'Vis skilte';labelToggle.setAttribute('aria-pressed',String(!!factoryScene.labelsVisible));}labelToggle.onclick=()=>{factoryScene.setLabelsVisible(!factoryScene.labelsVisible);syncLabels();};syncLabels();
$('edit-workflow').onclick=openWorkflowEditor;$('back-to-factory').onclick=safe(showFactory);$('factory-fit').onclick=()=>factoryScene.fit();
function entryLabel(){const n=editing?.graph.nodes.find(n=>n.id===editing.startNodeId);$('flow-entry-label').textContent='Projektstart: '+(n?.name||'Vælg en startnode');}
function accessHint(){const full=$('workflow-full-access').checked;$('workflow-access-help').textContent=full?'Fuld adgang uden sandbox i serverens arbejdsmiljø. Færdige ændringer anvendes og gemmes automatisk i VS Code efter eventuelle reviews. Lokale filkonflikter stopper overførslen. Gælder nye opgaver.':'Normal tilstand: værktøjsgodkendelser efter behov og manuel overførsel af færdige kodeændringer.';}
$('workflow-full-access').onchange=()=>{if(editing){editing.fullAccess=$('workflow-full-access').checked;$('flow-status').textContent='Ikke gemt';accessHint();}};
function editWorkflow(w){renderTeamThread(null);editing=structuredClone(w);$('workflow-full-access').checked=w.fullAccess===true;accessHint();$('project').value=w.id;preview();$('workflow-name').value=w.name;flowEditor.set(editing);factoryScene.set(w);$('factory-title').textContent=w.name+(w.fullAccess===true?' · Full access':'');$('flow-status').textContent='Gemt';showFactory();workflowList();entryLabel();loadModels();refreshMission();}
for(const [type,label]of Object.entries(FjordFlow.labels)){const b=el('button',FjordFlow.icons[type]+'  '+label,'palette-node type-'+type);b.type='button';b.draggable=true;b.dataset.nodeType=type;b.ondragstart=e=>e.dataTransfer.setData('fjord-node',type);b.onclick=()=>{if(!editing)return notice('Opret først et projekt');flowEditor.add(type);};$('node-palette').append(b);}
$('flow-arrange').onclick=()=>flowEditor.arrange();$('flow-zoom').onchange=()=>flowEditor.setZoom(Number($('flow-zoom').value));
$('workflow-name').oninput=()=>{if(editing){editing.name=$('workflow-name').value;$('flow-status').textContent='Ikke gemt';}};
$('new-workflow').onclick=safe(async()=>{const name=prompt('Navn på dit nye projekt');if(!name)return;const p=await api('projects','POST',{name});await load();editWorkflow(p);openWorkflowEditor();});
$('workflow-form').onsubmit=safe(async e=>{e.preventDefault();if(!editing)return;const p=await api('projects/'+editing.id,'PATCH',{name:$('workflow-name').value,graph:flowEditor.graph,startNodeId:flowEditor.startId,fullAccess:$('workflow-full-access').checked});await load();editWorkflow(p);notice('Projektet er gemt. VS Code bruger nu denne startnode og disse forbindelser.');});
async function account(){const a=await api('account');$('account-status').textContent=a.account?`Forbundet: ${a.account.email||a.account.type} · ${a.account.planType||''}`:'Ingen ChatGPT-konto forbundet endnu.';if(a.account)$('device-login').hidden=true;}
$('refresh-account').onclick=safe(account);
$('connect-account').onclick=safe(async()=>{const b=$('connect-account');b.disabled=true;try{const r=await api('account/login','POST');const d=$('device-login');d.replaceChildren(el('p','Åbn login-siden og indtast denne engangskode:'),el('code',r.userCode));const link=el('a','Åbn ChatGPT-login ↗');const u=new URL(r.verificationUrl);if(u.protocol!=='https:')throw new Error('Ugyldig loginadresse');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';d.append(link,el('p','Klik derefter på “Opdater status”. Device login skal være aktiveret på din ChatGPT-konto.'));d.hidden=false;}finally{b.disabled=false;}});
$('disconnect-account').onclick=safe(async()=>{await api('account/logout','POST');await account();});
authScreen().then(()=>load().then(history).catch(()=>{})).catch(e=>{$('login-error').textContent=e.message;});

$('load-models').onclick=safe(()=>loadModels(true));

$('create-connection-key').onclick=safe(async()=>{const r=await api('connection-key','POST');$('connection-key').value=r.token;$('connection-key-result').hidden=false;});
$('revoke-connection-key').onclick=safe(async()=>{await api('connection-key','DELETE');$('connection-key').value='';$('connection-key-result').hidden=true;notice('Forbindelsesnøglen er tilbagekaldt.');});

let modelsPending,modelsLoaded=false,missionTimer,missionGeneration=0;
async function loadModels(force=false){
 if(modelsPending)return modelsPending;if(modelsLoaded&&!force)return;
 $('load-models').disabled=true;
 modelsPending=(async()=>{try{const r=await api('models');const models=(r.data||[]).filter(m=>m.model||m.id);flowEditor.setModels(models);modelsLoaded=true;if(force)notice(models.length+' modeller hentet fra serverens fulde katalog.');}catch(e){flowEditor.setModels(flowEditor.models,'Kunne ikke hente modeller: '+e.message+'. Brug Opdater modeller for at prøve igen.');}finally{$('load-models').disabled=false;modelsPending=null;}})();
 return modelsPending;
}
const fullButton=$('flow-fullscreen'),editor=$('workflow-form');
function syncFullscreen(){let any=false;for(const [view,button]of[[editor,fullButton],[factoryView,$('factory-fullscreen')]]){const expanded=view.classList.contains('expanded')||document.fullscreenElement===view;button.textContent=expanded?'Luk fuld skærm':'Fuld skærm';button.setAttribute('aria-pressed',String(expanded));any ||=expanded;}document.body.classList.toggle('flow-expanded',any);factoryScene.size();}
function fullscreen(view){return safe(async()=>{if(document.fullscreenElement===view)await document.exitFullscreen();else if(view.classList.contains('expanded'))view.classList.remove('expanded');else{view.classList.add('expanded');if(view.requestFullscreen)try{await view.requestFullscreen();view.classList.remove('expanded');}catch{}}syncFullscreen();});}
fullButton.onclick=fullscreen(editor);$('factory-fullscreen').onclick=fullscreen(factoryView);
document.addEventListener('fullscreenchange',syncFullscreen);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){editor.classList.remove('expanded');factoryView.classList.remove('expanded');syncFullscreen();}});
$('flow-fit').onclick=()=>{flowEditor.fit();};
async function refreshMission(){
 const generation=++missionGeneration;clearTimeout(missionTimer);if(!editing)return;
 const projectId=editing.id;
 try{const snapshot=await api('state');if(generation!==missionGeneration||editing?.id!==projectId)return;
 const runs=snapshot.runs.filter(r=>r.projectId===projectId);const summary=runs.find(r=>r.status==='running')||runs.at(-1);
 const run=summary?await api('runs/'+summary.id):null;if(generation!==missionGeneration||editing?.id!==projectId)return;
 drawMission(run);
 }catch(e){if(generation!==missionGeneration)return;$('mission-state').textContent='FORBINDELSE AFBRUDT';$('mission-detail').textContent='Live-status kunne ikke hentes: '+e.message;flowEditor.setLive({nodes:{},edges:new Set(),active:null});factoryScene.setLive({nodes:{},edges:new Set(),active:null});editor.dataset.runState='offline';}
 finally{if(generation===missionGeneration)missionTimer=setTimeout(refreshMission,1500);}
}
function drawMission(run){
 renderTeamThread(run);
 const nodes={},edges=new Set(),ports=new Set(),trail=[],models={},answers=[];let active=null,detail='Fabrikken venter på en opgave fra Chat eller VS Code.';
 const name=id=>flowEditor.graph?.nodes.find(n=>n.id===id)?.name||id;
 for(const e of run?.events||[]){
  if(e.type==='model'&&e.nodeId)models[e.nodeId]=e.model;
  if(e.type==='node-started'){active=e.nodeId;nodes[active]='running';detail=e.name+' arbejder på opgaven';trail.push({name:e.name,id:e.nodeId});}
  if(e.type==='node-completed'){if(e.result)answers.push({nodeId:e.nodeId,name:e.name,text:e.result});nodes[e.nodeId]='completed';if(active===e.nodeId)active=null;for(const target of e.targets||[])edges.add(e.nodeId+'>'+target);for(const route of e.edges||flowEditor.graph.edges.filter(r=>r.source===e.nodeId&&(e.targets||[]).includes(r.target)))ports.add(e.nodeId+':'+route.port+'>'+route.target);}
  if(e.type==='branch'){detail=e.name+' → '+(e.targets||[]).map(name).join(', ');}
  if((e.type==='activity'||e.type==='notice')&&e.text)detail=e.text;
  if(e.type==='approval')detail='Afventer godkendelse i Chat eller VS Code';
 }
 if(run&&run.status!=='running'&&active){nodes[active]=run.status==='failed'?'failed':'interrupted';active=null;}
 if(run?.status==='running'&&active){const destinations=[...edges].filter(k=>k.startsWith(active+'>')).map(k=>name(k.split('>')[1]));const configured=flowEditor.graph?.edges.filter(e=>e.source===active).map(e=>name(e.target))||[];detail+=' → '+(destinations.length?'Sendes til: '+destinations.join(', '):configured.length?'Mulige næste trin: '+configured.join(', '):'Sidste trin');}
 const labels={running:'MISSION I GANG',completed:'MISSION FULDFØRT',failed:'MISSION FEJLEDE',interrupted:'MISSION STOPPET'};
 $('mission-state').textContent=labels[run?.status]||'KLAR TIL OPGAVE';editor.dataset.runState=run?.status||'idle';
 $('mission-detail').textContent=run?.status==='completed'?'Resultatet er klar i Chat eller VS Code.':run?.error||detail;
 const completed=Object.values(nodes).filter(s=>s==='completed').length;
 $('mission-score').textContent=completed+' gennemført · '+(active?'1 aktiv':'ingen aktive');
 $('mission-trail').replaceChildren(...trail.slice(-12).map((item,i)=>{const chip=el('span',(i?'→  ':'')+item.name,'route-chip');chip.dataset.state=nodes[item.id];return chip;}));
 if(!trail.length)$('mission-trail').append(el('span','RUTEN VISER SIG HER, NÅR OPGAVEN STARTER','route-empty'));
 flowEditor.setLive({nodes,edges,ports,active});factoryScene.setLive({runId:run?.id,events:run?.events||[],status:run?.status||'idle',nodes,edges,ports,active,models,answers:answers.length?answers:run?.answers||[]});factoryView.dataset.runState=run?.status||'idle';
}
