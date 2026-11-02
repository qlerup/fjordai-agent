const {test}=require('node:test');const assert=require('node:assert/strict');
const {listModels}=require('../src/models.cjs');

test('full catalog includes hidden models, follows pages and deduplicates model IDs',async()=>{
 const calls=[];const visible={id:'current',model:'current-model'},legacy={id:'legacy',model:'legacy-model',hidden:true};
 const codex={rpc:async(method,params)=>{calls.push({method,params});return params.cursor?{data:[visible,legacy],nextCursor:null}:{data:[visible],nextCursor:'older-page'};}};
 assert.deepEqual(await listModels(codex),{data:[visible,legacy],nextCursor:null});
 assert.deepEqual(calls,[{method:'model/list',params:{includeHidden:true,limit:100}},{method:'model/list',params:{includeHidden:true,limit:100,cursor:'older-page'}}]);
});
test('an unavailable later catalog page fails instead of returning a truncated list',async()=>{
 const codex={rpc:async(method,params)=>{if(params.cursor)throw new Error('upstream unavailable');return{data:[{id:'current'}],nextCursor:'next'};}};
 await assert.rejects(listModels(codex),/upstream unavailable/);
});
test('repeated cursors and malformed catalogs fail without looping',async()=>{
 await assert.rejects(listModels({rpc:async()=>({data:[],nextCursor:'repeat'})}),/modelside/);
 await assert.rejects(listModels({rpc:async()=>({})}),/ugyldigt modelkatalog/);
});
