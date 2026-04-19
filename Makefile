.PHONY: init build up down logs status health restart clean up-all down-all dify-up dify-down register-tools devkit-build devkit-test devkit-deploy devkit-status

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

# ─── 工具注册 ───
register-tools:
	@echo "=== 注册企业自研工具到 Dify ==="
	@docker cp enterprise/scripts/register-tools.py docker-api-1:/tmp/register-tools.py
	@docker exec docker-api-1 python3 /tmp/register-tools.py
	@echo "✓ 工具注册完成"

# ─── DevKit CLI ───
devkit-build:
	@echo "=== 构建 DevKit ==="
	@cd enterprise/dev-kit && npm run build
	@echo "✓ DevKit 构建完成"

devkit-test:
	@echo "=== 运行 DevKit 测试 ==="
	@cd enterprise/dev-kit && npm test
	@echo "✓ DevKit 测试完成"

devkit-deploy:
	@echo "=== 使用 DevKit 部署组件 ==="
	@cd enterprise/dev-kit && npm run dev -- deploy $(name)

devkit-status:
	@echo "=== DevKit 组件状态 ==="
	@cd enterprise/dev-kit && npm run dev -- status

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
	@echo "=== 自动注册企业自研工具到 Dify ==="
	@sleep 10
	@$(MAKE) register-tools 2>/dev/null || echo "⚠️  工具注册失败，请手动运行: make register-tools"

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
	@echo ""
	@echo "企业自研工具已自动注册到 Dify，无需手动配置"
	@echo "刷新 Dify UI 即可在 Tools 中看到："
	@echo "  - 微信公众号发布 (MCP)"
	@echo "  - 企业通用工具服务 (API)"
	@echo ""
	@echo "DevKit 命令:"
	@echo "  make devkit-status    查看组件状态"
	@echo "  make devkit-deploy name=xxx  部署组件"

down-all: down dify-down
	@echo "=== 全部服务已停止 ==="
