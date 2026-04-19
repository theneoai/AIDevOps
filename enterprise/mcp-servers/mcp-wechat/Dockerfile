FROM node:18-alpine

WORKDIR /app

# Install wget for healthchecks
RUN apk add --no-cache wget

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled code
COPY dist/ ./dist/

# Expose port
EXPOSE 3000

# Start service
CMD ["node", "dist/index.js"]
