FROM node:24-bookworm-slim

# workerd uses the system trust store for provider HTTPS requests.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p /app/.wrangler/state && chown -R node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node sdk/package.json ./sdk/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
RUN node scripts/sdk/build.mjs
RUN node scripts/local/source-manifest.mjs verify

# The local runtime binds 127.0.0.1:5173 inside this container. The TCP
# bridges expose it on 5174 and the operator on 5177 without changing their
# canonical origins or storage.
ENV CREEZIO_APP_ORIGIN=http://127.0.0.1:5173
EXPOSE 5174 5175 5177
CMD ["node", "adapters/docker/serve.mjs"]
