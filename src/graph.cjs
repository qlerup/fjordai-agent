const TYPES=['start','analysis','agent','review','router','condition','text','merge','end'];
const {ancestors,reviewSchema,validateReview}=require('./review.cjs');
const {downstreamRouters,classificationSchema,validateClassification}=require('./classification.cjs');
const {reasoningEffort}=require('./models.cjs');
const {createTeam}=require('./team.cjs');
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
function legacyGraph(steps){const nodes=[{id:'start',type:'start',name:'Start',x:70,y:160},...steps.map((s,i)=>({id:'agent-'+i,type:'agent',x:330+i*260,y:160,...s})),{id:'end',type:'end',name:'Svar',x:330+steps.length*260,y:160}];return{nodes,edges:nodes.slice(0,-1).map((n,i)=>({source:n.id,target:nodes[i+1].id,port:'out'}))};}
function topological(graph){const indegree=new Map(graph.nodes.map(n=>[n.id,0]));for(const e of graph.edges)indegree.set(e.target,indegree.get(e.target)+1);const queue=graph.nodes.filter(n=>!indegree.get(n.id)).map(n=>n.id),order=[];while(queue.length){const id=queue.shift();order.push(id);for(const e of graph.edges.filter(e=>e.source===id)){indegree.set(e.target,indegree.get(e.target)-1);if(!indegree.get(e.target))queue.push(e.target);}}if(order.length!==graph.nodes.length)throw new Error('Workflowet har en cirkel. Forbindelser skal gå fremad uden løkker.');return order;}
function validateGraph(input){
 if(!input||!Array.isArray(input.nodes)||!Array.isArray(input.edges)||input.nodes.length<2||input.nodes.length>32||input.edges.length>96)throw new Error('Lærredet skal have 2–32 noder og højst 96 forbindelser');
 const executionMode=input.executionMode||'manual';
 if(!['manual','dynamic'].includes(executionMode))throw new Error('Ugyldig workflow-tilstand');
 const maxActiveAgents=input.maxActiveAgents??4;
 if(executionMode==='dynamic'&&(!Number.isInteger(maxActiveAgents)||maxActiveAgents<1||maxActiveAgents>16))throw new Error('Dynamiske teams kræver 1–16 samtidige agenter');
 const ids=new Set();const nodes=input.nodes.map(n=>{
  if(!text(n.id,80)||!/^[-\w]+$/.test(n.id)||ids.has(n.id)||!TYPES.includes(n.type)||!text(n.name,60))throw new Error('Ugyldig node eller gentaget node-id');ids.add(n.id);
  const item={id:n.id,type:n.type,name:n.name.trim(),x:Number.isFinite(n.x)?Math.max(0,Math.min(6000,n.x)):100,y:Number.isFinite(n.y)?Math.max(0,Math.min(4000,n.y)):100};
  if(['analysis','agent','review','router'].includes(n.type)){if(!text(n.instructions,12000)||(n.model&&!text(n.model,100)))throw new Error('Agenter og fordelere kræver instruktioner');Object.assign(item,{instructions:n.instructions,model:n.model||'',reasoningEffort:reasoningEffort(n.reasoningEffort),access:n.type!=='agent'?'read':n.access});if(!['read','write'].includes(item.access))throw new Error('Ugyldig filadgang');}
  if(n.type==='review'){
   const limit=n.maxRounds??3,scope=n.reviewScope||'all',targets=n.reviewTargets||[];
   if(!Number.isInteger(limit)||limit<1||limit>5||!['all','selected'].includes(scope)||!Array.isArray(targets)||targets.length>32||new Set(targets).size!==targets.length||targets.some(id=>typeof id!=='string')||scope==='selected'&&!targets.length)throw new Error('Code Reviewer kræver 1–5 rettelsesrunder og gyldige modtagere');
   Object.assign(item,{maxRounds:limit,reviewScope:scope,reviewTargets:targets});
  }
  if(n.type==='router'){if(n.routingMode!==undefined&&!['ai','analysis'].includes(n.routingMode))throw new Error('Ugyldig beslutningskilde');if(n.routingMode==='analysis'&&!n.routes)throw new Error('En fordeler med Inputanalyse kræver navngivne udgange');item.routingMode=n.routingMode||'ai';if(n.maxAgents!==undefined){if(!Number.isInteger(n.maxAgents)||n.maxAgents<1||n.maxAgents>32)throw new Error('Ugyldig grænse for aktive agenter');item.maxAgents=n.maxAgents;}}
  if(['analysis','router'].includes(n.type)&&n.routes!==undefined){
   if(!Array.isArray(n.routes)||!n.routes.length||n.routes.length>8||!['one','multiple'].includes(n.routeMode||'one')||!['prompt','result','both'].includes(n.routingInput||'both'))throw new Error('Fordeleren kræver 1–8 udgange og en gyldig fordelingsregel');
   const ports=new Set();item.routes=n.routes.map(r=>{if(!text(r.id,60)||!/^[-\w]+$/.test(r.id)||ports.has(r.id)||!text(r.name,60)||typeof r.rule!=='string'||r.rule.length>2000)throw new Error('Ugyldig eller gentaget fordelerudgang');ports.add(r.id);return{id:r.id,name:r.name.trim(),rule:r.rule};});
   item.routeMode=n.routeMode||'one';item.routingInput=n.routingInput||'both';
  }
  if(n.type==='condition'){if(!['all','any'].includes(n.match)||!Array.isArray(n.rules)||!n.rules.length||n.rules.length>8)throw new Error('Betingelsen kræver 1–8 regler og OG/ELLER');item.match=n.match;item.rules=n.rules.map(r=>{if(!['prompt','input'].includes(r.source)||!['contains','notContains','equals','empty','greater','less'].includes(r.op)||typeof r.value!=='string'||r.value.length>1000)throw new Error('Ugyldig logikregel');return{source:r.source,op:r.op,value:r.value};});}
  if(n.type==='text'){if(!text(n.template,12000))throw new Error('Tekstnoden kræver indhold');item.template=n.template;}
  return item;
 });
 const byId=new Map(nodes.map(n=>[n.id,n])),seen=new Set();const edges=input.edges.map(e=>{const a=byId.get(e.source),b=byId.get(e.target),port=e.port||'out',key=e.source+':'+port+':'+e.target;const validPort=a?.type==='condition'?['yes','no'].includes(port):['analysis','router'].includes(a?.type)&&a.routes?a.routes.some(r=>r.id===port):port==='out';if(!a||!b||a===b||a.type==='end'||b.type==='start'||seen.has(key)||!validPort)throw new Error('Ugyldig forbindelse');seen.add(key);return{source:e.source,target:e.target,port};});
 const graph={nodes,edges,executionMode,...(executionMode==='dynamic'?{maxActiveAgents}: {})};topological(graph);const starts=nodes.filter(n=>n.type==='start');if(!starts.length)throw new Error('Tilføj mindst én startnode');if(!nodes.some(n=>n.type==='agent'))throw new Error('Tilføj mindst én agent');
 if(executionMode==='dynamic'){
  if(nodes.some(n=>!['start','router','agent','review','end'].includes(n.type)))throw new Error('Dynamisk team understøtter Start, Fordeler, Agent, Reviewer og Svar. Vælg manuelt workflow for andre nodetyper.');
  if(nodes.filter(n=>n.type==='router').length>1||nodes.filter(n=>n.type==='review').length>1)throw new Error('Dynamisk team understøtter højst én Fordeler og én Reviewer');
  return graph;
 }
 for(const reviewer of nodes.filter(n=>n.type==='review')){const before=ancestors(graph,reviewer.id),agents=nodes.filter(n=>n.type==='agent'&&before.has(n.id));if(!agents.length||reviewer.reviewTargets.some(id=>!agents.some(n=>n.id===id)))throw new Error('Code Reviewer kan kun sende rettelser til agenter før review-blokken');}
 const reachable=new Set(starts.map(n=>n.id));for(const id of topological(graph))if(reachable.has(id))for(const e of edges.filter(e=>e.source===id))reachable.add(e.target);
 if(reachable.size!==nodes.length)throw new Error('Alle noder skal være forbundet til en startnode');
 for(const n of nodes){const outs=edges.filter(e=>e.source===n.id);if(n.type!=='end'&&!outs.length)throw new Error('Forbind udgangen fra '+n.name+' til en anden node');if(n.type==='condition'&&(!outs.some(e=>e.port==='yes')||!outs.some(e=>e.port==='no')))throw new Error('Betingelsen '+n.name+' skal have både ja- og nej-forbindelser');}
 for(const n of nodes.filter(n=>['analysis','router'].includes(n.type)&&n.routes))for(const r of n.routes)if(!edges.some(e=>e.source===n.id&&e.port===r.id))throw new Error('Forbind udgangen '+r.name+' fra '+n.name+' til en modtager');
 return graph;
}
function evaluateCondition(node,prompt,input){const tests=node.rules.map(r=>{const raw=r.source==='prompt'?prompt:input,a=raw.toLocaleLowerCase(),b=r.value.toLocaleLowerCase();if(r.op==='contains')return a.includes(b);if(r.op==='notContains')return !a.includes(b);if(r.op==='equals')return a.trim()===b.trim();if(r.op==='empty')return !a.trim();const x=Number(raw),y=Number(r.value);return Number.isFinite(x)&&Number.isFinite(y)&&(r.op==='greater'?x>y:x<y);});return node.match==='all'?tests.every(Boolean):tests.some(Boolean);}

function buildDynamicGraph(graph,startNodeId){
 const used=new Set(graph.nodes.map(n=>n.id));
 const id=stem=>{let candidate=stem,i=1;while(used.has(candidate))candidate=stem+'-'+i++;used.add(candidate);return candidate;};
 const start=graph.nodes.find(n=>n.id===(startNodeId||graph.nodes.find(x=>x.type==='start')?.id)&&n.type==='start');
 if(!start)throw new Error('Vælg en gyldig startnode til det dynamiske workflow');
 const agents=graph.nodes.filter(n=>n.type==='agent');
 const router=graph.nodes.find(n=>n.type==='router');
 const reviewer=graph.nodes.find(n=>n.type==='review');
 const end=graph.nodes.find(n=>n.type==='end')||{id:id('__fjord_team_end'),type:'end',name:'Fælles resultat',x:1000,y:150};
 const distributor={...(router||{id:id('__fjord_team_router'),type:'router',name:'Orchestrator',x:300,y:150,model:'',reasoningEffort:'low',access:'read'}),instructions:(router?.instructions||'Vælg kun de specialister der er nødvendige for brugerens opgave.')+'\nUdfør ikke selv udviklingsarbejdet. Aktivér så få specialister som nødvendigt, og vælg kun noder der har ansvar for delopgaven. Brug deres navne og roller. Returnér kun gyldig JSON.',routingMode:'ai',routeMode:'multiple',routingInput:'prompt',routes:undefined,maxAgents:Math.min(graph.maxActiveAgents||4,agents.length)};
 const merge={id:id('__fjord_team_merge'),type:'merge',name:'Saml teamresultater',x:750,y:150};
 const edge=(source,target)=>({source,target,port:'out'});
 const edges=[edge(start.id,distributor.id),...agents.map(n=>edge(distributor.id,n.id)),...agents.map(n=>edge(n.id,merge.id)),edge(merge.id,reviewer?.id||end.id),...(reviewer?[edge(reviewer.id,end.id)]:[])];
 // This graph exists only for execution. The user's saved manual wires stay unchanged.
 return{nodes:[start,distributor,...agents,merge,...(reviewer?[reviewer]:[]),end],edges,executionMode:'manual',dynamicTeam:true};
}
async function runGraph({workflow,startNodeId,routeOnly=false,...options}){
 if(workflow.graph?.executionMode==='dynamic'){
  const saved=validateGraph(workflow.graph),virtual=buildDynamicGraph(saved,startNodeId);
  const results=await runGraph({workflow:{...workflow,graph:virtual},startNodeId,routeOnly,...options});
  if(routeOnly)return results;
  const agents=new Set(saved.nodes.filter(n=>n.type==='agent').map(n=>n.id));
  const contributions=results.filter(r=>agents.has(r.nodeId));
  const review=results.find(r=>saved.nodes.some(n=>n.type==='review'&&n.id===r.nodeId));
  const text=contributions.map(r=>r.name+':\n'+r.text).join('\n\n').slice(-30000)+(review?'\n\nCode Review:\n'+review.text:'');
  return[...results,{nodeId:virtual.nodes.at(-1).id,name:'Fælles resultat',text:text||'Ingen agentresultater blev afleveret.'}];
 }

 const controller=new AbortController();options.signal=AbortSignal.any([controller.signal,...(options.signal?[options.signal]:[])]);
 require('node:events').setMaxListeners(0,options.signal);
 const graph=validateGraph(workflow.graph),byId=new Map(graph.nodes.map(n=>[n.id,n]));const start=startNodeId?byId.get(startNodeId):graph.nodes.find(n=>n.type==='start');if(!start||start.type!=='start')throw new Error('Projektets startnode findes ikke i dette workflow');
 const {runWorkflow}=require('./codex.cjs');const enabled=new Set([start.id]),parents=new Map(),outputs=new Map(),classifications=new Map(),answers=[];
 const team=createTeam({nodes:graph.nodes,prompt:options.prompt,emit:options.emit,signal:options.signal,route:async request=>{
  const source=byId.get(request.source),before=activeAncestors(source.id),analyst=[...graph.nodes].reverse().find(n=>n.type==='analysis'&&before.has(n.id));
  const decider=source.type==='analysis'?source:source.type==='router'&&source.routingMode!=='analysis'?source:analyst||byId.get(request.members[0]);
  const candidates=request.members.filter(id=>id!==request.from).map(id=>byId.get(id));
  const result=await runWorkflow({...options,signal:AbortSignal.any([AbortSignal.timeout(60000),...(options.signal?[options.signal]:[])]),config:undefined,projectBridge:false,onImage:undefined,emit:()=>{},structuredOutput:true,history:'',steps:[{...decider,name:source.name+' · teamfordeling',taskMode:'analysis',access:'read',instructions:'Fordel kun den nye delopgave til den bedst egnede aktive holdkammerat ud fra roller, teamets opgaver og udgangenes kriterier. Udfør aldrig opgaven. Returnér JSON med target og reason.'}],prompt:JSON.stringify({...request,routes:source.routes||[],candidates:candidates.map(n=>({id:n.id,name:n.name,role:n.instructions}))}),outputSchema:{type:'object',properties:{target:{type:'string',enum:candidates.map(n=>n.id)},reason:{type:'string'}},required:['target','reason'],additionalProperties:false}});
  return JSON.parse(result[0].text);
 }});
 const selectedTargets=new Set();
 const order=topological(graph),answerFor=(node,answer)=>{const value={...answer,nodeId:node.id},index=answers.findIndex(a=>a.nodeId===node.id);if(index<0)answers.push(value);else answers[index]=value;};
 const upstream=id=>{const result=[],seen=new Set();function visit(key){for(const p of parents.get(key)||[]){if(seen.has(p))continue;seen.add(p);visit(p);if(outputs.has(p))result.push(byId.get(p).name+':\n'+outputs.get(p));}}visit(id);return result.join('\n\n').slice(-60000);};
 const rawFor=id=>{const parts=[],seen=new Set();function visit(key){for(const parent of parents.get(key)||[]){if(seen.has(parent))continue;seen.add(parent);if(outputs.has(parent))parts.push(outputs.get(parent));else visit(parent);}}visit(id);return parts.join('\n\n').slice(-60000);};
 const activeAncestors=id=>{const found=new Set();function visit(key){for(const parent of parents.get(key)||[])if(!found.has(parent)){found.add(parent);visit(parent);}}visit(id);return found;};
 const agentTurns=new Map();
 const executeAgent=(node,feedback)=>{
  const turn=(agentTurns.get(node.id)||Promise.resolve()).then(()=>executeAgentTurn(node,feedback));agentTurns.set(node.id,turn);return turn;
 };
 const executeAgentTurn=async(node,feedback)=>{
  options.signal.throwIfAborted();
  const channel=await team.connect(node.id),teamTasks=team.takeTasks(node.id);let result;
  try{result=await runWorkflow({...options,...(channel?{config:{...options.config,mcp_servers:{...options.config?.mcp_servers,...channel.config}}}:{}),emit:e=>options.emit({...e,nodeId:node.id}),history:((options.history||'')+'\n'+upstream(node.id)+(outputs.has(node.id)?'\nTidligere svar fra dig:\n'+outputs.get(node.id):'')+(channel?'\nFælles teamkontekst:\n'+channel.context:'')).slice(-60000),prompt:options.prompt+(teamTasks.length?'\nOpgaver fra dine holdkammerater, som du skal udføre nu med din eksisterende rolle og filadgang:\n'+JSON.stringify(teamTasks):'')+(feedback?'\n\nRettelsesopgave fra Code Reviewer (bevar din eksisterende rolle og filadgang):\n'+JSON.stringify({...feedback,previousResult:outputs.get(node.id)||''}):''),steps:[channel?{...node,instructions:node.instructions+'\nDu er del af et team om SAMME forespørgsel. team_context viser roller, opgaver og færdige resultater. Udfør kun din egen rolle. Hvis din løsning kræver arbejde fra en anden agent, skal du med team_request sende en konkret opgave tilbage til den fordeler, teamet kom fra. Beskriv hvad der skal bygges, funktion, relevante API/datafelter, placering og acceptkriterier. Du må ikke vælge eller instruere modtageren direkte; fordeleren vælger den rette aktive agent. Et pending-svar betyder kun at opgaven er sat i kø, ikke at den er udført. Den udføres før samling/review, også hvis modtageren allerede var færdig. Gentag ikke en allerede registreret opgave. Brug team_context til at se status; vent ikke i en løkke på andre agenter. Hold dig til din egen filadgang og rolle.'}:node]});}
  catch(e){team.finishTasks(teamTasks,true);throw e;}finally{channel?.close();}
  if(typeof result[0]?.text!=='string'||!result[0].text.trim())throw new Error('Agenten '+node.name+' blev færdig uden et svar. Intet er sendt videre.');outputs.set(node.id,result[0].text);answerFor(node,result[0]);
  team.result(node.id,result[0].text);team.finishTasks(teamTasks);
 };
 const executeBatch=async(ids,work)=>{
  const jobs=new Map();let error;
  for(const id of order.filter(id=>ids.includes(id))){const before=activeAncestors(id),dependencies=[...jobs].filter(([key])=>before.has(key)).map(([,job])=>job);jobs.set(id,Promise.all(dependencies).then(()=>{options.signal.throwIfAborted();return work(id);}).catch(e=>{if(!error){error=e;controller.abort(e);}throw e;}));}
  await Promise.allSettled(jobs.values());if(error)throw error;
 };
 const drainTeamTasks=async ids=>{let targets;while((targets=team.pendingTargets().filter(id=>outputs.has(id)&&ids.has(id))).length)await executeBatch(targets,async target=>{options.signal?.throwIfAborted();const node=byId.get(target);options.emit({type:'node-started',nodeId:target,name:node.name});await executeAgent(node);const edges=graph.edges.filter(e=>e.source===target&&parents.get(e.target)?.has(target));options.emit({type:'node-completed',nodeId:target,name:node.name,result:outputs.get(target),targets:edges.map(e=>e.target),edges:edges.map(e=>({port:e.port,target:e.target}))});});};
 const executeNode=async id=>{
  options.signal.throwIfAborted();const node=byId.get(id),input=upstream(id),emit=e=>options.emit({...e,nodeId:id}),rawInput=rawFor(id);options.emit({type:'node-started',nodeId:id,name:node.name});let outgoing=graph.edges.filter(e=>e.source===id);if(['merge','review','end'].includes(node.type))team.assertSettled(activeAncestors(id));
  if(routeOnly&&node.type==='agent'){selectedTargets.add(id);options.emit({type:'node-completed',nodeId:id,name:node.name,targets:[],edges:[]});return;}
  if(node.type==='analysis'){
   const routers=[...(node.routes?[node]:[]),...downstreamRouters(graph,id)],routing=routers.map(n=>({id:n.id,name:n.name,mode:n.routeMode,routes:n.routes.map(r=>({...r,targets:graph.edges.filter(e=>e.source===n.id&&e.port===r.id).map(e=>({id:e.target,name:byId.get(e.target).name,instructions:byId.get(e.target).instructions||''}))}))}));
   const result=await runWorkflow({...options,emit,config:undefined,projectBridge:false,onImage:undefined,history:'',structuredOutput:true,steps:[{...node,taskMode:'analysis'}],prompt:JSON.stringify({task:options.prompt,conversation:options.history||'',previousResult:rawInput,routers:routing}),outputSchema:classificationSchema(routers)});
   const choice=validateClassification(result[0].text,routers);classifications.set(id,choice);outputs.set(id,choice.summary+'\nHensigt: '+choice.intent);emit({type:'step',name:node.name});emit({type:'delta',text:choice.summary});emit({type:'classification',name:node.name,intent:choice.intent,decisions:choice.decisions||[]});
   if(node.routes){const decision=choice.decisions.find(d=>d.routerId===id);outgoing=outgoing.filter(e=>decision.ports.includes(e.port));emit({type:'branch',name:node.name,ports:decision.ports,targets:outgoing.map(e=>e.target),text:'Sendt til: '+decision.ports.map(port=>node.routes.find(r=>r.id===port).name).join(', ')});}
  }
  else if(node.type==='agent')await executeAgent(node);
  else if(node.type==='review'){
   const before=activeAncestors(id),targets=order.map(key=>byId.get(key)).filter(n=>n.type==='agent'&&before.has(n.id)&&outputs.has(n.id)&&(node.reviewScope==='all'||node.reviewTargets.includes(n.id)));
   if(!targets.length)throw new Error('Code Reviewer har ingen aktive rettelsesmodtagere før review-blokken');
   for(let round=0;;round++){
    options.signal?.throwIfAborted();
    const result=await runWorkflow({...options,emit,onImage:undefined,structuredOutput:true,history:((options.history||'')+'\n'+upstream(id)+'\nTeamets ekstra opgaver og status:\n'+team.reviewContext(targets.map(n=>n.id))).slice(-60000),steps:[{...node,taskMode:'review',instructions:node.instructions+'\nKontrollér det faktiske resultat og projektfilerne. Ændr aldrig selv filer. Godkend kun når kravene er opfyldt. Ellers skal corrections angive modtager-id og konkrete rettelser for hver relevant agent fra listen. Vælg aldrig andre modtagere. Returnér kun JSON med approved, summary og corrections.'}],prompt:JSON.stringify({task:options.prompt,extraMessages:options.runInput?.snapshot().text||'',attempt:round+1,remainingCorrectionRounds:node.maxRounds-round,candidates:targets.map(n=>({id:n.id,name:n.name,access:n.access,result:outputs.get(n.id)}))}),outputSchema:reviewSchema(targets)});
    const verdict=validateReview(result[0].text,targets);emit({type:'step',name:node.name});emit({type:'delta',text:verdict.summary});emit({type:'review',name:node.name,approved:verdict.approved,round,maxRounds:node.maxRounds,summary:verdict.summary,corrections:verdict.corrections});
    if(verdict.approved){outputs.set(id,verdict.summary);answerFor(node,{name:node.name,text:verdict.summary});break;}
    if(round>=node.maxRounds)throw new Error(node.name+' har ikke godkendt resultatet efter '+node.maxRounds+' rettelsesrunder. '+verdict.summary);
    const flights=verdict.corrections.map(c=>({port:'revision',target:c.nodeId,transport:'drone'}));emit({type:'node-completed',name:node.name,result:verdict.summary,targets:flights.map(e=>e.target),edges:flights});
    await executeBatch(verdict.corrections.map(c=>c.nodeId),async key=>{const correction=verdict.corrections.find(c=>c.nodeId===key);const target=byId.get(key);options.signal?.throwIfAborted();options.emit({type:'node-started',nodeId:key,name:target.name});await executeAgent(target,{reviewer:node.name,round:round+1,summary:verdict.summary,requestedChanges:correction.message});
     const edges=graph.edges.filter(e=>e.source===key&&(e.target===id||before.has(e.target))&&parents.get(e.target)?.has(key));options.emit({type:'node-completed',nodeId:key,name:target.name,result:outputs.get(key),targets:edges.map(e=>e.target),edges:edges.map(e=>({port:e.port,target:e.target}))});
    });
    await drainTeamTasks(before);
    for(const key of order){const aggregate=byId.get(key);if(!before.has(key)||!['merge','text'].includes(aggregate.type))continue;options.emit({type:'node-started',nodeId:key,name:aggregate.name});outputs.set(key,aggregate.type==='merge'?rawFor(key):aggregate.template.replace(/\{\{prompt\}\}/g,()=>options.prompt).replace(/\{\{input\}\}/g,()=>rawFor(key)));const edges=graph.edges.filter(e=>e.source===key&&(e.target===id||before.has(e.target))&&parents.get(e.target)?.has(key));options.emit({type:'node-completed',nodeId:key,name:aggregate.name,result:outputs.get(key),targets:edges.map(e=>e.target),edges:edges.map(e=>({port:e.port,target:e.target}))});}
    emit({type:'node-started',name:node.name});
   }
  }
  else if(node.type==='router'){
   if(node.routingMode==='analysis'){
    const choices=[],seen=new Set();function collect(key){for(const parent of parents.get(key)||[]){if(seen.has(parent))continue;seen.add(parent);const choice=classifications.get(parent);if(choice){const decision=choice.decisions?.find(d=>d.routerId===id);if(decision)choices.push({choice,decision});}else collect(parent);}}collect(id);
    if(choices.length!==1)throw new Error('Fordeleren '+node.name+' kræver én entydig vurdering fra en Inputanalyse-maskine før den kan fordele opgaven');
    const {choice,decision}=choices[0];outgoing=outgoing.filter(e=>decision.ports.includes(e.port));if(!outgoing.length)throw new Error('Inputanalysens valgte udgang er ikke forbundet');outputs.set(id,choice.summary);options.emit({type:'branch',nodeId:id,name:node.name,ports:decision.ports,targets:outgoing.map(e=>e.target),text:choice.summary});
   }else if(node.routes){
    const allowed=node.routes.map(r=>({...r,targets:outgoing.filter(e=>e.port===r.id).map(e=>({id:e.target,name:byId.get(e.target).name,instructions:byId.get(e.target).instructions||''}))}));
    const payload={...(node.routingInput!=='result'?{task:options.prompt}:{}),...(node.routingInput!=='prompt'?{previousResult:rawInput}:{}),routes:allowed};
    const result=await runWorkflow({...options,emit,config:undefined,projectBridge:false,attachments:node.routingInput==='result'?[]:options.attachments,history:'',structuredOutput:true,steps:[{...node,instructions:node.instructions+'\nVælg '+(node.routeMode==='one'?'præcis én udgang':'én eller flere relevante udgange')+' ud fra deres navn, kriterier og modtagere. Brug ingen værktøjer. Returner kun JSON med routes og reason. Vælg kun tilladte udgangs-id’er.'}],prompt:JSON.stringify(payload),outputSchema:{type:'object',properties:{routes:{type:'array',items:{type:'string'},minItems:1,maxItems:node.routeMode==='one'?1:node.routes.length},reason:{type:'string'}},required:['routes','reason'],additionalProperties:false}});
    const choice=JSON.parse(result[0].text);
    if(!Array.isArray(choice.routes)||!choice.routes.length||(node.routeMode==='one'&&choice.routes.length!==1)||new Set(choice.routes).size!==choice.routes.length||choice.routes.some(port=>!node.routes.some(r=>r.id===port)))throw new Error('Fordeleren valgte en ugyldig udgang');
    outgoing=outgoing.filter(e=>choice.routes.includes(e.port));outputs.set(id,String(choice.reason||''));options.emit({type:'branch',nodeId:id,name:node.name,ports:choice.routes,targets:outgoing.map(e=>e.target),text:choice.reason});
   }else{
   const result=await runWorkflow({...options,emit,config:undefined,projectBridge:false,history:input,structuredOutput:true,steps:[{...node,instructions:node.instructions+'\nVælg 1 eller flere tilladte modtager-id’er fra listen. Brug ingen værktøjer. Returner kun JSON med targets og reason. Vælg kun noder med direkte forbindelse.'}],prompt:JSON.stringify({task:options.prompt,targets:outgoing.map(e=>({id:e.target,name:byId.get(e.target).name,instructions:byId.get(e.target).instructions||''}))}),outputSchema:{type:'object',properties:{targets:{type:'array',items:{type:'string'},minItems:1,maxItems:node.maxAgents||32},reason:{type:'string'}},required:['targets','reason'],additionalProperties:false}});
   const choice=JSON.parse(result[0].text);if(!Array.isArray(choice.targets)||!choice.targets.length||(node.maxAgents&&choice.targets.length>node.maxAgents)||choice.targets.some(t=>!outgoing.some(e=>e.target===t)))throw new Error('Fordeleren valgte en node uden tilladt forbindelse');outgoing=outgoing.filter(e=>choice.targets.includes(e.target));outputs.set(id,String(choice.reason||''));options.emit({type:'branch',nodeId:id,name:node.name,targets:outgoing.map(e=>e.target),text:choice.reason});
   }
  }else if(node.type==='condition'){const pass=evaluateCondition(node,options.prompt,rawInput);outgoing=outgoing.filter(e=>e.port===(pass?'yes':'no'));options.emit({type:'branch',nodeId:id,name:node.name,targets:outgoing.map(e=>e.target),text:pass?'Betingelsen er opfyldt → ja':'Betingelsen er ikke opfyldt → nej'});}
  else if(node.type==='text')outputs.set(id,node.template.replace(/\{\{prompt\}\}/g,()=>options.prompt).replace(/\{\{input\}\}/g,()=>rawInput));
  else if(node.type==='merge')outputs.set(id,rawInput);
  else if(node.type==='end'&&!answers.length&&rawInput){answers.push({name:node.name,text:rawInput,nodeId:id});options.emit({type:'step',name:node.name});options.emit({type:'delta',text:rawInput});}
  team.register(id,outgoing);
  for(const e of outgoing){enabled.add(e.target);if(!parents.has(e.target))parents.set(e.target,new Set());parents.get(e.target).add(id);}
  options.emit({type:'node-completed',nodeId:id,name:node.name,result:outputs.get(id)||'',targets:outgoing.map(e=>e.target),edges:outgoing.map(e=>({port:e.port,target:e.target}))});
 };
 // Resolve every incoming edge (including skipped branches) before starting a
 // node. Independent ready nodes start immediately, without a wave barrier.
 const settled=new Set(),running=new Map(),generations=new Map(),inputAssignments=new Set(),incoming=new Map(graph.nodes.map(n=>[n.id,graph.edges.filter(e=>e.target===n.id).map(e=>e.source)]));
 let failure;
 const launch=(id,work)=>{
  const flight=Promise.resolve().then(work).catch(e=>{if(!failure){failure=e;controller.abort(e);}}).finally(()=>running.delete(id));
  running.set(id,flight);
 };
 try{
  while(settled.size<order.length||running.size||team.pendingTargets().length||options.runInput?.routing||options.runInput?.pendingTargets().length){
   options.signal.throwIfAborted();
   for(const message of options.runInput?.assignments||[]){
    if(inputAssignments.has(message.id))continue;inputAssignments.add(message.id);
    for(const target of message.targets){
     if(byId.get(target)?.type!=='agent')throw new Error('Den ekstra besked blev fordelt til en ugyldig agent');
     enabled.add(target);if(!running.has(target))settled.delete(target);
     // Refresh dependent collection/review even if it was already completed or
     // running when this new assignment was analyzed. Other branches keep going.
     const descendants=new Set();function invalidate(id){for(const edge of graph.edges.filter(e=>e.source===id))if(!descendants.has(edge.target)){descendants.add(edge.target);invalidate(edge.target);}}invalidate(target);
     for(const id of descendants){settled.delete(id);generations.set(id,(generations.get(id)||0)+1);}
    }
   }
   // Extra assignments received while an agent was working run again with its
   // existing role. Never run two turns for the same agent simultaneously.
   for(const id of team.pendingTargets())if(settled.has(id)&&!running.has(id))launch(id,async()=>{
    const node=byId.get(id);options.emit({type:'node-started',nodeId:id,name:node.name});await executeAgent(node);
    const edges=graph.edges.filter(e=>e.source===id&&parents.get(e.target)?.has(id));options.emit({type:'node-completed',nodeId:id,name:node.name,result:outputs.get(id),targets:edges.map(e=>e.target),edges:edges.map(e=>({port:e.port,target:e.target}))});
   });
   let skipped=false;
   for(const id of order){
    if(settled.has(id)||running.has(id)||incoming.get(id).some(p=>!settled.has(p)||running.has(p)))continue;
    if(!enabled.has(id)){settled.add(id);skipped=true;continue;}
    const before=activeAncestors(id);
    // Wait for queued revisions to the inputs being collected. Team membership
    // alone must never introduce a dependency on an unconnected branch.
    if(['merge','review','end'].includes(byId.get(id).type)&&(options.runInput?.routing||[...before].some(p=>running.has(p)||team.pendingTargets().includes(p)||options.runInput?.pendingTargets().includes(p))))continue;
    const generation=generations.get(id)||0;launch(id,async()=>{await executeNode(id);if(generation===(generations.get(id)||0))settled.add(id);});
   }
   if(running.size||options.runInput?.routing){const change=options.runInput?.watch();try{await Promise.race([...running.values(),...(change?[change.promise]:[])]);}finally{change?.close();}}
   else if(!skipped&&settled.size<order.length)throw new Error('Workflowet kunne ikke fortsætte: uafsluttede afhængigheder');
   if(failure)throw failure;
  }
  team.assertSettled();return routeOnly?[...selectedTargets]:answers.sort((a,b)=>order.indexOf(a.nodeId)-order.indexOf(b.nodeId));
 }finally{controller.abort();await Promise.allSettled(running.values());team.close();}
}
module.exports={legacyGraph,validateGraph,topological,evaluateCondition,buildDynamicGraph,runGraph};
