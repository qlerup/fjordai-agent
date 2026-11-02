const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');const {runGraph,validateGraph}=require('../src/graph.cjs');
const approve={approved:true,summary:'Godkendt',corrections:[]},reject={approved:false,summary:'Frontend mangler håndtering af fejl',corrections:[{nodeId:'front',message:'Tilføj fejlhåndtering'}]};
function graph(maxRounds=3){return{nodes:[{id:'s',type:'start',name:'Start'},{id:'front',type:'agent',name:'Frontend',instructions:'FRONTEND',access:'write'},{id:'back',type:'agent',name:'Backend',instructions:'BACKEND',access:'read'},{id:'merge',type:'merge',name:'Saml'},{id:'review',type:'review',name:'Code Reviewer',instructions:'Review the actual result',maxRounds,access:'write'},{id:'end',type:'end',name:'Svar'}],edges:[['s','front'],['s','back'],['front','merge'],['back','merge'],['merge','review'],['review','end']].map(([source,target,port='out'])=>({source,target,port}))};}
class Fake extends EventEmitter{
 constructor(verdicts=[reject,approve],{failRepair=false,hangRepair=false}={}){super();this.verdicts=verdicts;this.failRepair=failRepair;this.hangRepair=hangRepair;this.threads=[];this.turns=[];this.versions={front:0,back:0};this.reviews=[];this.interrupted=false;}
 async rpc(method,p){if(method==='thread/start'){const id='t'+this.threads.length;this.threads.push(p);return{thread:{id}};}if(method==='turn/interrupt'){this.interrupted=true;return{};}if(method!=='turn/start')return{};
  this.turns.push(p);const thread=this.threads[Number(p.threadId.slice(1))],review=!!p.outputSchema?.properties.approved;let text,failed=false;
  if(review){this.reviews.push(JSON.parse(p.input[0].text.split('\n\nTidligere')[0]));text=JSON.stringify(this.verdicts[Math.min(this.reviews.length-1,this.verdicts.length-1)]);}
  else{const key=thread.developerInstructions.includes('FRONTEND')?'front':'back';this.versions[key]++;text=key+' v'+this.versions[key];if(key==='front'&&this.versions.front>1){if(this.hangRepair)return{turn:{id:'turn'}};failed=this.failRepair;}}
  setImmediate(()=>{this.emit('message',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',text}}});this.emit('message',{method:'turn/completed',params:{threadId:p.threadId,turn:{status:failed?'failed':'completed',error:failed?{message:'Repair failed'}:undefined}}});});return{turn:{id:'turn'}};
 }
}
const run=(g,c,events=[],extra={})=>runGraph({workflow:{graph:g},codex:c,cwd:'/tmp',prompt:'Build a page',emit:e=>events.push(e),...extra});
test('Code Reviewer sends targeted drone corrections, refreshes merge and approves only the revised result',async()=>{
 const c=new Fake(),events=[],result=await run(graph(),c,events);assert.equal(c.versions.front,2);assert.equal(c.versions.back,1);assert.equal(c.reviews.length,2);assert.deepEqual(c.reviews[1].candidates.map(n=>n.result),['front v2','back v1']);assert.match(result.find(a=>a.nodeId==='front').text,/v2/);assert.equal(result.filter(a=>a.nodeId==='front').length,1);assert.equal(result.at(-1).nodeId,'review');
 const flight=events.find(e=>e.nodeId==='review'&&e.type==='node-completed'&&e.edges[0]?.transport==='drone');assert.deepEqual(flight.edges,[{port:'revision',target:'front',transport:'drone'}]);assert.equal(events.filter(e=>e.nodeId==='merge'&&e.type==='node-started').length,2);
 const lastReview=events.findLastIndex(e=>e.type==='review'&&e.approved),end=events.findIndex(e=>e.type==='node-started'&&e.nodeId==='end');assert.ok(end>lastReview);assert.equal(c.threads.filter(t=>t.developerInstructions.includes('Du er Code Reviewer')).length,2);assert.ok(c.threads.filter(t=>t.developerInstructions.includes('Du er Code Reviewer')).every(t=>t.sandbox==='read-only'&&t.config['features.image_generation']===false));assert.match(c.turns.find(t=>t.input[0].text.includes('Rettelsesopgave fra Code Reviewer')).input[0].text,/Tilføj fejlhåndtering/);
});
test('review round limit and failed repairs stop downstream execution',async()=>{
 const c=new Fake([reject]),events=[];await assert.rejects(run(graph(2),c,events),/efter 2 rettelsesrunder/);assert.equal(c.reviews.length,3);assert.equal(c.versions.front,3);assert.ok(!events.some(e=>e.nodeId==='end'&&e.type==='node-started'));
 const broken=new Fake([reject],{failRepair:true}),failed=[];await assert.rejects(run(graph(),broken,failed),/Repair failed/);assert.ok(!failed.some(e=>e.nodeId==='end'&&e.type==='node-started'));
});

test('independent reviewer corrections run in parallel before the next review',async()=>{
 const verdict={...reject,corrections:[{nodeId:'front',message:'Fix UI'},{nodeId:'back',message:'Fix API'}]},c=new Fake([verdict,approve]),events=[];
 await run(graph(),c,events);assert.deepEqual(c.versions,{front:2,back:2});
 const revision=events.findIndex(e=>e.nodeId==='review'&&e.type==='node-completed'),after=events.slice(revision+1);
 const firstCompleted=after.findIndex(e=>e.type==='node-completed'&&['front','back'].includes(e.nodeId));
 assert.deepEqual(after.slice(0,firstCompleted).filter(e=>e.type==='node-started').map(e=>e.nodeId).sort(),['back','front']);
 assert.deepEqual(c.reviews[1].candidates.map(c=>c.result),['front v2','back v2']);
});
test('review cannot target foreign, duplicate or unconfigured agents, and approval cannot request repairs',async()=>{
 for(const verdict of [{...reject,corrections:[{nodeId:'end',message:'Do work'}]},{...reject,corrections:[...reject.corrections,...reject.corrections]},{...reject,corrections:[]},{...approve,corrections:reject.corrections}]){const c=new Fake([verdict]);await assert.rejects(run(graph(),c),/Code Reviewer/);assert.equal(c.versions.front,1);}
 const g=graph();g.nodes.find(n=>n.id==='review').reviewScope='selected';g.nodes.find(n=>n.id==='review').reviewTargets=['back'];await assert.rejects(run(g,new Fake([reject])),/rettelsesmodtager/);
 for(const limit of [0,6,1.5])assert.throws(()=>validateGraph(graph(limit)),/rettelsesrunder/);
 const bad=graph();bad.nodes.find(n=>n.id==='review').reviewTargets=['end'];assert.throws(()=>validateGraph(bad),/før review/);
});
test('cancellation interrupts an active correction turn',async()=>{
 const c=new Fake([reject],{hangRepair:true}),controller=new AbortController(),events=[];const pending=run(graph(),c,events,{signal:controller.signal});const rejection=assert.rejects(pending,/stoppet/);for(let i=0;i<100&&c.versions.front<2;i++)await new Promise(r=>setImmediate(r));assert.equal(c.versions.front,2);controller.abort();await rejection;assert.equal(c.interrupted,true);assert.ok(!events.some(e=>e.nodeId==='end'&&e.type==='node-started'));
});
test('review waits for selected branches and never reactivates a skipped correction candidate',async()=>{
 const g=graph();g.nodes.push({id:'choose',type:'condition',name:'Choice',match:'all',rules:[{source:'prompt',op:'contains',value:'Build'}]});g.edges=g.edges.filter(e=>e.source!=='s');g.edges.push({source:'s',target:'choose',port:'out'},{source:'choose',target:'front',port:'yes'},{source:'choose',target:'back',port:'no'});
 const c=new Fake(),result=await run(g,c);assert.deepEqual(c.reviews[0].candidates.map(n=>n.id),['front']);assert.equal(c.versions.back,0);assert.deepEqual(result.map(a=>a.nodeId),['front','review']);
});
test('review corrections edit the server working copy and return a patch while original files stay untouched',async t=>{
 const fs=require('fs'),os=require('os'),path=require('path'),{validateSnapshot,writeSnapshot,collectChanges}=require('../src/workspace.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-review-copy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const original='function add(a,b) { return a - b; }',fixed='function add(a,b) { return a + b; }',originalFile=path.join(dir,'original.js'),copy=path.join(dir,'working-copy');fs.writeFileSync(originalFile,original);const snapshot=validateSnapshot([{path:'math.js',content:original}]);writeSnapshot(copy,snapshot);
 class FileWorker extends Fake{async rpc(method,p){if(method==='turn/start'&&!p.outputSchema){const thread=this.threads[Number(p.threadId.slice(1))];if(thread.developerInstructions.includes('FRONTEND'))fs.writeFileSync(path.join(thread.cwd,'math.js'),this.versions.front?fixed:original);}return super.rpc(method,p);}}
 const c=new FileWorker(),result=await run(graph(),c,[],{cwd:copy});assert.equal(result.at(-1).text,'Godkendt');assert.equal(fs.readFileSync(originalFile,'utf8'),original);const changes=collectChanges(copy,snapshot);assert.equal(changes.length,1);assert.equal(changes[0].path,'math.js');assert.equal(changes[0].kind,'modify');assert.equal(changes[0].content,fixed);assert.equal(changes[0].baseHash,snapshot[0].hash);
});
