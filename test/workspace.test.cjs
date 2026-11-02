const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {safePath,validateSnapshot,writeSnapshot,collectChanges,hash}=require('../src/workspace.cjs');
test('rejects traversal, credentials, duplicates and oversized snapshots',()=>{
  for(const p of ['../x','/etc/passwd','src/../../x','src\\x','x//y','.git/config','.env','.env.local','a/id_rsa','a/secrets.json','x.pem','C:/x','node_modules/a'])assert.equal(safePath(p),false,p);
  assert.equal(safePath('src/app.js'),true);assert.throws(()=>validateSnapshot([{path:'a',content:'x'},{path:'a',content:'y'}]));assert.throws(()=>validateSnapshot([{path:'a',content:'x'.repeat(3*1024*1024)}]));
});
test('round trip detects created modified and deleted files, rejects symlinks',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjordagent-files-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const files=validateSnapshot([{path:'src/a.js',content:'old'},{path:'delete.txt',content:'remove'},{path:'keep.txt',content:'keep'}]);writeSnapshot(dir,files);
  fs.writeFileSync(path.join(dir,'src/a.js'),'new');fs.unlinkSync(path.join(dir,'delete.txt'));fs.writeFileSync(path.join(dir,'new.txt'),'added');
  const changes=collectChanges(dir,files);assert.equal(changes.length,3);assert.deepEqual(changes.find(c=>c.path==='src/a.js'),{path:'src/a.js',kind:'modify',content:'new',baseHash:hash('old')});assert.equal(changes.find(c=>c.path==='delete.txt').kind,'delete');
  fs.symlinkSync(process.platform==='win32'?path.join(dir,'src'):'/etc/passwd',path.join(dir,'link'),process.platform==='win32'?'junction':undefined);assert.throws(()=>collectChanges(dir,files),/symlink/);
});
