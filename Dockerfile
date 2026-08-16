# Burned Ground — production image
FROM node:20-alpine

WORKDIR /app

# Зависимости (сначала package-файлы — кэш слоёв)
COPY package*.json ./
RUN npm ci --omit=dev

# Код игры
COPY server.js bot.js room.js ./
COPY shared ./shared
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Без root
USER node

CMD ["node", "server.js"]
