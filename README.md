# Developer Dashboard

A dashboard for monitoring and managing development projects. It reads live
queues from [notion-bridge](https://github.com/stevenspicher/notion-bridge)
(and, optionally, User Stories from ado-bridge).

## Getting Started

```bash
npm install
npm run dev        # http://localhost:8443, proxies /bridge → localhost:3100, /ado → localhost:8000
```

Point the proxy elsewhere with `NOTION_BRIDGE_URL` / `ADO_BRIDGE_URL`.
ADO User Stories are on by default and need ado-bridge connected to Azure DevOps (`ADO_PAT` in its `.env`). Start with `VITE_ADO_STORIES=false` to hide them.

## Tests

```bash
npm test           # Vitest: the logic modules (plan, ranking, schedule, standup, ticks, keys)
npm run test:watch
```

Tests sit next to the code (`src/*.test.ts`). A test that needs `localStorage` or the DOM
starts with `// @vitest-environment jsdom`. `npx tsc --noEmit` checks types, `npm run contrast` checks the colour tokens
in both themes, `/?ui=tokens` shows them and `/?ui=atoms` shows the shared components.

## Dependencies

`package-lock.json` is the source of truth: the Docker build installs from it
(`npm ci`), so change dependencies with `npm install` and commit the lockfile.
`pnpm-lock.yaml` exists for Figma Make, which regenerates it, and isn't kept in
sync by hand.

## Docker

```bash
docker compose up -d --build   # http://localhost:8080
```

The image builds the app and serves it with nginx, which forwards `/bridge` and
`/ado` to the bridges running on the host (`host.docker.internal:3100` / `:8000`).

| Setting | When it applies |
|---|---|
| `NOTION_BRIDGE_URL`, `ADO_BRIDGE_URL` | Runtime — `docker compose up -d` |
| `DASHBOARD_PORT` (default `8080`) | Runtime — `docker compose up -d` |
| `VITE_ADO_STORIES` | Build time — `docker compose up -d --build` |

Set them in the shell or in a `.env` file next to `docker-compose.yml`. Any code
change needs `docker compose up -d --build`. On an HTTPS-inspecting network, put
the corporate root CA in `certs/` before building — see [certs/README.md](certs/README.md).

## License

MIT
