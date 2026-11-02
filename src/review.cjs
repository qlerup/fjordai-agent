function ancestors(graph,id){const result=new Set();function visit(key){for(const e of graph.edges.filter(e=>e.target===key))if(!result.has(e.source)){result.add(e.source);visit(e.source);}}visit(id);return result;}
function reviewSchema(targets){return{type:'object',properties:{approved:{type:'boolean'},summary:{type:'string'},corrections:{type:'array',maxItems:targets.length,items:{type:'object',properties:{nodeId:{type:'string',enum:targets.map(n=>n.id)},message:{type:'string'}},required:['nodeId','message'],additionalProperties:false}}},required:['approved','summary','corrections'],additionalProperties:false};}
function validateReview(raw,targets){
 const value=JSON.parse(raw);if(typeof value.approved!=='boolean'||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>4000||!Array.isArray(value.corrections)||value.corrections.length>targets.length)throw new Error('Code Reviewer gav ikke en gyldig vurdering');
 if(value.approved&&value.corrections.length||!value.approved&&!value.corrections.length)throw new Error('Code Reviewer skal enten godkende eller angive konkrete rettelser');
 const seen=new Set();for(const correction of value.corrections){if(!targets.some(n=>n.id===correction.nodeId)||seen.has(correction.nodeId)||typeof correction.message!=='string'||!correction.message.trim()||correction.message.length>4000)throw new Error('Code Reviewer valgte en ugyldig rettelsesmodtager');seen.add(correction.nodeId);}
 return value;
}
module.exports={ancestors,reviewSchema,validateReview};
