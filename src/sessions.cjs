const fs=require('node:fs');
const path=require('node:path');
const {randomBytes,createHash}=require('node:crypto');
const digest=token=>createHash('sha256').update(token).digest('hex');
class Sessions{
 constructor(dir,{now=Date.now}={}){
  this.file=path.join(dir,'sessions.json');this.now=now;
  this.entries=new Map(fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[]);
  this.prune();
 }
 save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify([...this.entries]),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
 issue(){
  this.prune();const token=randomBytes(32).toString('hex');
  // Persist only the digest: possession of this file must not grant a browser login.
  this.entries.set(digest(token),this.now()+12*3600000);this.save();return token;
 }
 valid(token){if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return false;const expiry=this.entries.get(digest(token));return Number.isFinite(expiry)&&expiry>this.now();}
 revoke(token){if(typeof token==='string'&&this.entries.delete(digest(token)))this.save();}
 prune(){let changed=false;for(const [key,expiry]of this.entries)if(!Number.isFinite(expiry)||expiry<=this.now()){this.entries.delete(key);changed=true;}if(changed)this.save();}
}
module.exports={Sessions};
