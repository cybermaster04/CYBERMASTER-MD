FROM node:lts-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg imagemagick webp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

USER node
EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "run", "start"]
