const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
function imageType(bytes){
 if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return{ext:'.png',mime:'image/png'};
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return{ext:'.jpg',mime:'image/jpeg'};
 if(/^GIF8[79]a/.test(bytes.subarray(0,6).toString()))return{ext:'.gif',mime:'image/gif'};
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return{ext:'.webp',mime:'image/webp'};
 throw new Error('Billedværktøjet returnerede ikke en understøttet billedfil');
}
function saveImage(item,{root,directory,runId,name}){
 const source=path.resolve(item.savedPath||''),base=path.resolve(root),relative=path.relative(base,source);
 if(!item.savedPath||!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Billedfilen ligger uden for billedværktøjets mappe');
 let current=base;
 for(const part of ['',...relative.split(path.sep)]){if(part)current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw new Error('Billedfilen må ikke bruge symlinks');}
 const stat=fs.lstatSync(source);
 if(!stat.isFile()||stat.nlink!==1||stat.size>20*1024*1024)throw new Error('Billedfilen er ugyldig eller større end 20 MB');
 const bytes=fs.readFileSync(source),type=imageType(bytes),id=randomUUID();fs.mkdirSync(directory,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(directory,id+type.ext),bytes,{flag:'wx',mode:0o600});
 return{id,name,mime:type.mime,ext:type.ext,size:bytes.length,url:'/api/runs/'+runId+'/images/'+id};
}
module.exports={saveImage,imageType};
