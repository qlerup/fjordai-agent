# FjordAgent

- This is a single-owner, self-hosted prototype.
- A project IS its agent workflow: one project graph and start node, one project selector in VS Code. Do not reintroduce separate project/workflow configuration.
- ChatGPT login and Codex run on the server. VS Code is a client, never a second ChatGPT authentication host.
- Preserve workspace baseline checks, secret-path exclusions, and sandbox approval handling.
- Never commit data/, admin keys, Codex credentials or deployment SSH keys.
- Test with `npm test`. Build the VSIX with `npm run package:extension`.
- GitHub is optional source storage, never an installation, runtime or update requirement. Deploy from local source files with `deploy/update.sh`. Use Compose project name `fjordagent` to preserve the existing data volume.
