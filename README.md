# FjordAI Agent

Self-hosted visual agent projects with a browser UI and VS Code chat. ChatGPT login lives in the server app; the extension connects to your installation using a connection key created after signing in.

## Run

Clone this public repository or download its source archive:

```sh
git clone https://github.com/qlerup/fjordai-agent.git
cd fjordai-agent
```

```sh
./deploy/update.sh
```

Open port 3080. On first launch, create your owner username and password (at least 10 characters). Later visits show ordinary login. Passwords are stored as salted scrypt hashes. Setup closes after the owner is created. Existing prototype data is preserved; legacy installation keys are no longer accepted. In **Forbindelser**, sign in with ChatGPT using device login. Device-code login may need to be enabled in the ChatGPT account's security settings. No API key is required by this integration. Subscription availability and limits are enforced by OpenAI. Do not reuse another installation's Codex credential files.

The application runs as a non-root user. Its persistent Docker volume contains projects, histories, isolated execution directories, owner account hash, connection-key hash and Codex credentials. Keep that volume private. For internet access, use an HTTPS reverse proxy and set `SECURE_COOKIE=true`. Docker Compose exposes port 3080; choose network access appropriate to your installation. This is a single-owner prototype, not a multi-user tenant service.

## VS Code

Download the VSIX from **Forbindelser**, install it with **Extensions: Install from VSIX**, create a connection key under **Forbindelser**, then run **FjordAgent: Connect to server** and **FjordAgent: Open chat**. No local Codex installation or separate ChatGPT login is needed.

The extension connects the opened workspace and discovers immediate child repositories. The working folder is the folder already open in VS Code Explorer; sending does not open an additional folder picker. Root instructions/configuration are sent initially. The server agents then use an MCP bridge to list projects, list files, search source text and fetch missing files throughout every workflow stage. Other projects are available as read-only references. Only the selected working project's changes return to VS Code.

Each VS Code run gets an isolated partial server directory. Reading a working-project file through the bridge materializes it there for shell/editing tools. The original content is retained for conflict checks. Once fetched, reads return that working copy, preserving agent edits. The standard shell runs on the server; dependencies and external services are not replicated automatically. Write agents can use `project_run_command` through VS Code to run tests, builds and Docker Desktop commands on the local PC. Normal mode asks for local approval; Full access executes automatically. Commands have a 120-second limit and bounded output; Stop cancels active local commands. Local commands see the current local files; server edits return after the workflow finishes. Missing dependencies/source must be fetched or installed explicitly. VS Code must remain connected; a failed bridge request interrupts the task.

A project is the entire agent workflow. Under **Projekter**, drag nodes onto the canvas, wire their ports and select the project’s start node. VS Code chooses only the project; it does not choose a separate workflow. Add a **Fordeler** node to let AI select among its directly connected successors. Model and role instructions are edited per node. Empty model fields use the Codex default; this does not guarantee a low-cost model. Savings are not yet benchmarked.

Supported logic nodes: conditions with AND/OR rules and yes/no outputs; text templates with `{{prompt}}` and `{{input}}`; and merge nodes. Comparisons support contains, does not contain, equals, empty and numeric greater/less. All outgoing connections from ordinary nodes continue, while conditions and routers choose routes. All ready nodes execute concurrently; each branch continues as soon as its own dependencies finish. Merge and review nodes wait for the selected incoming branches and relevant team tasks. Cycles are rejected. All active agents retain the project MCP bridge throughout the run.

## Included

- Visual project canvas with draggable nodes, wires, zoom, inspector and a per-project start node
- Up to 32 nodes / 96 edges per project; server-validated acyclic execution
- Write-capable developer and read-only reviewer presets
- Server-side Codex App Server 0.163.0 with device-code ChatGPT login
- Browser chat, streamed/polled activity, approval requests, stop and persisted completed runs
- VS Code chat, live project MCP bridge, text create/modify/delete, conflict detection
- Wired AI routing and per-agent model selection
- First-run owner creation, password login, revocable client key, origin checks, login throttling, persistent state and health endpoint

## Prototype boundaries

- Initial snapshot up to 300 files / 2 MB. On-demand reads up to 512 KB per file and 1,000 files / 16 MB per run. Changed output up to 2 MB.
- File lists cap at 5,000 results; searches cap at 100 matches / 8 MB inspected. Narrow searches using project and path prefix.
- Known secret paths, binary files and symlinks are excluded. This is not a general secret scanner.
- Graphs support concurrent branching and merges. Nodes linked by dependencies run in order; independent agents, routers and reviewer corrections can overlap. Agents share the working directory, so assign distinct file responsibilities when editing in parallel. Arbitrary code/function nodes and loops are not supported.
- No automatic retry of failed code tasks, no resume after a server restart.
- Completed runs are saved. A restart interrupts active work. Histories retain the latest 200 runs; execution directories require manual retention management.
- Agent questions beyond tool approvals can be answered with an extra message while work is running.
- During an active run, send extra text in the same composer. Every message goes
  through the project's start, input analysis and routing again. Only the chosen
  worker receives it: an active turn is steered, while a completed or previously
  skipped worker is activated with its original role/access. Dependent merges and
  review refresh before completion. Messages are retained in conversation history.
- The main transcript shows user messages and the final result. Commands, routing
  details and specialist reports are collapsed under **Arbejdsdetaljer**; final
  file diffs remain available through the existing change cards.
- VS Code baseline checks detect existing edits; applying a mixed create/delete/edit batch is not guaranteed atomic by VS Code. Inspect Source Control after applying changes.
- Health endpoint checks the app process, not authentication or upstream model availability.

## Development

Node 22 or newer; server has no third-party runtime npm dependencies.

```sh
npm test
npm start
npm run package:extension
```

Extension packaging downloads pinned `@vscode/vsce@3.6.2`. Docker builds include that packaging step. The Codex runtime is installed in the image; state and credentials are created at runtime only.

## Updating and backup

Optional server SSH access uses the installed OpenSSH client. Place a private
installation-specific SSH configuration in `/data/ssh/config`; it is included by
the system SSH client and survives container updates in the data volume. Keep
private keys in `/data/ssh` with directory mode 700 and key mode 600, owned by the
container's node user. Pin verified host keys in a private known_hosts file and
use `StrictHostKeyChecking yes`. Never put credentials in project files or images.
Set `FJORDAGENT_SSH_HOSTS` in the installation's `.env` to the configured aliases
(for example `proxmox (alias pve)`) to tell agents which server connections exist.
Commands use `ssh proxmox 'pct list'`. Access is from the server, independent of
the VS Code PC; existing project sandbox and approval settings still apply.
Use a dedicated server key so revocation does not affect the owner's PC.

GitHub is optional. Install from a local source folder or an extracted source archive. The host needs Docker with Compose and access to the package/image registries used during the build; no GitHub account, repository, token or SSH key is required.

To upgrade, put the new source files in the installation folder and run:

```sh
./deploy/update.sh
```

If you choose to keep your own source copy in Git, fetch it separately before running the updater. The updater never contacts GitHub or performs `git pull`.

The updater rebuilds the image from the local files, using the stable Compose project name `fjordagent`. Before upgrading, stop the service briefly and back up the named data volume (including sensitive credentials). Do not use `docker compose down -v` unless intentionally deleting all application data.

Restore a previous source archive or local revision and rebuild to roll back. A future schema migration may require restoring the corresponding data backup. Version 0.1 has no destructive schema migrations.


## Factory view and agent settings

Projects open in an embedded Three.js 3D factory. Use **Rediger workflow** to open
its separate node editor; saving returns to the factory. Orbit, zoom, pan and
fullscreen affect the view only. Selecting a machine shows its configuration and
completed output. Machine activity and selected conveyors follow actual run events;
partial answers never release downstream work. Reduced-motion preferences disable
animated machinery. WebGL2 is required for the factory, while the editor remains
available without it.

Agent and router reasoning choices come from the selected model's server catalog.
Automatic leaves the upstream default unchanged. The complete paginated catalog
includes extended entries, without inventing unavailable legacy model IDs. Routers
can have up to eight named outputs with criteria, select one or multiple routes,
and decide from the task, previous answer or both. Independent branches execute concurrently.

To rebuild the locally served 3D bundle: `npm ci --ignore-scripts`, then
`npm run build:factory`. Docker builds it and packages the VSIX automatically;
Three.js and esbuild are pinned build dependencies and no CDN is used at runtime.

## Connectionless dynamic agent teams (optional)

Each project now has a **Manuelt / Dynamisk team** execution selector in the workflow editor. Existing projects continue to use manual wiring by default. In dynamic mode, place a Start node and any number of specialist **Agent** nodes on the canvas without connecting them; include an optional **Fordeler** (Orchestrator) and **Code Reviewer**. The engine builds a temporary routing/collection graph for each run while keeping the saved manual edges unchanged. Switch back to Manuelt to reuse the original graph.

- The Orchestrator selects only the relevant specialists and is capped by **Højst aktive specialister** (1–16, default 4). It uses the optional Fordeler node's instructions/model; without one, a read-only distributor using the default Codex model settings is created for that run.
- Selected specialists retain their saved models, role instructions and file permissions. They can coordinate through the existing per-run team tools, delegate follow-up work to idle specialists (within the configured total-agent cap) and undergo reviewer correction. The final response collects the selected agents' outputs without an additional summarization model call.
- Dynamic mode currently supports Start, Fordeler, Agent, Code Reviewer and Svar nodes, with at most one Fordeler and Code Reviewer. Other logic nodes and fully custom edge/conditional flows remain supported in manual mode. Manual edges are ignored, not erased, in dynamic mode.
- Dynamic runs shorten injected specialist descriptions and prior conversation context to reduce repetitive token use. This is a **cost optimization**, not a guaranteed token saving or quality improvement: compare similar runs using actual usage events and tests before drawing conclusions.
- Like manual concurrent branches, selected write agents currently share a working directory. Give them non-overlapping file responsibilities; avoid enabling automatic full access for untrusted tasks. No unattended deployment is added by this feature.

## Live 3D agent network

Dynamic-team projects show a separate holographic **agent network** instead of the manual workflow warehouse. The central Orchestrator, specialists, optional reviewer and the result collector are visible as distinct stations. Virtual orchestration/collection stations represent the existing runtime nodes and are never stored in the editable graph.

Real event-driven arcs show transfers after node completion, agent messages, distributor task requests, assignments and review corrections. Blue pulses indicate direct messages, amber packets indicate delegation, violet signals indicate corrections and green packets represent workflow handoffs. Faint resting spokes mean a specialist is *available*, not that an interaction has occurred.

The live-activity overlay displays recent messages, task handoffs, specialist starts and optional reviewer model escalation. Click a real specialist to inspect it. The existing Teamsamtale panel still contains task details. Reduced-motion mode preserves status and activity text while disabling animated packets. Manual workflows keep their existing buildings and conveyors.

The 3D view reflects events already recorded in a run; it does not create new AI calls or alter code execution. The normal Docker build regenerates `public/factory3d.js` from the source modules. For direct local development, run `npm run build:factory` before `npm start`.

## Agent collaboration

The team conversation contains messages and tasks sent between agents. Automatic status reports and partial results stay outside this conversation. Agents can send coordination messages using `team_message`; implementation requests use `team_request` and the distributor selects the recipient. Extra user messages traverse input analysis and routing and appear as packages in the factory.

## Optional reviewer escalation

A Code Reviewer can opt into automatic escalation using the inspector's **Automatisk reviewer-eskalering**, **Eskaleringsmodel** and **Eskalerings-reasoning** fields. Settings are stored on that reviewer node and work in both manual and dynamic workflows. Default is off. Choose available models and supported reasoning levels from your installation's model catalog.

Normal review still uses the node's standard model and correction-round limit. When enabled, that model must classify the severity and cite runtime evidence IDs: actual file diffs, executed command results or earlier review feedback. Escalation can occur for major unresolved findings after a correction, complex architecture, critical security, data-loss/regression risks or important technical uncertainty. Prompt keywords and specialist claims alone do not qualify. At most one extra escalated review is allowed across the entire run, including reviewer reruns. It receives the evidence and prior feedback, keeps read access and does not restart implementation. Rejected or malformed reviews still block completion; a failed escalated call also fails the run.

For VS Code tasks, file changes come from the conflict-check baseline and command evidence includes observed server/local command results. In other tasks, runtime diff/command events provide evidence. Evidence and repeated context are bounded; this is not a substitute for actually running relevant tests.
