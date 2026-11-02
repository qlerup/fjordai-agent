const {spawn}=require('node:child_process');
function runLocalCommand({command,cwd,timeoutMs=120000,signal}){
 if(typeof command!=='string'||!command.trim()||command.length>8000)throw Error('Kommandoen skal indeholde 1-8000 tegn');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw Error('Tidsgr?nsen skal v?re 1000-120000 ms');
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const windows=process.platform==='win32';
  const child=spawn(windows?'powershell.exe':'/bin/sh',windows?['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')]:['-c',command],{cwd,windowsHide:true,detached:!windows,stdio:['ignore','pipe','pipe']});
  let output='',bytes=0,truncated=false,stopped=false;
  const append=data=>{const remaining=65536-bytes;if(data.length>remaining)truncated=true;if(remaining>0){output+=data.subarray(0,remaining).toString('utf8');bytes+=Math.min(remaining,data.length);}};
  const stop=()=>{stopped=true;if(windows)spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>child.kill());else{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}};
  const timer=setTimeout(stop,timeoutMs);signal?.addEventListener('abort',stop,{once:true});
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};
  child.stdout.on('data',append);child.stderr.on('data',append);
  child.on('error',e=>{cleanup();reject(e);});
  child.on('close',(exitCode,exitSignal)=>{cleanup();resolve({exitCode,signal:exitSignal,output,truncated,stopped,cwd,host:'vscode'});});
 });
}
module.exports={runLocalCommand};
