const {randomUUID}=require('node:crypto');

// One bounded inbox per run. Messages survive as run data; subscriptions only
// live for the current turn, so completed threads never receive later input.
function createRunInput({messages=[],emit=()=>{},save=()=>{},route,onError=()=>{}}={}){
 const listeners=new Set(),changes=new Set();let routingQueue=Promise.resolve();
 const changed=()=>{for(const listener of changes)listener();};
 const snapshot=key=>{const selected=messages.filter(m=>m.status==='ready'&&(!key||m.targets.includes(key)));return{version:selected.at(-1)?.sequence||0,messages:selected,text:selected.map(m=>'Ekstra besked fra brugeren: '+m.text+(m.analysis?'\nInputanalysens vurdering: '+m.analysis:'')).join('\n\n')};};
 function assigned(message,targets){
  if(!Array.isArray(targets)||!targets.length)throw new Error('Fordeleren fandt ingen agent til den ekstra besked');
  message.targets=[...new Set(targets)];message.status='ready';emit({type:'input-routed',messageId:message.id,targets:message.targets});save();
  for(const listener of listeners)if(message.targets.includes(listener.key))listener.handler(message);
  changed();
 }
 function append(text,clientId){
  if(typeof text!=='string'||!text.trim()||text.length>20000)throw Object.assign(new Error('Skriv en besked på højst 20.000 tegn'),{status:400});
  if(clientId!==undefined&&(typeof clientId!=='string'||!/^[-\w]{1,80}$/.test(clientId)))throw Object.assign(new Error('Ugyldigt besked-id'),{status:400});
  const duplicate=clientId&&messages.find(m=>m.clientId===clientId);if(duplicate){if(duplicate.text!==text.trim())throw Object.assign(new Error('Besked-id er allerede brugt til en anden tekst'),{status:409});return duplicate;}
  if(messages.length>=32||messages.reduce((n,m)=>n+m.text.length,0)+text.length>64000)throw Object.assign(new Error('Denne opgave har nået grænsen for ekstra beskeder. Start en ny opgave, når den er færdig.'),{status:400});
  const message={id:randomUUID(),...(clientId?{clientId}:{}),text:text.trim(),sequence:messages.length+1,at:new Date().toISOString(),status:'routing',targets:[],deliveredTo:[]};
  messages.push(message);emit({type:'user-message',message});save();
  changed();
  if(route)routingQueue=routingQueue.then(async()=>assigned(message,await route(message))).catch(e=>{message.status='failed';message.error=e.message;emit({type:'input-routing-failed',messageId:message.id,text:e.message});save();changed();onError(e);});
  return message;
 }
 function subscribe(after,handler,key){const listener={key,handler};listeners.add(listener);for(const message of snapshot(key).messages)if(message.sequence>after)handler(message);return()=>listeners.delete(listener);}
 function delivered(message,key,name){if(message.deliveredTo.includes(key))return;message.deliveredTo.push(key);emit({type:'input-delivered',messageId:message.id,name});save();}
 function watch(){let resolve;const promise=new Promise(r=>{resolve=r;});changes.add(resolve);return{promise,close:()=>changes.delete(resolve)};}
 const pendingTargets=()=>[...new Set(messages.filter(m=>m.status==='ready').flatMap(m=>m.targets.filter(id=>!m.deliveredTo.includes(id))))];
 return{append,assigned,snapshot,subscribe,delivered,watch,pendingTargets,get assignments(){return messages.filter(m=>m.status==='ready');},get routing(){return messages.some(m=>m.status==='routing');}};
}
module.exports={createRunInput};
