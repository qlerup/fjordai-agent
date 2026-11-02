const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);let current,connected=false,isBusy=false,canSteer=false,followupSending=false,submittedText='',technical,technicalLog,attachments=[],loadingAttachments=false;const shownMessages=new Set(),activeNodes=new Map();const saved=vscode.getState()||{};
const previousLabel=document.createElement('label'),includePrevious=document.createElement('input');includePrevious.type='checkbox';previousLabel.append(includePrevious,document.createTextNode('Medtag tidligere samtaler'));$('form').before(previousLabel);
let newConversationPending=false;const newConversationButton=document.createElement('button');newConversationButton.id='new-conversation';newConversationButton.type='button';newConversationButton.textContent='Ny samtale';$('form').before(newConversationButton);newConversationButton.onclick=()=>{if(isBusy||newConversationPending||!connected)return;newConversationPending=true;busy(false);vscode.postMessage({type:'new-conversation',projectId:$('project').value});};
function remember(){vscode.setState({project:$('project').value,draft:$('prompt').value});}
function message(author,text){$('welcome')?.remove();const box=document.createElement('div');box.className='message'+(author==='Dig'?' user':'');const label=document.createElement('strong');label.className='author';label.textContent=author;const body=document.createElement('div');body.textContent=text;box.append(label,body);$('messages').append(box);$('messages').scrollTop=$('messages').scrollHeight;return body;}
const changeCards=new Map();let latestChangeRun;
const applicationLabels={ready:'Klar til at blive anvendt i VS Code.',applying:'Anvender og gemmer ændringerne…',applied:'Anvendt i editoren. Filerne er endnu ikke gemt af FjordAgent.',saved:'Anvendt og gemt i projektet.',verified:'Kontrolleret: filerne matcher de gemte ændringer i den åbne projektmappe.',unknown:'Lokal anvendelse er ikke registreret for denne kørsel.',stopped:'Automatisk anvendelse blev stoppet.'};
function changeStatus(id,status,text){const node=changeCards.get(id||latestChangeRun);if(node){node.textContent=text||applicationLabels[status];node.dataset.state=status;}}
function showChanges(m){latestChangeRun=m.runId;const status=m.application||(m.autoApplying?'applying':'ready');if(changeCards.has(m.runId)){changeStatus(m.runId,status);return;}const body=message('Kodeændringer','');const node=FjordChanges.render(body,m.report,m.changes,(m.report?.files||m.changes||[]).length?applicationLabels[status]:'Der blev ikke registreret kodeændringer i denne kørsel.');node.dataset.state=status;changeCards.set(m.runId,node);$('messages').scrollTop=$('messages').scrollHeight;}
function busy(b){isBusy=b;newConversationButton.disabled=b||newConversationPending||!connected;$('status').classList.toggle('working',b);$('send').disabled=newConversationPending||!connected||loadingAttachments||followupSending||(b&&!canSteer);$('send').title=b?'Send ekstra besked':'Send opgave';$('send').setAttribute('aria-label',$('send').title);$('prompt').placeholder=b?'Supplér eller ret opgaven undervejs…':'Beskriv din opgave…';$('stop').hidden=!b;$('project').disabled=b||newConversationPending;$('attach').disabled=b||newConversationPending;$('attachment-input').disabled=b||newConversationPending;renderAttachments();}
function resetDetails(){technical=null;technicalLog=null;activeNodes.clear();}
function detail(text,full=false){if(!text)return;if(!technical){technical=document.createElement('details');technical.className='work-details';const title=document.createElement('summary');title.textContent='Arbejdsdetaljer';technicalLog=document.createElement('div');technical.append(title,technicalLog);$('messages').append(technical);}const row=document.createElement('p');row.textContent=full?text:String(text).slice(0,3000);technicalLog.append(row);while(technicalLog.children.length>80)technicalLog.firstChild.remove();}
function workingStatus(){const names=[...activeNodes.values()];$('status').textContent=names.length>1?names.length+' agenter arbejder: '+names.join(', '):names.length?names[0]+' arbejder…':'Færdiggør opgaven…';}
function userMessage(m){if(!m)return;if(!shownMessages.has(m.id)){shownMessages.add(m.id);message('Dig',m.text);}if(m.answer&&!shownMessages.has(m.id+'-answer')){shownMessages.add(m.id+'-answer');message('Orchestrator',m.answer);}}
function clientId(){return globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
function result(m){if(m.answer?.text)message('FjordAgent',m.answer.text);for(const answer of m.details||[])detail(answer.name+'\n'+answer.text,true);}
function options(id,items){const select=$(id);const previous=select.value||saved[id];select.replaceChildren(...items.map(i=>{const o=document.createElement('option');o.value=i.id;o.textContent=i.name+(i.fullAccess===true?' · Full access':'');return o;}));if(items.some(i=>i.id===previous))select.value=previous;}
const contextHint=document.createElement('p');contextHint.className='context-info';contextHint.id='context-info';contextHint.hidden=true;$('status').before(contextHint);
const teamToggle=document.createElement('button'),teamPanel=document.createElement('section'),teamHeading=document.createElement('strong'),teamClose=document.createElement('button'),teamLog=document.createElement('div');let teamCount=0;
teamToggle.id='team-toggle';teamToggle.textContent='Teamsamtale · 0';teamToggle.setAttribute('aria-expanded','false');teamToggle.setAttribute('aria-controls','team-panel');
teamPanel.id='team-panel';teamPanel.hidden=true;teamPanel.setAttribute('aria-label','Teamsamtale');teamHeading.textContent='Teamsamtale';teamClose.textContent='×';teamClose.setAttribute('aria-label','Luk teamsamtale');teamLog.id='team-log';teamLog.setAttribute('role','log');teamLog.setAttribute('aria-live','polite');
const teamHeader=document.createElement('header');teamHeader.append(teamHeading,teamClose);teamPanel.append(teamHeader,teamLog);$('messages').before(teamToggle,teamPanel);
function teamOpen(open){teamPanel.hidden=!open;teamToggle.setAttribute('aria-expanded',String(open));(open?teamClose:teamToggle).focus();if(open)teamLog.scrollTop=teamLog.scrollHeight;}
teamToggle.onclick=()=>teamOpen(teamPanel.hidden);teamClose.onclick=()=>teamOpen(false);teamPanel.onkeydown=e=>{if(e.key==='Escape')teamOpen(false);};
function teamReset(){teamCount=0;teamLog.replaceChildren();teamToggle.textContent='Teamsamtale · 0';}
function teamMessage(m){const article=document.createElement('article'),label=document.createElement('strong'),text=document.createElement('p');article.dataset.kind=m.kind;label.textContent=(m.fromName||m.from||'Team')+(m.toName?' → '+m.toName:'');text.textContent=m.text;article.append(label,text);const nearEnd=teamLog.scrollHeight-teamLog.scrollTop-teamLog.clientHeight<70;teamLog.append(article);teamToggle.textContent='Teamsamtale · '+(++teamCount);if(nearEnd)teamLog.scrollTop=teamLog.scrollHeight;}
window.addEventListener('message',({data:m})=>{
  if(m.type==='done'||m.type==='change-report')showChanges(m);
  if(m.type==='applied')changeStatus(m.runId,m.automatic?'saved':'applied');
  if(m.type==='auto-apply-stopped')changeStatus(m.runId,'stopped',m.text);
  if(m.type==='conversation-started'){includePrevious.checked=false;newConversationPending=false;$('messages').replaceChildren();shownMessages.clear();changeCards.clear();latestChangeRun=null;current=null;resetDetails();teamReset();attachments=[];renderAttachments();$('apply').hidden=true;$('prompt').value='';contextHint.hidden=true;remember();busy(false);$('status').textContent='Ny samtale. Tidligere samtalekontekst bruges ikke.';}
  if(m.type==='conversation-error'){newConversationPending=false;busy(isBusy);$('status').textContent=m.text;}
  if(m.type==='history-start'){changeCards.clear();latestChangeRun=null;shownMessages.clear();resetDetails();}
  if(m.type==='team'&&['message','task-request','task'].includes(m.kind))teamMessage(m);
  if(m.type==='history-start'||m.type==='started')teamReset();
  if(m.type==='connection'){connected=m.connected;$('connection-status').textContent=connected?'Forbundet til '+m.url:'Forbind til din server. Opret en forbindelsesnøgle under Forbindelser i appen.';$('connect').textContent=connected?'Skift server':'Forbind til server';$('connection-settings').open=!connected;if(connected)$('status').textContent='';busy(isBusy);}
  if(m.type==='state'){options('project',m.projects);if(m.activeProjectId)$('project').value=m.activeProjectId;$('workspace').textContent='Arbejdsmappe: '+m.workspace;if(!isBusy)vscode.postMessage({type:'history',projectId:$('project').value});}
  if(m.type==='compaction'){contextHint.hidden=m.state!=='started';contextHint.textContent=m.state==='started'?'Komprimerer '+(m.scope==='project'?'samtalehistorik':'agentens kontekst')+'…':'Kontekst komprimeret · fortsætter';}
  if(m.type==='usage'&&m.usage?.modelContextWindow>0)contextHint.textContent='Kontekst ca. '+Math.min(100,Math.round(100*(m.usage.last?.totalTokens||0)/m.usage.modelContextWindow))+' % · automatisk komprimering';
  if(m.type==='review-escalated'){$('status').textContent='Ekstra Code Review · '+m.model;detail('Review eskaleret: '+m.reason);}
  if(m.type==='review')$('status').textContent=m.approved?'Code Reviewer har godkendt resultatet':m.round>=m.maxRounds?'Grænsen for rettelsesrunder er nået':'Rettelser med drone · runde '+(m.round+1)+'/'+m.maxRounds;
  if(m.type==='branch')detail(m.name+': '+m.text);
  if(m.type==='history-start'){$('messages').replaceChildren();current=null;}
  if(m.type==='history-text'){if(m.name==='Dig')resetDetails();message(m.name,m.text);}
  if(m.type==='image'&&/^data:image\/(png|jpeg|gif|webp);base64,/.test(m.image?.data||'')){const body=message(m.name,''),img=document.createElement('img');img.className='generated-image';img.src=m.image.data;img.alt='Billede fra '+m.name;const save=document.createElement('button');save.textContent='Gem billede';save.onclick=()=>vscode.postMessage({type:'save-image',runId:m.runId,imageId:m.image.id});body.append(img,save);}
  if(m.type==='node-started'){activeNodes.set(m.nodeId,m.name);workingStatus();}
  if(m.type==='node-completed'){activeNodes.delete(m.nodeId);if(isBusy)workingStatus();}
  if(m.type==='plan')detail(m.reason);
  if(m.type==='model')detail(m.name+' · '+m.model);
  if(m.type==='busy'){canSteer=!!m.runId;busy(true);}
  if(m.type==='context'){$('workspace').textContent='Filadgang via VS Code ? '+m.project;detail(m.text+' Indl?st: '+m.files.join(', '));}
  if(m.type==='started'){includePrevious.checked=false;canSteer=true;resetDetails();busy(true);$('apply').hidden=true;message('Dig',m.prompt+(m.attachments?.length?'\n\nVedhæftet: '+m.attachments.map(a=>a.name).join(', '):''));attachments=[];renderAttachments();$('prompt').value='';remember();}
  if(m.type==='step'&&!activeNodes.size)$('status').textContent=m.name+' arbejder…';

  if(m.type==='activity')detail(m.text);
  if(m.type==='notice'){detail(m.text);$('status').textContent=m.text.slice(0,300);}
  if(m.type==='result'||m.type==='history-result')result(m);
  if(m.type==='orchestrator-reply'){userMessage(m.message);$('status').textContent='Orchestrator har svaret. Teamet arbejder videre.';}
  if(m.type==='user-message')userMessage(m.message);
  if(m.type==='input-routing'&&m.event.type==='node-started')$('status').textContent=m.event.name+' behandler din ekstra besked…';
  if(m.type==='input-routed')$('status').textContent='Din besked er fordelt til den valgte agent.';
  if(m.type==='input-delivered')$('status').textContent=m.name+' har modtaget din ekstra besked.';
  if(m.type==='input-routing-failed')$('status').textContent=m.text;
  if(m.type==='followup-sent'){includePrevious.checked=false;userMessage(m.message);followupSending=false;if($('prompt').value.trim()===submittedText)$('prompt').value='';remember();busy(isBusy);$('status').textContent='Din ekstra besked bliver analyseret og fordelt…';}
  if(m.type==='followup-error'){followupSending=false;busy(isBusy);$('status').textContent=m.text;}
  if(m.type==='done'){$('status').textContent=m.changes.length?m.changes.map(c=>c.kind+': '+c.path).join('\n'):'Workflow færdigt. Ingen filændringer.';$('apply').hidden=m.autoApplying||!m.changes.length;if(m.autoApplying)$('status').textContent='Anvender og gemmer færdige ændringer automatisk…';}
  if(m.type==='applied'){$('apply').hidden=true;$('status').textContent=m.automatic?'Ændringer anvendt og gemt automatisk.':'Ændringer anvendt. Gennemgå dem i Source Control, og gem filerne.';}
  if(m.type==='auto-apply-stopped'){$('apply').hidden=false;$('status').textContent=m.text;}
  if(m.type==='idle'){canSteer=false;busy(false);}
  if(m.type==='error')$('status').textContent=m.text;
  if(m.type==='approval'){const body=message('Godkend handling',m.request.reason||JSON.stringify(m.request));body.id='approval-'+m.id;for(const [label,accept]of[['Godkend',true],['Afvis',false]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>vscode.postMessage({type:'approval',id:m.id,accept});body.append(b);}}
  if(m.type==='approved')$('approval-'+m.id)?.remove();
});
$('form').onsubmit=e=>{e.preventDefault();if(loadingAttachments||followupSending||!connected||(!$('prompt').value.trim()&&!attachments.length))return;if(isBusy){if(!canSteer||!$('prompt').value.trim())return;submittedText=$('prompt').value.trim();followupSending=true;busy(true);vscode.postMessage({type:'followup',text:submittedText,clientId:clientId(),includePreviousConversations:includePrevious.checked});return;}canSteer=false;busy(true);$('status').textContent='Forbereder opgaven…';vscode.postMessage({type:'run',includePreviousConversations:includePrevious.checked,prompt:$('prompt').value.trim()||'Undersøg de vedhæftede filer og billeder.',projectId:$('project').value,attachments:attachments.map(({name,data})=>({name,data}))});};$('connect').onclick=()=>vscode.postMessage({type:'connect'});$('stop').onclick=()=>vscode.postMessage({type:'stop'});$('app').onclick=()=>vscode.postMessage({type:'app'});$('refresh').onclick=()=>vscode.postMessage({type:'refresh'});$('apply').onclick=()=>vscode.postMessage({type:'apply'});$('project').onchange=()=>{remember();if(!isBusy)vscode.postMessage({type:'history',projectId:$('project').value});};$('prompt').oninput=remember;$('prompt').value=saved.draft||'';busy(false);vscode.postMessage({type:'ready'});

$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if((!isBusy||canSteer)&&connected&&($('prompt').value.trim()||attachments.length))$('form').requestSubmit();}});

function renderAttachments(){
 $('attachments').replaceChildren(...attachments.map((file,index)=>{const chip=document.createElement('div');chip.className='attachment';if(file.preview){const img=document.createElement('img');img.src=file.preview;img.alt=file.name;chip.append(img);}const name=document.createElement('span');name.textContent=file.name;name.title=file.name;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Fjern '+file.name);remove.disabled=isBusy;remove.onclick=()=>{attachments.splice(index,1);renderAttachments();};chip.append(name,remove);return chip;}));
}
async function addAttachments(files){
 if(isBusy||loadingAttachments||!files.length)return;loadingAttachments=true;$('send').disabled=true;
 try{
  const selected=Array.from(files);if(attachments.length+selected.length>8||attachments.reduce((n,f)=>n+f.size,0)+selected.reduce((n,f)=>n+f.size,0)>10*1024*1024)throw new Error('Vedhæft højst 8 filer og 10 MB i alt.');
  const batch=await Promise.all(selected.map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Kunne ikke læse '+file.name));reader.onload=()=>{const url=String(reader.result);resolve({name:file.name,size:file.size,data:url.slice(url.indexOf(',')+1),preview:/^image\/(png|jpeg|gif|webp)$/.test(file.type)?url:null});};reader.readAsDataURL(file);})));attachments.push(...batch);renderAttachments();$('status').textContent='Filerne vedhæftes, når du sender opgaven.';
 }catch(e){$('status').textContent=e.message;}finally{loadingAttachments=false;busy(isBusy);$('attachment-input').value='';}
}
$('attach').onclick=()=>$('attachment-input').click();$('attachment-input').onchange=e=>addAttachments(e.target.files);
$('prompt').addEventListener('paste',e=>{if(e.clipboardData?.files.length){e.preventDefault();addAttachments(e.clipboardData.files);}});
$('form').addEventListener('dragover',e=>{e.preventDefault();if(!isBusy)$('form').classList.add('drop-active');});
$('form').addEventListener('dragleave',()=>$('form').classList.remove('drop-active'));
$('form').addEventListener('drop',e=>{e.preventDefault();$('form').classList.remove('drop-active');addAttachments(e.dataTransfer.files);});
