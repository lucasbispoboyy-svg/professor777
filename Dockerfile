# Imagem para Railway, Render, Fly.io ou qualquer serviço que rode Docker.
# Os dados (banco, fotos, arquivos dos templates) ficam em /data — monte um VOLUME nesse caminho,
# senão tudo é apagado a cada nova publicação.
FROM node:24-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

WORKDIR /app
COPY . .
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
