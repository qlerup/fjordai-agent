const fs=require('node:fs');
const path=require('node:path');
const {safePath}=require('./workspace.cjs');
const MAX_ATTACHMENT_BYTES=10*1024*1024,MAX_ATTACHMENTS=8;
function validateAttachments(items=[]){
 if(!Array.isArray(items)||items.length>MAX_ATTACHMENTS)throw new Error('Vedhæft højst 8 filer (10 MB i alt)');
 let total=0;
 return items.map(item=>{
  if(!item||typeof item.name!=='string'||!safePath(item.name)||item.name.includes('/')||typeof item.data!=='string'||!item.data.length||item.data.length>Math.ceil(MAX_ATTACHMENT_BYTES/3)*4||item.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(item.data)||! /^[A-Za-z0-9+/]*={0,2}$/.test(item.data))throw new Error('Ugyldig eller følsom vedhæftet fil');
  const bytes=Buffer.from(item.data,'base64');if(bytes.toString('base64')!==item.data)throw new Error('Ugyldig base64 i vedhæftet fil');total+=bytes.length;
  if(total>MAX_ATTACHMENT_BYTES)throw new Error('Vedhæftninger må højst fylde 10 MB i alt');
  const ext=path.extname(item.name).toLowerCase();
  const image=ext==='.png'&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||['.jpg','.jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255||ext==='.gif'&&/^GIF8[79]a/.test(bytes.subarray(0,6).toString())||ext==='.webp'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(['.png','.jpg','.jpeg','.gif','.webp'].includes(ext)&&!image)throw new Error('Billedfilens indhold passer ikke til filtypen: '+item.name);
  return {name:item.name,bytes,image:!!image};
 });
}
function writeAttachments(folder,items){
 if(!items.length)return [];
 folder=path.resolve(folder);
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 return items.map((item,i)=>{
  const file=path.join(folder,`${i+1}-${item.name}`);fs.writeFileSync(file,item.bytes,{flag:'wx',mode:0o600});
  let text;
  if(!item.image&&item.bytes.length<=256*1024&&!item.bytes.includes(0))try{text=new TextDecoder('utf-8',{fatal:true}).decode(item.bytes);}catch{}
  return {name:item.name,path:file,image:item.image,size:item.bytes.length,...(text!==undefined?{text}:{})};
 });
}
module.exports={validateAttachments,writeAttachments,MAX_ATTACHMENT_BYTES,MAX_ATTACHMENTS};
