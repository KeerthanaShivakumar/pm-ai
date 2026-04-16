FROM node:22-alpine

USER node
WORKDIR /home/node/app

ENV NODE_ENV=production
ENV PORT=7860
ENV HOST=0.0.0.0

COPY --chown=node:node package.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node README.md ./

EXPOSE 7860

CMD ["node", "server.js"]
