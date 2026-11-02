const {test}=require('node:test');const assert=require('node:assert/strict');
const load=()=>import('../public/factory-playback.mjs');
const started=nodeId=>({type:'node-started',nodeId});
const completed=(nodeId,target,port='out')=>({type:'node-completed',nodeId,edges:target?[{target,port}]:[]});

test('parallel machines remain active independently and Stop clears every running machine',async()=>{
 const {FactoryPlayback}=await load(),p=new FactoryPlayback(),events=[started('a'),started('b'),completed('a')];
 p.update({runId:'parallel',events,status:'running'});p.advance(0);assert.equal(p.nodes.a,'running');assert.equal(p.nodes.b,'running');
 p.advance(650);assert.equal(p.nodes.a,'completed');assert.equal(p.nodes.b,'running');assert.equal(p.active,'b');assert.equal(p.pending,true);
 events.push(started('c'));p.update({runId:'parallel',events,status:'running'});p.advance(0);
 p.update({runId:'parallel',events,status:'interrupted'});p.advance(0);assert.equal(p.nodes.b,'interrupted');assert.equal(p.nodes.c,'interrupted');assert.equal(p.pending,false);
});
test('a whole run received in one poll still works each machine and finishes every selected transfer',async()=>{
 const {FactoryPlayback}=await load(),p=new FactoryPlayback();
 const events=[started('s'),completed('s','a'),started('a'),completed('a','end','chosen'),started('end'),completed('end')];
 p.update({runId:'fast',events,status:'completed'});p.advance(0);assert.equal(p.active,'s');p.advance(649);assert.equal(p.transfers.length,0);p.advance(1);assert.equal(p.transfers[0].progress,0);
 p.advance(275);assert.equal(p.transfers[0].progress,.5);assert.equal(p.nodes.a,undefined);
 p.update({runId:'fast',events,status:'completed'});p.advance(275);assert.equal(p.active,'a');
 p.advance(650);assert.equal(p.transfers[0].port,'chosen');p.advance(550);assert.equal(p.active,'end');p.advance(650);
 assert.equal(p.pending,false);assert.deepEqual(p.nodes,{s:'completed',a:'completed',end:'completed'});
 p.update({runId:'fast',events,status:'completed'});assert.equal(p.pending,false);
 p.update({runId:'new',events:[started('s')],status:'running'});p.advance(0);assert.deepEqual(p.nodes,{s:'running'});
});
test('no package leaves before completion; stopping preserves the completed transfer and stops the active machine',async()=>{
 const {FactoryPlayback}=await load(),p=new FactoryPlayback();const events=[started('s'),completed('s','a'),started('a')];
 p.update({runId:'r',events,status:'running'});p.advance(0);p.advance(650);p.advance(550);p.advance(5000);
 assert.equal(p.active,'a');assert.equal(p.transfers.length,0);
 p.update({runId:'r',events,status:'interrupted'});p.advance(0);assert.equal(p.nodes.a,'interrupted');assert.equal(p.pending,false);
});
test('review corrections replay as drone delivery before agents rerun, and approval opens the final route',async()=>{
 const {FactoryPlayback}=await load(),p=new FactoryPlayback(),events=[started('review'),{type:'review',nodeId:'review',approved:false},{type:'node-completed',nodeId:'review',edges:[{target:'agent',port:'revision',transport:'drone'}]},started('agent'),completed('agent','review'),started('review'),{type:'review',nodeId:'review',approved:true},completed('review','end'),started('end'),completed('end')];
 p.update({runId:'review',events,status:'completed'});p.advance(0);p.advance(650);assert.equal(p.reviews.review,'changes');assert.equal(p.transfers[0].transport,'drone');p.advance(800);assert.equal(p.transfers[0].progress,.5);assert.equal(p.nodes.agent,undefined);
 p.advance(800);assert.equal(p.active,'agent');p.advance(650);p.advance(550);assert.equal(p.active,'review');assert.equal(p.reviews.review,undefined);p.advance(650);assert.equal(p.reviews.review,'approved');assert.equal(p.transfers[0].target,'end');p.advance(550);p.advance(650);assert.equal(p.pending,false);
});
test('extra tasks fly from worker to distributor and then to recipient without completing the worker',async()=>{
 const {FactoryPlayback}=await import('../public/factory-playback.mjs');const p=new FactoryPlayback();
 p.update({runId:'team',status:'running',events:[{type:'node-started',nodeId:'back'},{type:'team',kind:'task-request',from:'back',to:'router',transport:'drone'},{type:'team',kind:'task',from:'router',to:'front',transport:'drone'}]});
 p.advance(650);p.advance(650);assert.equal(p.transfers[0].source,'back');assert.equal(p.transfers[0].target,'router');assert.equal(p.nodes.back,'running');assert.equal(p.active,'back');
 p.advance(1600);assert.equal(p.transfers[0].source,'router');assert.equal(p.transfers[0].target,'front');assert.equal(p.transfers[0].transport,'drone');
});


test('extra input replays its selected analysis route as packages even after the initial run',async()=>{
 const {FactoryPlayback}=await load(),p=new FactoryPlayback();
 const events=[started('s'),completed('s')];
 p.update({runId:'extra',events,status:'running'});p.advance(0);p.advance(650);
 events.push({type:'input-routing',messageId:'m1',event:started('s')},
  {type:'input-routing',messageId:'m1',event:completed('s','analysis')},
  {type:'input-routing',messageId:'m1',event:started('analysis')},
  {type:'input-routing',messageId:'m1',event:completed('analysis','b','backend')});
 p.update({runId:'extra',events,status:'running'});p.advance(0);p.advance(650);
 assert.equal(p.transfers[0].target,'analysis');p.advance(550);p.advance(650);
 assert.equal(p.transfers[0].target,'b');assert.equal(p.transfers[0].port,'backend');
 p.update({runId:'extra',events,status:'running'});assert.equal(p.queue.length,0);
});

test('dynamic network replays actual colleague messages and delegated tasks',async()=>{
 const {FactoryPlayback}=await load(),p=new FactoryPlayback();p.networkMode=true;
 p.update({runId:'network',status:'running',events:[
  {type:'node-started',nodeId:'backend'},
  {type:'team',kind:'message',from:'backend',to:'frontend',text:'Use /api/items'},
  {type:'team',kind:'task-request',from:'backend',to:'__fjord_team_router'},
  {type:'team',kind:'task',from:'__fjord_team_router',to:'frontend'},
  {type:'node-started',nodeId:'frontend'}
 ]});
 p.advance(0);assert.equal(p.nodes.backend,'running');
 p.advance(200);assert.deepEqual(p.transfers.map(t=>[t.source,t.target,t.transport]),[['backend','frontend','signal']]);
 p.advance(760);assert.equal(p.transfers[0].target,'__fjord_team_router');
 p.advance(1050);assert.equal(p.transfers[0].target,'frontend');
 p.advance(1050);assert.equal(p.nodes.frontend,'running');
});

test('review escalation is displayed without inventing an extra agent transfer',async()=>{
 const {FactoryPlayback}=await load(),p=new FactoryPlayback();p.networkMode=true;
 p.update({runId:'review-upgrade',status:'running',events:[
  {type:'node-started',nodeId:'review'},
  {type:'review-escalated',nodeId:'review',model:'astra',reason:'verified failing test'},
  {type:'review',nodeId:'review',approved:true}
 ]});
 p.advance(0);assert.equal(p.active,'review');
 p.advance(200);assert.equal(p.escalations.review,undefined,'approval clears escalation');
 assert.deepEqual(p.transfers,[]);
 assert.equal(p.reviews.review,'approved');
});
