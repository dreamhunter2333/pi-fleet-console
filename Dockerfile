FROM oven/bun:1-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN bun install --no-save --ignore-scripts

FROM oven/bun:1-slim AS builder

WORKDIR /app
ARG FLEET_VERSION
ENV NEXT_TELEMETRY_DISABLED=1 \
    PI_FLEET_STATIC_EXPORT=1 \
    PI_FLEET_VERSION=$FLEET_VERSION
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN rm -rf app/api && sed -i 's/"force-dynamic"/"force-static"/' app/manifest.ts && bun run build

FROM openresty/openresty:1.31.1.1-2-alpine

ENV PI_FLEET_CONFIG_FILE=/config/machines.json

COPY gateway/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf
COPY gateway/fleet.lua /etc/openresty/fleet.lua
COPY gateway/machines.json /config/machines.json
COPY --from=builder /app/out /srv

EXPOSE 30141

CMD ["/usr/local/openresty/bin/openresty", "-g", "daemon off;"]
