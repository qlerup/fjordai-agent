const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Sessions}=require('../src/sessions.cjs');
test('persisted sessions store digests, expire without extending on restart, and revoke independently',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjordagent-sessions-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let time=1000;const options={now:()=>time};let sessions=new Sessions(dir,options);
 const first=sessions.issue(),second=sessions.issue(),file=path.join(dir,'sessions.json');
 assert.ok(sessions.valid(first));assert.ok(!fs.readFileSync(file,'utf8').includes(first));
 if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);
 time+=6*3600000;sessions=new Sessions(dir,options);assert.ok(sessions.valid(first));
 sessions.revoke(first);sessions=new Sessions(dir,options);assert.equal(sessions.valid(first),false);assert.ok(sessions.valid(second));
 assert.equal(sessions.valid(undefined),false);assert.equal(sessions.valid(second+'x'),false);assert.equal(sessions.valid('0'.repeat(64)),false);
 time=1000+12*3600000;sessions=new Sessions(dir,options);assert.equal(sessions.valid(second),false);
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),[]);
});
