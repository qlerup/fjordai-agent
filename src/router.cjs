const {runWorkflow}=require('./codex.cjs');
async function routeTask({codex,workflows,prompt,cwd,model,signal,emit}){
 const agents=workflows.flatMap(w=>w.steps.map((s,i)=>({id:w.id+':'+i,workflow:w.name,...s}))).slice(0,64);
 const result=await runWorkflow({codex,cwd,prompt:JSON.stringify({task:prompt,availableAgents:agents.map(({id,name,instructions,access,model,workflow})=>({id,name,instructions:instructions.slice(0,1500),access,model,workflow}))}),steps:[{name:'Fordeler',access:'read',model:model||'',instructions:'Du fordeler en opgave til specialister. Brug kun opgavebeskrivelsen og agentlisten. Brug ingen værktøjer. Vælg det mindste tilstrækkelige sæt agenter, 1–4, i udførelsesrækkefølge. Rene spørgsmål bør normalt kun få én læseagent. Kodeændringer bør normalt have en udvikler og ved behov en reviewer. Vælg kun eksisterende agent-id’er. Returner JSON med agents og reason på dansk.'}],signal,emit,outputSchema:{type:'object',properties:{agents:{type:'array',items:{type:'string'},minItems:1,maxItems:4},reason:{type:'string'}},required:['agents','reason'],additionalProperties:false}});
 const plan=JSON.parse(result[0].text);if(!Array.isArray(plan.agents)||!plan.agents.length||plan.agents.length>4||new Set(plan.agents).size!==plan.agents.length)throw new Error('Fordeleren returnerede en ugyldig plan');
 const steps=plan.agents.map(id=>{const a=agents.find(a=>a.id===id);if(!a)throw new Error('Fordeleren valgte en ukendt agent');return a;});
 return {steps,reason:String(plan.reason||'').slice(0,1500)};
}
module.exports={routeTask};
