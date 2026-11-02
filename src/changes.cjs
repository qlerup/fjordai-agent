const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
function changeReport(changes,originals){
 const before=new Map(originals.map(f=>[f.path,f.content]));let dir;
 try{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'fjord-change-report-'));let budget=500000;
  const files=changes.map(c=>{
   const left=path.join(dir,'before'),right=path.join(dir,'after');fs.writeFileSync(left,before.get(c.path)||'');fs.writeFileSync(right,c.content||'');let diff='';
   try{diff=execFileSync('git',['diff','--no-index','--no-ext-diff','--no-textconv','--no-color','--text','--unified=3','--',left,right],{encoding:'utf8',maxBuffer:12*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']});}
   catch(e){if(e.status!==1||typeof e.stdout!=='string')throw e;diff=e.stdout;}
   const hunks=diff.indexOf('@@');let added=0,removed=0;for(const line of (hunks<0?'':diff.slice(hunks)).split('\n')){if(line.startsWith('+'))added++;if(line.startsWith('-'))removed++;}
   const patch=hunks<0?'':`--- ${c.kind==='create'?'/dev/null':'a/'+c.path}\n+++ ${c.kind==='delete'?'/dev/null':'b/'+c.path}\n`+diff.slice(hunks);
   const limit=Math.min(120000,Math.max(0,budget));budget-=Math.min(limit,patch.length);
   return{path:c.path,kind:c.kind,added,removed,diff:patch.slice(0,limit),truncated:patch.length>limit};
  });
  return{files,added:files.reduce((n,f)=>n+f.added,0),removed:files.reduce((n,f)=>n+f.removed,0)};
 }catch{return{files:changes.map(c=>({path:c.path,kind:c.kind})),error:'Linjetal og diff kunne ikke beregnes. Fillisten viser stadig de registrerede ændringer.'};}
 finally{if(dir)fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={changeReport};
