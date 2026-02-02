FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy server code
COPY index.js ./

# Expose port (Railway/Render will set PORT env var)
EXPOSE 3000

# Start server
CMD ["node", "index.js"]
