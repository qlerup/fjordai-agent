// Discover the full upstream catalog rather than inventing legacy model IDs.
async function listModels(codex) {
  const data=[], models=new Set(), cursors=new Set();let cursor;
  for(let page=0;page<100;page++){
    const result=await codex.rpc('model/list',{includeHidden:true,limit:100,...(cursor?{cursor}:{})});
    if(!Array.isArray(result?.data))throw new Error('Codex returnerede et ugyldigt modelkatalog');
    for(const model of result.data){
      const id=model?.model||model?.id;
      if(typeof id!=='string'||!id||models.has(id))continue;
      models.add(id);data.push(model);
    }
    cursor=result.nextCursor;
    if(cursor===null||cursor===undefined||cursor==='')return{data,nextCursor:null};
    if(typeof cursor!=='string'||cursors.has(cursor))throw new Error('Codex gentog eller returnerede en ugyldig modelside');
    cursors.add(cursor);
  }
  throw new Error('Codex-modelkataloget overskred 100 sider');
}
function reasoningEffort(value){
  if(value===undefined||value===null||value==='')return '';
  if(typeof value!=='string'||!['none','minimal','low','medium','high','xhigh','max','ultra'].includes(value))throw new Error('Ugyldigt reasoning-niveau');
  return value;
}
async function validateReasoning(codex,step){
  const effort=reasoningEffort(step.reasoningEffort);if(!effort)return;
  const {data}=await listModels(codex);
  const model=step.model?data.find(m=>(m.model||m.id)===step.model):data.find(m=>m.isDefault);
  if(!model?.supportedReasoningEfforts?.some(e=>(typeof e==='string'?e:e.reasoningEffort)===effort))throw new Error('Reasoning-niveauet '+effort+' understøttes ikke af modellen for '+step.name+'. Vælg et andet niveau eller Automatisk.');
}
module.exports={listModels,reasoningEffort,validateReasoning};
