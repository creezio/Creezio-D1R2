FROM node:24-bookworm-slim

WORKDIR /app
RUN mkdir -p /app/.wrangler/state && chown -R node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .

# The local runtime binds 127.0.0.1:5173 inside this container. The TCP
# bridge exposes it on 5174 without changing its canonical origin or storage.
ENV CREEZIO_APP_ORIGIN=http://127.0.0.1:5173
EXPOSE 5174
CMD ["node", "adapters/docker/serve.mjs"]
