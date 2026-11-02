const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');fs.rmSync(path.join(root,'extension/runtime'),{recursive:true,force:true});fs.mkdirSync(path.join(root,'extension/runtime'),{recursive:true});fs.copyFileSync(path.join(root,'src/workspace.cjs'),path.join(root,'extension/runtime/workspace.cjs'));fs.copyFileSync(path.join(root,'LICENSE'),path.join(root,'extension/LICENSE'));
const args=['--yes','@vscode/vsce@3.6.2','package','--no-dependencies','--allow-missing-repository','--out',path.join(root,'public/fjordagent.vsix')];
for(const name of ['change-view.js','change-view.css'])fs.copyFileSync(path.join(root,'public',name),path.join(root,'extension/runtime',name));
// Run npm through Node on Windows; .cmd files cannot be spawned without a shell.
if(process.platform==='win32'){
 const cli=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 execFileSync(process.execPath,[cli,'exec','--yes','--package=@vscode/vsce@3.6.2','--','vsce',...args.slice(2)],{cwd:path.join(root,'extension'),stdio:'inherit'});
}else execFileSync('npx',args,{cwd:path.join(root,'extension'),stdio:'inherit'});
