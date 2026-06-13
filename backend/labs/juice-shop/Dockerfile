# OWASP Juice Shop — modern JS-based vulnerable web app covering the full
# OWASP Top 10 with a built-in score tracker.
#
# Reproducible build: pinned to a specific tag of the upstream repo so the
# image is identical run-to-run.

# Juice Shop v16's libxmljs2 native bindings don't build on Node 24, so we
# pin to Node 20 explicitly (which is what upstream v16 was tested against).
FROM node:20-bookworm-slim

ENV JUICESHOP_VERSION=v16.0.0 \
    NODE_ENV=unsafe \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_PRODUCTION=false

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates \
        python3 make g++ \
        && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth=1 --branch ${JUICESHOP_VERSION} \
        https://github.com/juice-shop/juice-shop.git
WORKDIR /opt/juice-shop

# `--legacy-peer-deps` is needed because juice-shop's deps span major-version
# peer ranges that npm 7+ rejects by default.
RUN npm install --omit=optional --unsafe-perm --legacy-peer-deps

# Compile both the TS server and the Angular frontend so the homepage renders
# and the REST endpoints are reachable. This is the slow part of the build.
RUN npm run build:server && npm run build:frontend

# Drop the build toolchain to slim the image.
RUN apt-get purge -y python3 make g++ && \
    apt-get autoremove -y && rm -rf /var/lib/apt/lists/* /tmp/*

EXPOSE 3000

# `npm start` runs `node build/app` per the upstream package.json.
CMD ["npm", "start"]
