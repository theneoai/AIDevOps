.PHONY: init build up down logs status health restart clean

init:
	@test -f .env || cp .env.example .env
	docker network inspect dify-network >/dev/null 2>&1 || docker network create dify-network

build:
	@docker-compose build

up:
	@docker-compose up -d

down:
	@docker-compose down 2>/dev/null || true

# 启动全部服务（包括 Dify）
up-all:
	@echo "=== 启动 Dify + 企业自研服务 ==="
	@if [ ! -d "dify" ]; then \
		echo "⚠️  dify/ 目录不存在，请先运行: git clone https://github.com/langgenius/dify.git"; \
		exit 1; \
	fi
	@docker-compose -f dify/docker/docker-compose.yaml -f docker-compose.yml up -d

# 停止全部服务
down-all:
	@echo "=== 停止全部服务 ==="
	@if [ -d "dify" ]; then \
		docker-compose -f dify/docker/docker-compose.yaml -f docker-compose.yml down; \
	fi
	@docker-compose down

logs:
	@docker-compose logs -f

status:
	@docker-compose ps

health:
	@echo "Checking enterprise-tool-service..."
	@curl -sf http://localhost:3100/health >/dev/null && echo "✓ enterprise-tool-service is healthy" || echo "✗ enterprise-tool-service is unhealthy"
	@echo "Checking mcp-wechat..."
	@curl -sf http://localhost:3001/health >/dev/null && echo "✓ mcp-wechat is healthy" || echo "✗ mcp-wechat is unhealthy"

restart:
	@docker-compose restart

clean:
	@docker-compose down -v --rmi local
