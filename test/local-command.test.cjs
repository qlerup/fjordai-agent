const {test}=require('node:test'),assert=require('node:assert/strict'),os=require('node:os');
const {runLocalCommand}=require('../extension/local-command.cjs');
test('local commands run in the requested folder and return output and exit status',async()=>{
 const r=await runLocalCommand({command:process.platform==='win32'?"Write-Output (Get-Location).Path; exit 7":"pwd; exit 7",cwd:os.tmpdir()});
 assert.equal(r.exitCode,7);assert.ok(r.output.toLowerCase().includes(os.tmpdir().toLowerCase()));assert.equal(r.host,'vscode');
});
test('local command bounds, cancellation and timeout are enforced',async()=>{
 assert.throws(()=>runLocalCommand({command:'',cwd:os.tmpdir()}));
 assert.throws(()=>runLocalCommand({command:'echo x',cwd:os.tmpdir(),timeoutMs:999}));
 const c=new AbortController();c.abort();assert.throws(()=>runLocalCommand({command:'echo x',cwd:os.tmpdir(),signal:c.signal}));
 const r=await runLocalCommand({command:process.platform==='win32'?'Start-Sleep -Seconds 20':'sleep 20',cwd:os.tmpdir(),timeoutMs:1000});assert.equal(r.stopped,true);
});
