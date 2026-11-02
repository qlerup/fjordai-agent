FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS extension-build
WORKDIR /build
COPY package.json package-lock.json LICENSE ./
RUN npm ci --ignore-scripts
COPY extension ./extension
COPY src ./src
COPY deploy ./deploy
COPY public/factory-scene.js ./public/factory-scene.js
COPY public/factory-playback.mjs ./public/factory-playback.mjs
COPY public/change-view.js public/change-view.css ./public/
RUN node deploy/build-factory.cjs && node deploy/package-extension.cjs

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep python3 openssh-client && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@0.163.0
COPY --chmod=644 deploy/ssh_config /etc/ssh/ssh_config.d/fjordagent.conf
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --from=extension-build --chown=node:node /build/public/factory3d.js ./public/factory3d.js
COPY --from=extension-build --chown=node:node /build/public/fjordagent.vsix ./public/fjordagent.vsix
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production DATA_DIR=/data PORT=3080
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","src/server.cjs"]
