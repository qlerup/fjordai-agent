const {EventEmitter}=require('node:events');
function graph(){return{nodes:[{id:'s',type:'start',name:'Start'},{id:'analysis',type:'analysis',name:'Inputanalyse',instructions:'Analyze only'},{id:'router',type:'router',name:'Fordeler',instructions:'Route only',routingMode:'analysis',routeMode:'multiple',routes:[{id:'a',name:'Frontend',rule:'Frontend work'},{id:'b',name:'Backend',rule:'Backend work'}]},{id:'a',type:'agent',name:'Frontend',instructions:'WORKER_A',access:'write'},{id:'b',type:'agent',name:'Backend',instructions:'WORKER_B',access:'read'},{id:'merge',type:'merge',name:'Saml'},{id:'review',type:'review',name:'Reviewer',instructions:'Review results'},{id:'end',type:'end',name:'Svar'}],edges:[['s','analysis'],['analysis','router'],['router','a','a'],['router','b','b'],['a','merge'],['b','merge'],['merge','review'],['review','end']].map(([source,target,port='out'])=>({source,target,port}))};}
class LiveCodex extends EventEmitter{
 constructor(){super();this.threads=new Map();this.workers={a:[],b:[]};this.steers=[];this.analysis=[];this.reviews=[];this.reviewTurns=[];this.interrupted=[];}
 async rpc(method,p){
  if(method==='account/read')return{account:{type:'chatgpt'}};
  if(method==='model/list')return{data:[]};
  if(method==='thread/start'){const id='t'+this.threads.size;this.threads.set(id,p);return{thread:{id}};}
  if(method==='turn/start'){
   const thread=this.threads.get(p.threadId);
   if(p.outputSchema){
    const input=JSON.parse(p.input[0].text.split('\n\nTidligere')[0]);let result;
    if(p.outputSchema.properties.intent){this.analysis.push(input.task);const ports=input.task.includes('only-a')?['a']:input.task.includes('only-b')?['b']:['a','b'];result={summary:'Selected '+ports.join(', '),intent:'update',decisions:[{routerId:'router',ports}]};}
    else{this.reviews.push(input);this.reviewTurns.push(p);result={approved:true,summary:'Verified: '+input.candidates.map(c=>c.result).join(' / '),corrections:[]};if(this.holdReview)return{turn:{id:'turn-'+p.threadId}};}
    setImmediate(()=>this.finish(p,JSON.stringify(result)));
   }else{const key=thread.developerInstructions.includes('WORKER_A')?'a':'b';this.workers[key].push(p);}
   return{turn:{id:'turn-'+p.threadId}};
  }
  if(method==='turn/steer'){this.steers.push(p);return{turnId:p.expectedTurnId};}
  if(method==='turn/interrupt'){this.interrupted.push(p.threadId);return{};}
  if(method==='thread/archive')await this.onArchive?.(p);
  return{};
 }
 finish(p,text){this.emit('message',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',phase:'final_answer',text}}});this.emit('message',{method:'turn/completed',params:{threadId:p.threadId,turn:{status:'completed'}}});}
 close(){}
}
module.exports={LiveCodex,graph};
