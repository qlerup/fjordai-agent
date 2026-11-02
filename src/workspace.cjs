const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');
const mb=(name,fallback)=>{const n=Number(process.env[name]||fallback);if(!Number.isInteger(n)||n<1||n>512)throw new Error('Ugyldig filgrænse: '+name);return n*1024*1024;};
const MAX_BYTES=mb('FJORDAGENT_MAX_PATCH_MB',64),MAX_FILE_BYTES=mb('FJORDAGENT_MAX_FILE_MB',32),MAX_WORKSPACE_BYTES=mb('FJORDAGENT_MAX_WORKSPACE_MB',128),MAX_FILES=300;
const hash=text=>createHash('sha256').update(text).digest('hex');
function safePath(name){
  if(typeof name!=='string'||!name||name.length>240||name.startsWith('/')||name.includes('\\')||name.includes(':')||/[\x00-\x1f]/.test(name))return false;
  const parts=name.split('/');
  return !parts.some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git'||['.ssh','.aws','.codex','.config','node_modules','__pycache__','.venv','venv','dist','build'].includes(p.toLowerCase())||/^\.env(?:\.|$)/i.test(p)||/\.(pem|key|p12|pfx|keystore)$/i.test(p)||/^(credentials|id_rsa|id_ed25519|auth\.json|secrets?\..*)$/i.test(p));
}
function validateSnapshot(files,allowEmpty=false){
  if(!Array.isArray(files)||(!allowEmpty&&files.length===0)||files.length>MAX_FILES)throw new Error(`Vælg 1–${MAX_FILES} tekstfiler`);
  let bytes=0;const seen=new Set();
  return files.map(f=>{if(!safePath(f.path)||typeof f.content!=='string'||f.content.includes('\0')||seen.has(f.path))throw new Error('Ugyldig eller følsom filsti i projektet');seen.add(f.path);bytes+=Buffer.byteLength(f.content);if(bytes>2*1024*1024)throw new Error('Projektudvalget må højst fylde 2 MB');return{path:f.path,content:f.content,hash:hash(f.content)};});
}
function writeSnapshot(dir,files){fs.mkdirSync(dir,{recursive:true});for(const f of files){const dest=path.join(dir,f.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,f.content,{flag:'wx'});}}
function collectChanges(dir,files){
  const originals=new Map(files.map(f=>[f.path,f]));const found=new Set(),changes=[];let bytes=0,count=0;
  function walk(folder,prefix=''){
    for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
      const rel=prefix+entry.name;if(!safePath(rel))continue;
      if(entry.isSymbolicLink())throw new Error('Agenten oprettede et symlink. Automatisk overførsel blev stoppet.');
      if(entry.isDirectory()){walk(path.join(folder,entry.name),rel+'/');continue;}
      if(!entry.isFile())continue;
      const file=path.join(folder,entry.name);const stat=fs.lstatSync(file);if(stat.nlink>1)throw new Error('Hardlinks kan ikke overføres');
      // Inspect a bounded header before the size limit: new binaries (including
      // large native crash dumps) are not source patches and must not abort review.
      const handle=fs.openSync(file,'r');let header;try{const buffer=Buffer.alloc(8192);header=buffer.subarray(0,fs.readSync(handle,buffer,0,buffer.length,0));}finally{fs.closeSync(handle);}
      let binary=header.includes(0);if(!binary)try{new TextDecoder('utf-8',{fatal:true}).decode(header,{stream:true});}catch{binary=true;}
      if(binary){if(originals.has(rel))throw new Error('En eksisterende tekstfil blev binær: '+rel);continue;}
      if(stat.size>MAX_FILE_BYTES)throw new Error('Resultatfilen '+rel+' overskrider den konfigurerede filgrænse på '+MAX_FILE_BYTES/1024/1024+' MB');
      const data=fs.readFileSync(file);if(data.includes(0)){if(originals.has(rel))throw new Error('En eksisterende tekstfil blev binær; overførsel er stoppet');continue;}
      const content=new TextDecoder('utf-8',{fatal:true}).decode(data);found.add(rel);const old=originals.get(rel);
      if(!old||old.content!==content){bytes+=data.length;if(bytes>MAX_BYTES||++count>MAX_FILES)throw new Error('Resultatet overskrider prototypens filgrænse');changes.push({path:rel,kind:old?'modify':'create',baseHash:old?.hash||null,content});}
    }
  }
  walk(dir);for(const [name,old]of originals)if(!found.has(name))changes.push({path:name,kind:'delete',baseHash:old.hash});return changes;
}
module.exports={safePath,validateSnapshot,writeSnapshot,collectChanges,hash,MAX_BYTES,MAX_FILE_BYTES,MAX_WORKSPACE_BYTES,MAX_FILES};
