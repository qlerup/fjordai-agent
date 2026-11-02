const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function editor(){const sandbox={window:{},document:{createElement:()=>({append(){},setAttribute(){}})}};vm.runInNewContext(fs.readFileSync(require.resolve('../public/flow.js'),'utf8'),sandbox);return Object.create(sandbox.window.FjordFlow.FlowEditor.prototype);}
function wire(source,target){const flags={};return{dataset:{source,target},classList:{toggle:(key,value)=>flags[key]=value},flags};}
test('live map animates only a confirmed route to the active node, clears activity on stop',()=>{
 const e=editor(),badge={},card={dataset:{nodeId:'review'},querySelector:()=>badge},used=wire('dev','review'),skipped=wire('dev','other');
 e.plane={querySelectorAll:()=>[card]};e.links={querySelectorAll:()=>[used,skipped]};
 e.setLive({nodes:{dev:'completed',review:'running'},edges:new Set(['dev>review']),active:'review'});
 assert.equal(card.dataset.state,'running');assert.equal(used.flags.flowing,true);assert.equal(skipped.flags.flowing,false);assert.equal(skipped.flags.traversed,false);
 e.setLive({nodes:{dev:'completed',review:'interrupted'},edges:new Set(['dev>review']),active:null});
 assert.equal(used.flags.flowing,false);assert.equal(card.dataset.state,'interrupted');
 e.setLive({nodes:{},edges:new Set(),active:null});assert.equal(card.dataset.state,'idle');assert.equal(used.flags.traversed,false);
});
test('model catalog produces a select and preserves a saved model absent from the catalog',()=>{
 const e=editor(),fields=[];e.graph={nodes:[{id:'agent',name:'Dev',type:'agent',model:'saved-model',instructions:'Work',access:'read'}],edges:[]};e.selected='agent';e.inspector={replaceChildren(){},append(){}};
 e.field=(box,title,value,change,options)=>{fields.push({title,value,options});return{setAttribute(){}};};
 e.setModels([{id:'id-one',model:'available-model',displayName:'Available'}]);
 const model=fields.find(f=>f.title==='Model');assert.equal(model.value,'saved-model');assert.deepEqual(Array.from(model.options.options,option=>option[0]),['','available-model','saved-model']);
});

test('hidden models remain selectable and are identified as extended catalog entries',()=>{
 const e=editor(),fields=[];e.graph={nodes:[{id:'agent',name:'Dev',type:'agent',model:'older-model',instructions:'Work',access:'read'}],edges:[]};e.selected='agent';e.inspector={replaceChildren(){},append(){}};
 e.field=(box,title,value,change,options)=>{fields.push({title,value,options});return{setAttribute(){}};};
 e.setModels([{id:'current-model',displayName:'Current'},{id:'older-model',displayName:'Older',hidden:true}]);
 const model=fields.find(f=>f.title==='Model');assert.equal(model.value,'older-model');
 assert.deepEqual(Array.from(model.options.options,option=>option[0]),['','current-model','older-model']);
 assert.match(model.options.options[2][1],/Older.*udvidet/);
});

test('reasoning choices follow model capabilities, preserve automatic and reset incompatible effort on model changes',()=>{
 const e=editor(),fields=[],agent={id:'agent',name:'Dev',type:'agent',model:'large',reasoningEffort:'ultra',instructions:'Work',access:'read'};
 e.graph={nodes:[agent],edges:[]};e.selected='agent';e.inspector={replaceChildren(){},append(){}};
 e.field=(box,title,value,change,options)=>{fields.push({title,value,change,options});return{setAttribute(){}};};
 e.setModels([{model:'large',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'ultra'}]},{model:'small',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]);
 const reasoning=fields.find(f=>f.title.startsWith('Reasoning'));assert.equal(reasoning.value,'ultra');assert.deepEqual(Array.from(reasoning.options.options,o=>o[0]),['','low','ultra']);
 const model=fields.find(f=>f.title==='Model');fields.length=0;model.change('small');assert.equal(agent.reasoningEffort,'');
 assert.deepEqual(Array.from(fields.find(f=>f.title.startsWith('Reasoning')).options.options,o=>o[0]),['','low']);
});

test('conveyors require completed source data and distinguish named outputs to the same receiver',()=>{
 const e=editor(),first=wire('router','worker'),second=wire('router','worker');first.dataset.port='design';second.dataset.port='code';
 e.plane={querySelectorAll:()=>[]};e.links={querySelectorAll:()=>[first,second]};
 e.setLive({nodes:{router:'running',worker:'running'},edges:new Set(['router>worker']),ports:new Set(['router:design>worker']),active:'worker'});
 assert.equal(first.flags.flowing,false);assert.equal(second.flags.flowing,false);
 e.setLive({nodes:{router:'completed',worker:'running'},edges:new Set(['router>worker']),ports:new Set(['router:design>worker']),active:'worker'});
 assert.equal(first.flags.flowing,true);assert.equal(second.flags.flowing,false);assert.equal(second.flags.traversed,false);
});
