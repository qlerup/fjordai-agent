function downstreamRouters(graph,id){
 const found=[],seen=new Set();
 function visit(key){for(const edge of graph.edges.filter(e=>e.source===key)){if(seen.has(edge.target))continue;seen.add(edge.target);const n=graph.nodes.find(n=>n.id===edge.target);if(n.type==='router'&&n.routes)found.push(n);else if(['text','merge','condition'].includes(n.type))visit(n.id);}}
 visit(id);return found;
}
function classificationSchema(routers){
 const properties={summary:{type:'string'},intent:{type:'string'}};
 if(routers.length)properties.decisions={type:'array',minItems:routers.length,maxItems:routers.length,items:{type:'object',properties:{routerId:{type:'string',enum:routers.map(n=>n.id)},ports:{type:'array',minItems:1,maxItems:8,items:{type:'string',enum:[...new Set(routers.flatMap(n=>n.routes.map(r=>r.id)))]}}},required:['routerId','ports'],additionalProperties:false}};
 return{type:'object',properties,required:Object.keys(properties),additionalProperties:false};
}
function validateClassification(raw,routers){
 const value=JSON.parse(raw);if(typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>4000||typeof value.intent!=='string'||!value.intent.trim()||value.intent.length>1000)throw new Error('Inputanalysen gav ikke en gyldig vurdering');
 if(routers.length){if(!Array.isArray(value.decisions)||value.decisions.length!==routers.length||new Set(value.decisions.map(d=>d.routerId)).size!==routers.length)throw new Error('Inputanalysen mangler en entydig fordelingsbeslutning');
  for(const decision of value.decisions){const router=routers.find(n=>n.id===decision.routerId),ports=decision.ports;if(!router||!Array.isArray(ports)||!ports.length||new Set(ports).size!==ports.length||(router.routeMode==='one'&&ports.length!==1)||ports.some(port=>!router.routes.some(r=>r.id===port)))throw new Error('Inputanalysen valgte en ugyldig udgang');}
 }
 return value;
}
module.exports={downstreamRouters,classificationSchema,validateClassification};
