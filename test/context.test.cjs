const {test}=require('node:test'),assert=require('node:assert/strict');const {projectContext}=require('../src/context.cjs');
const run=(id,text)=>({id,projectId:'p',status:'completed',prompt:id,answers:[{name:'Agent',text}],createdAt:id});
test('long project history is summarized in bounded chunks, persisted and reused with recent exchanges',async()=>{
 const project={id:'p'},runs=[run('01','goal '.repeat(7000)),run('02','decision '.repeat(2000)),run('03','Recent exact answer')],events=[],chunks=[];let saves=0;
 const options={project,runs,save:()=>saves++,emit:e=>events.push(e),summarize:async(summary,content)=>{chunks.push(content);return 'Preserved goal and decisions';}};
 const history=await projectContext(options);assert.match(history,/Preserved goal/);assert.match(history,/Recent exact answer/);assert.ok(history.length<36000);assert.ok(chunks.every(c=>c.length<=24000));assert.equal(project.memory.throughRunId,'02');assert.equal(saves,1);assert.deepEqual(events.map(e=>e.state),['started','completed']);
 const count=chunks.length;assert.equal(await projectContext(options),history);assert.equal(chunks.length,count);
 runs.push({...run('04','Do not leak another project'),projectId:'other'});assert.equal(await projectContext(options),history);
});
test('failed compaction keeps existing memory and does not silently discard the conversation',async()=>{
 const project={id:'p',memory:{summary:'Original memory'}},old=JSON.stringify(project);
 await assert.rejects(projectContext({project,runs:[run('01','x'.repeat(50000))],save:()=>assert.fail(),emit:()=>{},summarize:async()=>{throw Error('Offline');}}),/Offline/);assert.equal(JSON.stringify(project),old);
});


test('a fresh conversation does not inject archived messages or answers',async()=>{
 const project={id:'p',conversationId:'new'},runs=[run('old','OLD ANSWER'),{...run('current','CURRENT ANSWER'),conversationId:'new'}];
 const result=await projectContext({project,runs,save:()=>{},emit:()=>{},summarize:()=>assert.fail()});assert.match(result,/CURRENT ANSWER/);assert.doesNotMatch(result,/OLD ANSWER/);
});

test('explicit archive context includes only the same project and archived conversations',()=>{
 const {archivedContext}=require('../src/context.cjs'),project={id:'p',conversationId:'new'};
 const result=archivedContext(project,[run('old','EXPLICIT OLD'),{...run('same','CURRENT'),conversationId:'new'},{...run('foreign','OTHER PROJECT'),projectId:'other'}]);assert.match(result,/EXPLICIT OLD/);assert.doesNotMatch(result,/CURRENT|OTHER PROJECT/);
});
