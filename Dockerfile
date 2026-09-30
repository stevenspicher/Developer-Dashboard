# ── Build ────────────────────────────────────────────────────────────────────
FROM node:24-slim AS build

# Trust any extra root CAs dropped into certs/ (e.g. a corporate HTTPS-inspection
# CA — see certs/README.md) so `npm ci` works behind the proxy. apt fetches over
# plain HTTP, so this step itself isn't affected.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY certs/ /tmp/certs/
RUN for f in /tmp/certs/*.crt /tmp/certs/*.pem; do \
      [ -f "$f" ] && cp "$f" "/usr/local/share/ca-certificates/$(basename "${f%.*}").crt"; \
    done; \
    update-ca-certificates && rm -rf /tmp/certs
ENV NODE_OPTIONS=--use-system-ca

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Vite inlines VITE_* at build time, so this is a build arg, not a runtime env.
ARG VITE_ADO_STORIES=false
ENV VITE_ADO_STORIES=$VITE_ADO_STORIES
RUN npm run build

# ── Serve ────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# nginx renders templates/*.template into conf.d at startup, substituting the
# bridge URLs below — so they can change without a rebuild.
ENV NOTION_BRIDGE_URL=http://host.docker.internal:3100 \
    ADO_BRIDGE_URL=http://host.docker.internal:8000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
