const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {EventEmitter}=require('node:events');
const {validateAttachments,writeAttachments}=require('../src/attachments.cjs');const {createApp}=require('../src/server.cjs');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const text={name:'notes.txt',data:Buffer.from('Use a blue header').toString('base64')};
test('attachments validate sizes, filenames, base64 and image contents and keep arbitrary binary files intact',t=>{
 for(const name of ['../escape','a/b','x\\y','.env','credentials','auth.json','private.key'])assert.throws(()=>validateAttachments([{...text,name}]));
 for(const data of ['a===','YQ=','!!!!',''])assert.throws(()=>validateAttachments([{name:'file.txt',data}]));
 assert.throws(()=>validateAttachments(Array(9).fill(text)));assert.throws(()=>validateAttachments([{name:'fake.png',data:text.data}]));
 assert.throws(()=>validateAttachments([{name:'huge.bin',data:Buffer.alloc(10*1024*1024+1).toString('base64')}]));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-attachments-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const binary=Buffer.from([0,255,3,1]);const saved=writeAttachments(dir,validateAttachments([text,{...text},{name:'shot.png',data:png},{name:'file.bin',data:binary.toString('base64')}]));
 assert.equal(saved[0].text,'Use a blue header');assert.notEqual(saved[0].path,saved[1].path);assert.equal(saved[2].image,true);assert.deepEqual(fs.readFileSync(saved[3].path),binary);
});
test('API delivers images and text to actual turns without including uploads in workspace changes',async t=>{
 const turns=[];class Fake extends EventEmitter{async rpc(method,p){if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='thread/start')return {thread:{id:'t'}};if(method==='turn/start'){turns.push(p);setImmediate(()=>{this.emit('message',{method:'item/completed',params:{threadId:'t',item:{type:'agentMessage',text:'Read both attachments'}}});this.emit('message',{method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});});return {turn:{id:'turn'}};}return {};}close(){}}
 const fake=new Fake();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-upload-api-')),app=createApp({dataDir:dir,codexFactory:()=>fake});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,{token}=await require('./auth-helper.cjs').setup(base);const api=(route,method='GET',body)=>fetch(base+'/api/'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const project=await(await api('projects','POST',{name:'Uploads'})).json();
 assert.equal((await api('runs','POST',{projectId:project.id,prompt:'Read',files:[],bridge:true,attachments:[{...text,name:'.env'}]})).status,400);
 const response=await api('runs','POST',{projectId:project.id,prompt:'Read',files:[],bridge:true,attachments:[text,{name:'screen.png',data:png}]});assert.equal(response.status,202);const run=await response.json();
 let result;for(let i=0;i<100;i++){result=await(await api('runs/'+run.id)).json();if(result.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(result.status,'completed',result.error);assert.deepEqual(result.changes,[]);assert.equal(result.attachments.length,2);assert.equal(result.attachments[0].data,undefined);
 assert.ok(turns[0].input.some(i=>i.type==='text'&&i.text.includes('Use a blue header')));const image=turns[0].input.find(i=>i.type==='localImage');assert.ok(image);assert.equal(fs.readFileSync(image.path).toString('base64'),png);
});
