FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# 先装依赖（利用层缓存）
COPY package*.json ./
RUN npm ci --omit=dev

# 应用代码
COPY src ./src
COPY public ./public

# 数据目录 + 以非 root 运行
RUN mkdir -p data && addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

# 容器内固定监听 8181；对外端口由 compose 映射
EXPOSE 8181
ENV PORT=8181 BIND_HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8181/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "src/server.js"]
