ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS build

WORKDIR /opt/lyranest-xiaoai-bridge
COPY package*.json tsconfig.json ./
RUN NODE_ENV=development npm ci
COPY src/ src/
RUN npm run build

FROM ${NODE_IMAGE}

WORKDIR /opt/lyranest-xiaoai-bridge
COPY package*.json ./
RUN npm ci --omit=dev
COPY python/requirements.txt /tmp/xiaomi-auth-requirements.txt
RUN apk add --no-cache python3 py3-pip \
    && pip3 install --no-cache-dir --break-system-packages -r /tmp/xiaomi-auth-requirements.txt \
    && python3 -c "from miservice import MiAccount"
COPY --from=build /opt/lyranest-xiaoai-bridge/dist/ dist/
COPY python/ python/
COPY public/ public/
COPY docker-entrypoint.sh /opt/lyranest-xiaoai-bridge/docker-entrypoint.sh
RUN chmod 0555 /opt/lyranest-xiaoai-bridge/docker-entrypoint.sh

ENV BRIDGE_DATA_DIR=/data \
    BRIDGE_PORT=8090 \
    BRIDGE_RUNTIME=docker \
    NODE_ENV=production

EXPOSE 8090

VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const port=process.env.BRIDGE_PORT||'8090'; fetch('http://127.0.0.1:'+port+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/opt/lyranest-xiaoai-bridge/docker-entrypoint.sh"]
