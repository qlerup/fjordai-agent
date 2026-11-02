async function setup(base){
 const r=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'test-password-123'})});if(!r.ok)throw new Error(await r.text());
 const cookie=r.headers.get('set-cookie').split(';')[0];const key=await fetch(base+'/api/connection-key',{method:'POST',headers:{Cookie:cookie}}).then(r=>r.json());return{cookie,token:key.token};
}
module.exports={setup};
