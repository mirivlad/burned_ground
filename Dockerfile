# Burned Ground — production image
FROM node:24-alpine AS deps
WORKDIR /app

# Инструменты для нативной сборки better-sqlite3 (если нет prebuild под musl)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# ---- Финальный образ ----
FROM node:24-alpine
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

# Код игры
COPY server.js bot.js room.js db.js ./
COPY shared ./shared
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV BG_DATA_DIR=/app/data
VOLUME /app/data
EXPOSE 3000

# Без root
USER node

CMD ["node", "server.js"]
