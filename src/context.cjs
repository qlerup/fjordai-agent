const LIMIT=36000,CHUNK=24000;
function record(run){return 'Bruger: '+run.prompt+'\n'+(run.messages||[]).map(m=>'Ekstra besked fra bruger: '+m.text+'\n').join('')+run.answers.map(a=>a.name+': '+a.text).join('\n')+(run.images?.length?'\nGenererede billeder: '+run.images.length:'');}
async function projectContext({project,runs,summarize,save,emit}){
 const memory=project.memory,completed=runs.filter(r=>r.projectId===project.id&&r.status==='completed');
 const previous=memory?.throughRunId?completed.findIndex(r=>r.id===memory.throughRunId):-1;
 const pending=previous>=0?completed.slice(previous+1):completed.filter(r=>!memory?.throughCreatedAt||r.createdAt>memory.throughCreatedAt);
 const prefix=memory?.summary?'Tidligere samtale (opsummering):\n'+memory.summary+'\n\n':'';
 if((prefix+pending.map(record).join('\n\n')).length<=LIMIT)return prefix+pending.map(record).join('\n\n');
 emit({type:'compaction',state:'started',scope:'project',name:'Samtalen'});
 // Keep the most recent exchange verbatim; compact older exchanges in bounded batches.
 const keep=pending.length&&record(pending.at(-1)).length<=16000?1:0;
 const older=pending.slice(0,pending.length-keep),recent=keep?pending.slice(-1):[];let summary=memory?.summary||'',batch='';
 for(const run of older){let content='\n\n'+record(run);while(content){const part=content.slice(0,CHUNK-batch.length);batch+=part;content=content.slice(part.length);if(batch.length===CHUNK){summary=await summarize(summary,batch);batch='';}}}
 if(batch)summary=await summarize(summary,batch);
 if(!older.length){emit({type:'compaction',state:'completed',scope:'project',name:'Samtalen'});return prefix+recent.map(record).join('\n\n');}
 const last=older.at(-1);project.memory={summary,throughRunId:last.id,throughCreatedAt:last.createdAt};save();
 emit({type:'compaction',state:'completed',scope:'project',name:'Samtalen'});
 return 'Tidligere samtale (opsummering):\n'+summary+'\n\n'+recent.map(record).join('\n\n');
}
module.exports={projectContext};
