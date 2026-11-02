const fs = require('node:fs');
const path = require('node:path');
const {validateGraph,legacyGraph}=require('./graph.cjs');
const {reasoningEffort}=require('./models.cjs');
const { randomUUID } = require('node:crypto');
const defaults = [
  { id: 'develop-review', name: 'Byg og gennemgå', steps: [
    { name: 'Udvikler', access: 'write', instructions: 'Løs brugerens opgave i projektmappen. Undersøg først eksisterende kode. Lav fokuserede ændringer og kør relevante tests. Forklar resultat og begrænsninger kort på dansk.' },
    { name: 'Reviewer', access: 'read', instructions: 'Gennemgå de faktiske ændringer i projektmappen. Find fejl og regressioner. Ændr ikke filer. Rapportér konkrete fund eller sig tydeligt, hvad du har kontrolleret.' }
  ] },
  { id: 'ask', name: 'Spørg agenten', steps: [{ name: 'Assistent', access: 'read', instructions: 'Besvar brugerens spørgsmål på dansk. Undersøg projektet efter behov. Ændr ikke filer.' }] }
];
function validateWorkflow(input) {
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if(input.graph){if(!text(input.name,80))throw new Error('Angiv et workflownavn');const graph=validateGraph(input.graph);return{name:input.name.trim(),graph,steps:graph.nodes.filter(n=>n.type==='agent').map(n=>({name:n.name,instructions:n.instructions,access:n.access,model:n.model,reasoningEffort:n.reasoningEffort}))};}
  if (!text(input.name, 80) || !Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 8) throw new Error('Workflow kræver navn og 1–8 agenter');
  for (const s of input.steps) if (!text(s.name, 60) || !text(s.instructions, 12000) || !['read','write'].includes(s.access) || (s.model && !text(s.model, 100))) throw new Error('Ugyldig agent');
  return { name: input.name.trim(), steps: input.steps.map(s => ({ name:s.name.trim(), instructions:s.instructions, access:s.access, model:s.model || '', reasoningEffort:reasoningEffort(s.reasoningEffort) })) };
}
class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); this.file = path.join(dir, 'state.json');
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { projects: [], workflows: defaults, runs: [] };
    if(!this.state.graphMigrationVersion){
      const bound=new Set(this.state.projects.map(p=>p.workflowId));
      for(const w of this.state.workflows){if(['develop-review','ask'].includes(w.id)||bound.has(w.id)||this.state.projects.some(p=>p.id===w.id))continue;this.state.projects.push({id:w.id,name:w.name,graph:w.graph?structuredClone(w.graph):legacyGraph(w.steps),createdAt:new Date().toISOString()});}
      this.state.graphMigrationVersion=1;
    }
    // Upgrade existing projects in place: a project owns its complete graph.
    for(const project of this.state.projects){
      project.fullAccess=project.fullAccess===true;
      if(!project.graph){const source=this.state.workflows.find(w=>w.id===project.workflowId)||this.state.workflows.find(w=>w.id==='develop-review')||defaults[0];project.graph=source.graph?structuredClone(source.graph):legacyGraph(source.steps);}
      if(!project.graph.nodes.some(n=>n.id===project.startNodeId&&n.type==='start'))project.startNodeId=project.graph.nodes.find(n=>n.type==='start').id;
      delete project.workflowId;
    }
    for (const r of this.state.runs) if (r.status === 'running') { r.status = 'interrupted'; r.error = 'Serveren blev genstartet'; }
    this.save();
  }
  save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file); }
  id() { return randomUUID(); }
}
module.exports = { Store, validateWorkflow };
