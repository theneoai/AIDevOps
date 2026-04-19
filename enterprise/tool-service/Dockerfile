FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache wget
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 3000
CMD ["node", "dist/index.js"]
