# DevKit Dockerfile
# Builds the Dify DevKit CLI tool

FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production image
FROM node:22-alpine

WORKDIR /app

# Copy built artifacts and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/scripts ./scripts

# Ensure Python is available for encryption helper
RUN apk add --no-cache python3 py3-pip \
    && pip3 install pycryptodome --break-system-packages

# Create components directory
RUN mkdir -p /app/components

# Set up entrypoint
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["status"]
