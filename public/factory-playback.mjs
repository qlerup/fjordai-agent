// Visual time is independent of server time: even an entire run in one poll
// must visit each machine and carry its output all the way to the next one.
export class FactoryPlayback {
 constructor(){this.reset();}
 reset(id){this.id=id;this.seen=0;this.queue=[];this.nodes={};this.reviews={};this.running=new Set();this.age=0;this.transfers=[];this.status='idle';}
 get active(){return [...this.running].at(-1)||null;}
 update({runId,events=[],status='idle'}){
  if(this.id!==runId||events.length<this.seen)this.reset(runId);
  const incoming=events.slice(this.seen).map(e=>e.type==='input-routing'?{...e.event,inputMessageId:e.messageId}:e);
  this.queue.push(...incoming.filter(e=>e.type==='node-started'||e.type==='node-completed'||e.type==='review'||e.type==='team'&&e.transport==='drone'));
  this.seen=events.length;this.status=status;
 }
 advance(ms){
  this.age+=ms;
  if(this.transfers.length){
   for(const transfer of this.transfers)transfer.progress=Math.min(1,transfer.progress+ms/(transfer.transport==='drone'?1600:550));
   if(this.transfers.some(t=>t.progress<1))return;
   this.transfers=[];
  }
  while(this.queue.length){
   const e=this.queue[0];
   if(e.type==='team'){
    if(this.age<650)return;this.queue.shift();
    this.transfers=[{source:e.from,target:e.to,port:'team-task',transport:'drone',progress:0}];return;
   }
   if(e.type==='review'){if(this.age<650)return;this.reviews[e.nodeId]=e.approved?'approved':'changes';this.queue.shift();continue;}
   if(e.type==='node-started'){
    this.nodes[e.nodeId]='running';delete this.reviews[e.nodeId];this.running.add(e.nodeId);this.age=0;this.queue.shift();
   }else{
    if(this.age<650)return;
    this.nodes[e.nodeId]='completed';this.running.delete(e.nodeId);this.queue.shift();
    this.transfers=(e.edges||[]).map(edge=>({source:e.nodeId,...edge,progress:0}));
    if(this.transfers.length)return;
   }
  }
  if(this.status!=='running'&&!this.queue.length){for(const id of this.running)this.nodes[id]=this.status==='failed'?'failed':'interrupted';this.running.clear();}
 }
 get pending(){return !!(this.queue.length||this.transfers.length||this.active);}
}
