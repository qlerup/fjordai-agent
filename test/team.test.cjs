const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createTeam}=require('../src/team.cjs'),{runGraph}=require('../src/graph.cjs');
const nodes=[{id:'s',type:'start',name:'Start'},{id:'r',type:'router',name:'Fordeler',instructions:'Choose workers',access:'read'},{id:'front',type:'agent',name:'Frontend',instructions:'FRONT',access:'write'},{id:'back',type:'agent',name:'Backend',instructions:'BACK',access:'read'},{id:'merge',type:'merge',name:'Saml'},{id:'review',type:'review',name:'Reviewer',instructions:'Check integration'},{id:'end',type:'end',name:'Svar'}];
const graph={nodes,edges:[['s','r'],['r','front'],['r','back'],['front','merge'],['back','merge'],['merge','review'],['review','end']].map(([source,target])=>({source,target,port:'out'}))};
function rpc(channel,name,args={}){const env=channel.config.fjordagent_team.env;return fetch(env.FJORDAGENT_TEAM_URL,{method:'POST',headers:{Authorization:'Bearer '+env.FJORDAGENT_TEAM_TOKEN},body:JSON.stringify({name,arguments:args})});}

test('team channels isolate runs, validate recipients, route tasks through their source and expire',async t=>{
 const events=[],team=createTeam({nodes,prompt:'Build',emit:e=>events.push(e),route:async r=>{assert.equal(r.source,'r');return{target:'front',reason:'Frontend owns buttons'};}});t.after(()=>team.close());
 team.register('r',[{target:'front'},{target:'back'}]);const back=await team.connect('back'),front=await team.connect('front');
 assert.equal(await team.connect('end'),null);
 assert.equal((await rpc(back,'team_ask',{target:'end',question:'leak'})).status,400);
 assert.equal((await rpc(back,'team_ask',{target:'back',question:'self'})).status,400);
 assert.equal((await rpc(back,'team_publish',{message:''})).status,400);
 assert.equal((await rpc(back,'team_message',{to:'end',text:'outside'})).status,400);
 assert.equal((await rpc(back,'team_message',{to:'front',text:'API is ready'})).status,200);
 assert.equal(team.context('front')[0].messages.at(-1).text,'API is ready');
 assert.equal(events.at(-1).kind,'message');
 const task=await(await rpc(back,'team_request',{task:'Add a Save button'})).json();assert.equal(task.target,'front');assert.equal(task.status,'pending');
 const duplicate=await(await rpc(back,'team_request',{task:'Add a Save button'})).json();assert.equal(duplicate.taskId,task.taskId);
 const pending=team.takeTasks('front');assert.equal(pending.length,1);team.finishTasks(pending);
 const shared=await(await rpc(front,'team_context')).json();assert.equal(shared.teams[0].tasks[0].status,'completed');
 assert.deepEqual(events.filter(e=>e.kind==='task-request'||e.kind==='task').map(e=>[e.kind,e.from,e.to]),[['task-request','back','r'],['task','r','front']]);
 const other=createTeam({nodes,prompt:'Other run',emit:()=>{},consult:async()=>'',route:async()=>({})});t.after(()=>other.close());other.register('r',[{target:'front'},{target:'back'}]);assert.equal(other.context('front')[0].messages.length,0);
 front.close();assert.equal((await rpc(front,'team_context')).status,401);back.close();
});

class TeamCodex extends EventEmitter{
 constructor({failTask=false,invalidRoute=false}={}){super();this.threads=new Map();this.front=0;this.next=0;this.failTask=failTask;this.invalidRoute=invalidRoute;this.calls=[];}
 async rpc(method,p){this.calls.push({method,p});if(method==='thread/start'){const id='t'+this.next++;this.threads.set(id,p);return{thread:{id}};}if(method==='turn/start'){setImmediate(()=>this.work(p).catch(e=>this.finish(p,'',e.message)));return{turn:{id:'turn'}};}return{};}
 finish(p,text,error){this.emit('message',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',text}}});this.emit('message',{method:'turn/completed',params:{threadId:p.threadId,turn:{status:error?'failed':'completed',error:error?{message:error}:undefined}}});}
 async work(p){const thread=this.threads.get(p.threadId),instructions=thread.developerInstructions;let text;
  if(p.outputSchema?.properties.targets)text=JSON.stringify({targets:['front','back'],reason:'Both needed'});
  else if(p.outputSchema?.properties.target)text=JSON.stringify({target:this.invalidRoute?'end':'front',reason:'Button belongs to frontend'});
  else if(p.outputSchema?.properties.approved){assert.match(p.input[0].text,/front v2/);assert.match(p.input[0].text,/POST \/api\/save/);text=JSON.stringify({approved:true,summary:'Integrated',corrections:[]});}
  else if(instructions.includes('Du rådgiver nu')){assert.equal(thread.sandbox,'read-only');assert.equal(thread.config['features.shell_tool'],false);assert.equal(thread.config.mcp_servers?.fjordagent_team,undefined);text='Use POST /api/save';}
  else if(instructions.includes('FRONT')){this.front++;if(this.front===2){assert.match(p.input[0].text,/Add a Save button/);if(this.failTask)throw Error('Button repair failed');}text='front v'+this.front;}
  else{
   const channel={config:{fjordagent_team:thread.config.mcp_servers.fjordagent_team}};
   const response=await rpc(channel,'team_request',{task:'Add a Save button'});const body=await response.json();if(body.error)throw Error(body.error);assert.equal(body.status,'pending');text='Backend implements POST /api/save';
  }
  this.finish(p,text);
 }
}
test('backend requests work through distributor and reruns completed frontend before merge/review',async()=>{
 const c=new TeamCodex(),events=[];const answers=await runGraph({workflow:{graph},codex:c,cwd:'/tmp',prompt:'Build page',emit:e=>events.push(e)});
 assert.equal(c.front,2);assert.equal(answers.find(a=>a.nodeId==='front').text,'front v2');
 const merge=events.find(e=>e.type==='node-completed'&&e.nodeId==='merge');assert.match(merge.result,/front v2/);
 assert.ok(events.some(e=>e.kind==='task-completed'));assert.equal(events.filter(e=>e.type==='team'&&e.kind==='task-request').length,1);
 const assignment=events.findIndex(e=>e.kind==='task'),done=events.findIndex(e=>e.kind==='task-completed'),review=events.findIndex(e=>e.type==='review');assert.ok(assignment<done&&done<review);
 assert.ok(c.calls.filter(c=>c.method==='thread/start'&&c.p.developerInstructions.includes('BACK')).every(c=>c.p.sandbox==='read-only'));
});
test('failed team work or invalid distributor target prevents review and downstream completion',async()=>{
 for(const options of [{failTask:true},{invalidRoute:true}]){const c=new TeamCodex(options),events=[];await assert.rejects(runGraph({workflow:{graph},codex:c,cwd:'/tmp',prompt:'Build page',emit:e=>events.push(e)}),/Button repair failed|ugyldig teammodtager/);assert.ok(!events.some(e=>e.nodeId==='end'||e.type==='review'));}
});
test('only actually selected receivers become teammates',async()=>{
 const team=createTeam({nodes,prompt:'One branch',emit:()=>{}});team.register('r',[{target:'front'}]);assert.equal(await team.connect('front'),null);team.close();
});

test('extra work is bounded and a completed request is not queued twice',async t=>{
 let routed=0;const team=createTeam({nodes,prompt:'Build',emit:()=>{},route:async()=>{routed++;return{target:'front',reason:'UI task'};}});t.after(()=>team.close());team.register('r',[{target:'front'},{target:'back'}]);const channel=await team.connect('back');
 for(let i=0;i<8;i++){assert.equal((await rpc(channel,'team_request',{task:'Button '+i})).status,200);team.finishTasks(team.takeTasks('front'));}
 assert.equal((await rpc(channel,'team_request',{task:'Button 9'})).status,400);assert.equal(routed,8);
});
