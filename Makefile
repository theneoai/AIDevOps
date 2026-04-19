.PHONY: init build up down logs status health restart clean up-all down-all dify-up dify-down

# ─── 初始化 ───
init:
	@test -f .env || cp .env.example .env
	@docker network inspect dify-network >/dev/null 2>&1 || docker network create dify-network
	@echo "=== 初始化完成 ==="
	@echo "下一步:"
	@echo "  1. 编辑 .env 文件，填写必要的配置"
	@echo "  2. 运行: make up-all"

# ─── 构建 ───
build:
	@docker-compose build

# ─── 企业自研服务 ───
up:
	@docker-compose up -d

down:
	@docker-compose down 2>/dev/null || true

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

# ─── Dify 官方服务 ───
dify-up:
	@echo "=== 启动 Dify 官方服务 ==="
	@if [ ! -d "dify/docker" ]; then \
		echo "⚠️  dify/ 子模块未初始化"; \
		echo "请先运行: git submodule update --init --recursive"; \
		exit 1; \
	fi
	@cd dify/docker && docker-compose up -d
	@echo "=== 连接企业服务到 Dify 网络 ==="
	@sleep 5
	@docker network connect docker_default mcp-wechat 2>/dev/null || true
	@docker network connect docker_default enterprise-tool-service 2>/dev/null || true
	@echo "✓ 企业自研服务已连接到 Dify 网络"

dify-down:
	@echo "=== 停止 Dify 官方服务 ==="
	@if [ -d "dify/docker" ]; then \
		cd dify/docker && docker-compose down; \
	fi

# ─── 全部服务（Dify + 企业自研）───
up-all: dify-up up
	@echo ""
	@echo "=== 全部服务已启动 ==="
	@echo "Dify 控制台: http://localhost/install"
	@echo "Dify API:    http://localhost:5001"
	@echo "Tool Service: http://localhost:3100"
	@echo "MCP WeChat:   http://localhost:3001"

down-all: down dify-down
	@echo "=== 全部服务已停止 ==="
