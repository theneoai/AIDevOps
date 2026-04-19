#!/usr/bin/env bash
set -uo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

HEALTHY=true

echo "Checking service health..."

# Check enterprise-tool-service
if curl -sf http://localhost:3100/health >/dev/null; then
    echo -e "${GREEN}✓ enterprise-tool-service is healthy${NC}"
else
    echo -e "${RED}✗ enterprise-tool-service is unhealthy${NC}"
    HEALTHY=false
fi

# Check mcp-wechat
if curl -sf http://localhost:3001/health >/dev/null; then
    echo -e "${GREEN}✓ mcp-wechat is healthy${NC}"
else
    echo -e "${RED}✗ mcp-wechat is unhealthy${NC}"
    HEALTHY=false
fi

if [ "$HEALTHY" = true ]; then
    exit 0
else
    exit 1
fi
