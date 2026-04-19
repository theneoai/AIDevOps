# Dify MCP Server Template

This is a template for building Model Context Protocol (MCP) servers for the Dify Enterprise Agent Framework.

## Overview

This template provides a complete, production-ready scaffold for creating new MCP servers. It includes:

- TypeScript setup with strict type checking
- Express.js HTTP server with SSE transport
- Winston JSON logging
- Zod configuration validation
- Jest testing framework
- Docker support
- Health check endpoint

## How to Copy and Customize

1. **Copy the template directory:**
   ```bash
   cp -r enterprise/mcp-servers/mcp-template enterprise/mcp-servers/mcp-my-server
   ```

2. **Update `package.json`:**
   - Change `name` to `dify-mcp-my-server`
   - Update `description`
   - Adjust dependencies as needed

3. **Define your tools:**
   - Edit `src/server.ts`
   - Add your tool definitions to the `tools` array
   - Implement tool handlers in the `CallToolRequestSchema` handler

4. **Update configuration:**
   - Edit `src/config.ts` to add any new environment variables
   - Use `MCP_` prefix for MCP-specific variables

5. **Add to docker-compose:**
   ```yaml
   mcp-my-server:
     build: ./enterprise/mcp-servers/mcp-my-server
     ports:
       - "3002:3000"
     environment:
       - MCP_SERVER_PORT=3000
       - MCP_SERVER_PATH=/sse
   ```

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Start production server
npm start
```

## Standards

### Port Allocation
- MCP servers use ports **3001-3099**
- The template defaults to port 3000; update for each new server

### Endpoints
- `GET /sse` — SSE endpoint for MCP communication (configurable via `MCP_SERVER_PATH`)
- `POST /messages` — Message endpoint for MCP communication
- `GET /health` — Health check endpoint returning status, service name, timestamp, and uptime

### Logging
- Use **JSON format** for all logs
- Include `service` metadata field
- Use Winston logger from `src/logger.ts`

### Environment Variables
- Use `MCP_` prefix for MCP-specific configuration
- Common variables:
  - `NODE_ENV` — `development`, `production`, or `test`
  - `LOG_LEVEL` — `debug`, `info`, `warn`, or `error`
  - `MCP_SERVER_PORT` — Server port (1-65535)
  - `MCP_SERVER_PATH` — SSE endpoint path

## File Structure

```
mcp-template/
├── package.json
├── tsconfig.json
├── jest.config.js
├── Dockerfile
├── README.md
└── src/
    ├── index.ts          # Express app entry point
    ├── server.ts         # MCP server implementation
    ├── config.ts         # Configuration and validation
    ├── logger.ts         # Winston logger factory
    └── __tests__/
        └── server.test.ts # Basic server tests
```

## License

MIT
