FROM teddysun/xray:latest AS xraysrc

FROM node:20-bookworm-slim

COPY --from=xraysrc /usr/bin/xray /usr/bin/xray
RUN chmod +x /usr/bin/xray

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production
CMD ["node", "server.js"]
