(function(root){
 function render(host,report,changes,status,loadDiff){
  const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const files=report?.files||changes||[],card=make('section',undefined,'change-report'),title=make('h3',files.length?files.length+(files.length===1?' fil ændret':' filer ændret'):'Ingen filændringer');
  card.setAttribute('aria-label','Kodeændringer');card.append(title);
  if(Number.isInteger(report?.added))card.append(make('p','+'+report.added+' tilføjede · −'+report.removed+' fjernede linjer','change-totals'));
  const state=make('p',status,'change-application');state.setAttribute('role','status');card.append(state);
  if(report?.error)card.append(make('p',report.error,'change-warning'));
  for(const file of files){
   const details=make('details'),summary=make('summary'),name=make('span',file.path,'change-path'),kind=make('small',({create:'Ny fil',modify:'Ændret',delete:'Slettet'})[file.kind]||file.kind);
   summary.append(name,kind);if(Number.isInteger(file.added))summary.append(make('span','+'+file.added+' / −'+file.removed,'change-count'));details.append(summary);
   const preview=make(file.diff?'pre':'p',file.diff||'Diff og linjetal er ikke registreret for denne tidligere kørsel.',file.diff?'change-diff':'change-warning');details.append(preview);
   if(!file.diff&&loadDiff){preview.textContent='Åbn for at hente diffen.';let loaded=false;details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;preview.textContent='Henter diff…';try{const fresh=await loadDiff(file.path);const pre=make('pre',fresh?.diff||'Diffen er ikke registreret for denne tidligere kørsel.','change-diff');preview.replaceWith(pre);}catch{preview.textContent='Diffen kunne ikke hentes. Luk og åbn for at prøve igen.';loaded=false;}});}
   if(file.truncated)details.append(make('p','Diffen er forkortet. Linjetallene dækker hele filændringen.','change-warning'));
   card.append(details);
  }
  host.append(card);return state;
 }
 root.FjordChanges={render};
})(globalThis);
