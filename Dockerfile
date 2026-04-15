FROM node:lts-slim

# Install system dependencies for media processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    imagemagick \
    webp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files for optimal layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code
COPY . .

# Use non-root user for security
USER node

# Expose application port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start the bot
CMD ["npm", "start"]
