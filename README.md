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
ADO User Stories are off by default; start with `VITE_ADO_STORIES=true` to enable them.

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
