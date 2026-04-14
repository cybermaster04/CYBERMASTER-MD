FROM node:20-bullseye
USER root
RUN apt-get update && \
    apt-get install -y ffmpeg webp git && \
    apt-get upgrade -y && \
    rm -rf /var/lib/apt/lists/*
USER node
RUN git clone https://github.com/cybermaster04/CYBERMASTER-MD.git /home/node/CYBERMASTER-MD
WORKDIR /home/node/CYBERMASTER-MD
RUN chmod -R 777 /home/node/CYBERMASTER-MD/
RUN yarn install --network-concurrency 1 --ignore-engines
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["npm", "start"]
