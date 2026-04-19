#!/usr/bin/env bash
set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "Initializing Enterprise Agent Framework..."

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    exit 1
fi

# Check Docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "${RED}✗ Docker daemon is not running${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker is installed and running${NC}"

# Check Docker Compose (v1 or v2)
if command -v docker-compose &> /dev/null; then
    echo -e "${GREEN}✓ Docker Compose (v1) is installed${NC}"
elif docker compose version &> /dev/null; then
    echo -e "${GREEN}✓ Docker Compose (v2) is installed${NC}"
else
    echo -e "${RED}✗ Docker Compose is not installed${NC}"
    exit 1
fi

# Create .env if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✓ Created .env from .env.example${NC}"
else
    echo -e "${GREEN}✓ .env already exists${NC}"
fi

# Warn if placeholder secrets remain
if grep -q 'your-wechat-app-id' .env || grep -q 'your-wechat-app-secret' .env; then
    echo ""
    echo -e "${RED}⚠ Warning: .env contains placeholder WeChat credentials${NC}"
    echo -e "${RED}  Please edit .env and replace with real values before starting services${NC}"
fi

# Create docker network
if docker network inspect dify-network &> /dev/null; then
    echo -e "${GREEN}✓ Docker network 'dify-network' already exists${NC}"
else
    docker network create dify-network
    echo -e "${GREEN}✓ Created docker network 'dify-network'${NC}"
fi

# Create necessary directories
mkdir -p enterprise/workflows/marketing
mkdir -p enterprise/workflows/ops
mkdir -p enterprise/skills/marketing
mkdir -p enterprise/skills/ops
echo -e "${GREEN}✓ Created enterprise directories${NC}"

echo ""
echo -e "${GREEN}Initialization complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit .env file with your configuration"
echo "  2. Run: make up-all"
