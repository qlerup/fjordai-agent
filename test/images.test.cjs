const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {saveImage}=require('../src/images.cjs'),{createApp}=require('../src/server.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
test('generated images are copied from the tool directory and reject unrelated files, symlinks and non-images',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-images-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const root=path.join(dir,'generated');fs.mkdirSync(root);const source=path.join(root,'bird.png');fs.writeFileSync(source,png);
 const options={root,directory:path.join(dir,'out'),runId:'run',name:'Artist'},image=saveImage({savedPath:source},options);assert.deepEqual(fs.readFileSync(path.join(options.directory,image.id+image.ext)),png);assert.equal(image.mime,'image/png');assert.ok(!JSON.stringify(image).includes(source));
 const secret=path.join(dir,'secret.png');fs.writeFileSync(secret,png);assert.throws(()=>saveImage({savedPath:secret},options),/uden for/);
 const outside=path.join(dir,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'secret.png'),png);fs.symlinkSync(outside,path.join(root,'link'),process.platform==='win32'?'junction':'dir');assert.throws(()=>saveImage({savedPath:path.join(root,'link','secret.png')},options),/symlinks/);
 const fake=path.join(root,'fake.png');fs.writeFileSync(fake,'Not an image');assert.throws(()=>saveImage({savedPath:fake},options),/billedfil/);
 fs.linkSync(source,path.join(root,'linked.png'));assert.throws(()=>saveImage({savedPath:source},options),/ugyldig/);
});
test('native imageGeneration results are persisted, authenticated, replayed and survive restart',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-image-api-')),root=path.join(dir,'codex','generated_images');fs.mkdirSync(root,{recursive:true});const source=path.join(root,'bird.png');fs.writeFileSync(source,png);
 class Fake extends EventEmitter{async rpc(method,p){if(method==='account/read')return{account:{type:'chatgpt'}};if(method==='thread/start')return{thread:{id:'t'}};if(method==='turn/start'){setImmediate(()=>{for(const method of ['item/started','item/completed'])this.emit('message',{method,params:{threadId:'t',item:{type:'contextCompaction'}}});this.emit('message',{method:'item/completed',params:{threadId:'t',item:{type:'imageGeneration',id:'image-call',savedPath:source,result:'base64 omitted',status:'completed'}}});this.emit('message',{method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});});return{turn:{id:'turn'}};}return{};}close(){}}
 let app=createApp({dataDir:dir,codexFactory:()=>new Fake()});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>{app.close();fs.rmSync(dir,{recursive:true,force:true});});let base='http://127.0.0.1:'+app.server.address().port;
 const {token}=await require('./auth-helper.cjs').setup(base),api=(route,method='GET',body)=>fetch(base+'/api/'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const project=await(await api('projects','POST',{name:'Image output'})).json(),run=await(await api('runs','POST',{projectId:project.id,prompt:'Create a bird'})).json();let result;
 for(let i=0;i<100;i++){result=await(await api('runs/'+run.id)).json();if(result.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(result.status,'completed',result.error);assert.ok(result.images.length);assert.ok(result.events.some(e=>e.type==='image'));assert.ok(result.events.some(e=>e.type==='compaction'&&e.state==='completed'));assert.ok(result.answers.every(a=>a.images.length));
 const url=result.images[0].url;assert.equal((await fetch(base+url)).status,401);assert.deepEqual(Buffer.from(await(await fetch(base+url,{headers:{Authorization:'Bearer '+token}})).arrayBuffer()),png);
 app.close();await new Promise(r=>app.server.close(r));app=createApp({dataDir:dir,codexFactory:()=>new Fake()});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
 assert.equal((await fetch(base+url,{headers:{Authorization:'Bearer '+token}})).status,200);assert.equal((await api('runs/'+run.id+'/images/not-present')).status,404);
});
