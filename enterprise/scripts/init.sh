#!/usr/bin/env bash
set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
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

# Apply dify network fix patch if not already applied
apply_dify_network_patch() {
    local dify_dir="dify/docker"
    local patch_file="enterprise/patches/dify-network-fix.patch"

    if [ ! -d "$dify_dir" ]; then
        echo -e "${RED}✗ Dify directory not found at $dify_dir${NC}"
        return 1
    fi

    if [ ! -f "$patch_file" ]; then
        echo -e "${RED}✗ Patch file not found at $patch_file${NC}"
        return 1
    fi

    # Check if patch is already applied (look for dify-network in docker-compose.yaml)
    if grep -q "dify-network" "$dify_dir/docker-compose.yaml" 2>/dev/null; then
        echo -e "${GREEN}✓ Dify network patch already applied${NC}"
        return 0
    fi

    echo -e "${YELLOW}⚠ Applying dify network fix patch...${NC}"
    (cd "$dify_dir" && git am "$patch_file") 2>/dev/null && {
        echo -e "${GREEN}✓ Dify network patch applied successfully${NC}"
        return 0
    } || {
        # If git am fails, patch might already be applied or conflict
        if grep -q "dify-network" "$dify_dir/docker-compose.yaml" 2>/dev/null; then
            echo -e "${GREEN}✓ Dify network patch already applied${NC}"
            return 0
        fi
        echo -e "${RED}✗ Failed to apply dify network patch${NC}"
        return 1
    fi
}

# Apply patch if DIFY_DIR is set and we're in the right context
if [ -d "dify/docker" ] && [ -f "enterprise/patches/dify-network-fix.patch" ]; then
    apply_dify_network_patch || true
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
