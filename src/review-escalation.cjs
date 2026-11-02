const {reviewSchema,validateReview}=require('./review.cjs');
// Only evidence produced by the runtime is eligible. User prompt text and
// unverified specialist summaries are never escalation evidence.
function evidencePacket(entries){
 const result=[];let budget=36000;const seen=new Set();
 for(const entry of entries){if(!entry||!['change','command','feedback'].includes(entry.kind)||typeof entry.id!=='string'||seen.has(entry.id)||typeof entry.text!=='string'||!entry.text.trim()||budget<=0)continue;const text=entry.text.slice(0,Math.min(12000,budget));budget-=text.length;seen.add(entry.id);result.push({id:entry.id,kind:entry.kind,text});}
 return result;
}
function escalationReason(verdict,round,evidence){
 const e=verdict.escalation;
 if(verdict.approved||!e||e.severity==='minor')return null;
 const referenced=e.evidenceIds.map(id=>evidence.find(item=>item.id===id)).filter(Boolean);
 if(e.evidenceIds.some(id=>!evidence.some(item=>item.id===id)))return null;
 const category=round>0&&e.category==='none'?'after-correction':e.category;
 if(category==='none'||category==='after-correction'&&round<1||!referenced.length)return null;
 if(category!=='after-correction'&&!referenced.some(item=>item.kind==='change'||item.kind==='command'))return null;
 return{category,reason:e.reason||verdict.summary,evidenceIds:referenced.map(item=>item.id)};
}
async function reviewWithEscalation({node,targets,round,evidence,feedback,budget,run,emit}){
 const enabled=node.escalation?.enabled===true,packet=enabled?evidencePacket([...feedback.slice(-4).map(e=>({...e,text:e.text.slice(0,2500)})),...evidence]):[];
 const normal=validateReview(await run(node,reviewSchema(targets,enabled),{stage:'normal',evidence:packet,previousFeedback:feedback.slice(-4).map(e=>e.id),instructions:enabled?'Vurdér om stærkere review er nødvendigt ud fra FAKTISKE ændringer, udførte kommandoer/testresultater og tidligere reviewer-feedback i evidence. Brug aldrig brugerens nøgleord eller specialistens påstande som bevis. Ved godkendelse skal escalation.category være none. Ved afvisning skal du angive konkrete corrections. Angiv severity minor for kosmetik/småfejl, major eller critical for væsentlige fejl. Brug category after-correction for væsentlige fejl efter en faktisk rettelsesrunde, architecture for kompleks arkitektur, critical-security for kritisk autentificering/autorisation/kryptering/følsomme data, data-loss for datatab/alvorlig regression, uncertain for et vigtigt uafklaret teknisk problem. Ellers none. evidenceIds skal henvise til konkrete poster fra evidence; beskriv præcist problemet. Manglende evidens er ikke en grund til at gætte.':''}),targets,enabled);
 const remember=(verdict,stage)=>{const id=budget.feedbackSequence||0;budget.feedbackSequence=id+1;feedback.push({id:'review-'+id,kind:'feedback',text:JSON.stringify({round,stage,summary:verdict.summary,corrections:verdict.corrections}).slice(0,12000)});if(feedback.length>8)feedback.shift();};
 const reason=enabled?escalationReason(normal,round,packet):null;remember(normal,'normal');
 if(!reason||budget.used>=1)return normal;
 // The budget belongs to the whole run, including reviewer reruns after input.
 budget.used++;
 emit({type:'review-escalated',name:node.name,model:node.escalation.model,reasoningEffort:node.escalation.reasoningEffort,round,...reason});
 const escalated={...node,model:node.escalation.model,reasoningEffort:node.escalation.reasoningEffort};
 const verdict=validateReview(await run(escalated,reviewSchema(targets),{stage:'escalation',evidence:packet,previousFeedback:feedback.slice(-4).map(e=>e.id),trigger:reason,solReview:normal,instructions:'Du er den ene ekstra eskalerede reviewer-gennemgang. Kontrollér konkret evidens, ændringer, testresultater og Sols fund. Gentag ikke implementeringen eller hele arbejdsprocessen. Du har kun læseadgang. Godkend kun det aktuelle resultat hvis det faktisk kan verificeres; ellers giv konkrete corrections. Manglende eller fejlet verifikation må aldrig fremstilles som bestået.'}),targets);
 remember(verdict,'escalation');return verdict;
}
module.exports={evidencePacket,escalationReason,reviewWithEscalation};
