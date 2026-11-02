# FjordAI Agent for VS Code

Chat with your self-hosted agent workflows. ChatGPT login lives **only in the server app**. The extension never holds a ChatGPT token and does not require local Codex CLI.

1. Install this VSIX via **Extensions: Install from VSIX**.
2. Click the **FjordAI Agent chat icon** in the Activity Bar, then **Forbind til server**. Enter the server URL and a connection key created in the app’s **Forbindelser** page.
3. Sign in with ChatGPT in the server's **Forbindelser** page and create a project.
4. Open a trusted project folder, then use the **FjordAI Agent** sidebar. **FjordAI Agent: Open chat** in the command palette also opens it.
5. Select the project and send a task. Its saved start node, logic and connected agents control execution.
6. Review the results and click **Anvend kodeændringer i VS Code**. Save and inspect the changes in Source Control.

The project bridge exposes workspace folders and discovered immediate child repositories throughout the workflow. Agents can list projects, list files, search and fetch additional UTF-8 files whenever needed. The working folder is the folder already open in VS Code Explorer. Other discovered projects remain available to the project bridge; sending never opens an additional folder picker.

Known secret paths, symlinks and binary files are excluded. Project-specific secrets in ordinary source files cannot be detected reliably. Only open trusted project folders. Keep the panel connected while a task runs. File reads are capped at 512 KB, total fetched content at 16 MB and returned changes at 2 MB. The standard agent shell executes on the server. Write agents can use project_run_command to run builds, tests and Docker Desktop commands in the local working project through VS Code. Normal mode asks for approval; Full access runs automatically. Commands are limited to 120 seconds and 64 KB output. Stop cancels active local commands. Server edits return only after the workflow finishes; a local command sees the current local files.

A project is the complete agent workflow. To enable AI routing, add and wire a **Fordeler** node on the project canvas in the app. ChatGPT login and all model selection live in the app. No separate ChatGPT login or Codex installation is required in VS Code.

Changes are checked against original file hashes before applying. Local modifications block conflicting results. Created, modified and deleted UTF-8 files are supported; binary changes and file modes are not. Inspect Source Control and save after applying. Mixed file operations are not guaranteed atomic by VS Code.

Version 0.1.1 adds the sidebar icon and in-chat connection setup. Upgrade the VSIX and reload the window if VS Code requests it.

Version 0.1.2 uses a single project selector. Existing versions can still send tasks; the server executes the selected project graph.


Chatten åbner som sin egen fane i højre sidepanel. Vælg agentflow i beskedfeltet; modeller og forbindelser mellem agenter konfigureres i webappen. Enter sender, Shift+Enter laver et linjeskift. Hvis VS Code har gemt en tidligere placering, træk fanen til højre sidepanel.

Enter sends directly using the open Explorer workspace; Shift+Enter adds a newline. No additional working-project picker is required.
# Vedhæftninger (0.1.5)

Brug **+** ved skrivefeltet til at vælge filer og billeder. Du kan også trække
filer ind på skrivefeltet eller indsætte et billede fra udklipsholderen.
Vedhæftninger vises før afsendelse og kan fjernes enkeltvis. Højst 8 filer og
10 MB samlet pr. opgave. De sendes først til serveren sammen med opgaven.

PNG, JPEG, GIF og WebP sendes som billedinput til agenten. Tekstfiler op til
256 KB medtages direkte som kontekst; øvrige filer lægges på serveren, hvor
agenten kan undersøge dem med de tilgængelige værktøjer. Følsomme filnavne som
`.env`, `auth.json` og private nøgler afvises ligesom i projektforbindelsen.
Vedhæftninger indgår ikke som kodeændringer, der kan anvendes i dit projekt.
Serveren skal også opdateres for at understøtte vedhæftninger.

