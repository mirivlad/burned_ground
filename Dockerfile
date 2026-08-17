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

# Каталог под SQLite создаем ДО объявления тома и отдаем пользователю node:
# иначе Docker создаст точку монтирования от root и процесс упадет с EACCES
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data
EXPOSE 3000

# Проверка живости: /api/health отдает аптайм и число комнат
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Без root
USER node

CMD ["node", "server.js"]
