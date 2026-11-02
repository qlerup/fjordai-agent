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


test('large binary crash dumps are ignored before source limits, without reading the entire dump',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-core-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const files=validateSnapshot([{path:'app.js',content:'old'}]);writeSnapshot(dir,files);fs.writeFileSync(path.join(dir,'app.js'),'fixed');const handle=fs.openSync(path.join(dir,'core.1552'),'w');try{fs.writeSync(handle,Buffer.from([0x7f,0x45,0x4c,0x46,0,0,0,0]));fs.ftruncateSync(handle,280272896);}finally{fs.closeSync(handle);}assert.deepEqual(collectChanges(dir,files).map(c=>c.path),['app.js']);
});
test('large text patches and binary replacement of an original file still fail with the file path',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-source-limits-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'large.txt'),'x'.repeat(require('../src/workspace.cjs').MAX_FILE_BYTES+1));assert.throws(()=>collectChanges(dir,[]),/large.txt.*filgrænse/);fs.unlinkSync(path.join(dir,'large.txt'));const files=validateSnapshot([{path:'app.js',content:'original'}]);fs.writeFileSync(path.join(dir,'app.js'),Buffer.alloc(3*1024*1024));assert.throws(()=>collectChanges(dir,files),/tekstfil blev binær.*app.js/);
});

test('source files larger than the old 2 MB prototype limit remain editable',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-large-source-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const content='x'.repeat(3*1024*1024);fs.writeFileSync(path.join(dir,'large.js'),content);assert.equal(collectChanges(dir,[])[0].content.length,content.length);
});
