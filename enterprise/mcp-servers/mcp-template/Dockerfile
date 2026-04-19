FROM node:18-alpine

# Install wget for healthchecks
RUN apk add --no-cache wget

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built application
COPY dist/ ./dist/

# Expose the application port
EXPOSE 3000

# Run the application
CMD ["node", "dist/index.js"]
