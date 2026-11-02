const fs=require('node:fs');
const path=require('node:path');
const {randomBytes,scrypt,timingSafeEqual,createHash}=require('node:crypto');
const {promisify}=require('node:util');
const derive=promisify(scrypt);
const digest=value=>createHash('sha256').update(value).digest();
class Auth {
  constructor(dir){this.file=path.join(dir,'auth.json');this.value=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):null;this.creating=false;}
  get ready(){return !!this.value;}
  save(value){fs.writeFileSync(this.file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);this.value=value;}
  async create(username,password){
    if(this.ready||this.creating)throw Object.assign(new Error('Opsætningen er allerede gennemført eller i gang'),{status:409});
    if(typeof username!=='string'||! /^[a-zA-Z0-9_.@-]{3,64}$/.test(username.trim()))throw Object.assign(new Error('Brugernavn skal være 3–64 tegn: bogstaver, tal, punktum, @, _ eller -'),{status:400});
    if(typeof password!=='string'||password.length<10||password.length>256)throw Object.assign(new Error('Adgangskoden skal være 10–256 tegn'),{status:400});
    this.creating=true;
    try{const salt=randomBytes(16).toString('hex');const hash=await derive(password,salt,32,{N:32768,maxmem:64*1024*1024});this.save({username:username.trim(),salt,passwordHash:hash.toString('hex'),connectionHash:null});}finally{this.creating=false;}
  }
  async verify(username,password){
    if(!this.ready||typeof username!=='string'||typeof password!=='string'||password.length>256)return false;
    const hash=await derive(password,this.value.salt,32,{N:32768,maxmem:64*1024*1024});
    return timingSafeEqual(hash,Buffer.from(this.value.passwordHash,'hex'))&&username.trim().toLowerCase()===this.value.username.toLowerCase();
  }
  bearer(token){return !!(this.value?.connectionHash&&token&&timingSafeEqual(digest(token),Buffer.from(this.value.connectionHash,'hex')));}
  issue(){const token=randomBytes(32).toString('hex');this.save({...this.value,connectionHash:digest(token).toString('hex')});return token;}
  revoke(){this.save({...this.value,connectionHash:null});}
}
module.exports={Auth};
