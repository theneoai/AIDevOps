.PHONY: init build up down logs status health restart clean up-all down-all dify-up dify-down register-tools devkit-build devkit-test devkit-deploy devkit-status observability-up observability-down security-up security-down standalone-up standalone-down init-secrets

# ─── 初始化 ───
init:
	@test -f .env || cp .env.example .env
	@docker network inspect dify-network >/dev/null 2>&1 || docker network create dify-network
	@echo "=== 初始化完成 ==="
	@echo "下一步:"
	@echo "  1. 编辑 .env 文件，填写必要的配置"
	@echo "  2a. 有 Dify: make up-all"
	@echo "  2b. 无 Dify: make standalone-up"

# ─── 密钥目录初始化 ───
init-secrets:
	@echo "=== 初始化 secrets/ 目录 ==="
	@bash scripts/init-secrets.sh

# ─── 独立模式（无需 Dify 子模块）───
standalone-up:
	@echo "=== 启动独立企业服务栈 (无 Dify 依赖) ==="
	@test -f .env || cp .env.example .env
	@docker network inspect standalone-network >/dev/null 2>&1 || docker network create standalone-network
	@docker compose \
	  -f docker-compose.yml \
	  -f docker-compose.standalone.yml \
	  up enterprise-tool-service mcp-wechat mcp-custom-im ollama devkit -d
	@echo ""
	@echo "=== 独立栈已启动 ==="
	@echo "  Tool Service: http://localhost:3100/health"
	@echo "  MCP WeChat:   http://localhost:3001/health"
	@echo "  MCP Custom:   http://localhost:3005/health"
	@echo "  Ollama:       http://localhost:11434"
	@echo ""
	@echo "DevKit 离线验证:"
	@echo "  make devkit-status   (无需 Dify 连接)"
	@echo "  dify-dev validate --all"

standalone-down:
	@docker compose \
	  -f docker-compose.yml \
	  -f docker-compose.standalone.yml \
	  down

# ─── 构建 ───
build:
	@docker compose build

# ─── 企业自研服务 ───
up:
	@docker compose up -d

down:
	@docker compose down 2>/dev/null || true

logs:
	@docker compose logs -f

status:
	@docker compose ps

health:
	@echo "Checking enterprise-tool-service..."
	@curl -sf http://localhost:3100/health >/dev/null && echo "✓ enterprise-tool-service is healthy" || echo "✗ enterprise-tool-service is unhealthy"
	@echo "Checking mcp-wechat..."
	@curl -sf http://localhost:3001/health >/dev/null && echo "✓ mcp-wechat is healthy" || echo "✗ mcp-wechat is unhealthy"

restart:
	@docker compose restart

clean:
	@docker compose down -v --rmi local

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
	@echo "=== DevKit 组件状态 (本地文件) ==="
	@cd enterprise/dev-kit && npm run dev -- status --offline

devkit-status-online:
	@echo "=== DevKit 组件状态 (Dify API) ==="
	@cd enterprise/dev-kit && npm run dev -- status

# ─── Dify 官方服务 ───
dify-up:
	@echo "=== 启动 Dify 官方服务 ==="
	@if [ ! -d "dify/docker" ]; then \
		echo "⚠️  dify/ 子模块未初始化"; \
		echo "请先运行: git submodule update --init --recursive"; \
		exit 1; \
	fi
	@if [ ! -f "dify/docker/middleware.env" ]; then \
		cp dify/docker/middleware.env.example dify/docker/middleware.env; \
		echo "已创建 middleware.env"; \
	fi
	@cd dify/docker && docker-compose -f docker-compose.yaml -f docker-compose.middleware.yaml up -d
	@echo "=== 连接企业服务到 Dify 网络 ==="
	@sleep 5
	@docker network connect docker_default mcp-wechat 2>/dev/null || docker network disconnect docker_default mcp-wechat 2>/dev/null && docker network connect docker_default mcp-wechat 2>/dev/null || true
	@docker network connect docker_default enterprise-tool-service 2>/dev/null || docker network disconnect docker_default enterprise-tool-service 2>/dev/null && docker network connect docker_default enterprise-tool-service 2>/dev/null || true
	@echo "✓ 企业自研服务已连接到 Dify 网络"
	@echo "=== 自动注册企业自研工具到 Dify ==="
	@sleep 10
	@$(MAKE) register-tools 2>/dev/null || echo "⚠️  工具注册失败，请手动运行: make register-tools"

dify-down:
	@echo "=== 停止 Dify 官方服务 ==="
	@if [ -d "dify/docker" ]; then \
		cd dify/docker && docker compose -f docker-compose.yaml -f docker-compose.middleware.yaml down; \
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

# ─── P1: 可观测性服务 ───
observability-up:
	@echo "=== 启动可观测性服务 (Langfuse + Prometheus + Grafana) ==="
	@docker compose -f docker-compose.yml -f docker-compose.observability.yml up langfuse-server langfuse-db prometheus grafana alertmanager -d
	@echo "✓ 可观测性服务已启动"
	@echo "  Langfuse UI:   http://localhost:3002"
	@echo "  Prometheus:    http://localhost:9090"
	@echo "  Grafana:       http://localhost:3003  (admin/admin)"
	@echo "  Alertmanager:  http://localhost:9093"

observability-down:
	@docker compose -f docker-compose.yml -f docker-compose.observability.yml down langfuse-server langfuse-db prometheus grafana alertmanager

# ─── P2: 安全服务 ───
security-up:
	@echo "=== 启动安全服务 (Presidio PII + Guardrails) ==="
	@docker compose -f docker-compose.yml -f docker-compose.security.yml up presidio-analyzer presidio-anonymizer -d
	@echo "✓ 安全服务已启动"
	@echo "  Presidio Analyzer:   http://localhost:5010"
	@echo "  Presidio Anonymizer: http://localhost:5011"

security-down:
	@docker compose -f docker-compose.yml -f docker-compose.security.yml down presidio-analyzer presidio-anonymizer guardrails

# ─── P3: Docker Swarm ───
swarm-init:
	@echo "=== 初始化 Docker Swarm ==="
	@docker swarm init 2>/dev/null || echo "Already in swarm mode"
	@docker stack deploy -c docker-compose.yml -c docker-compose.swarm.yml aidevops --with-registry-auth
	@echo "✓ Stack deployed. Check: docker stack services aidevops"

swarm-update:
	@echo "=== 滚动更新 Swarm Stack ==="
	@docker stack deploy -c docker-compose.yml -c docker-compose.swarm.yml aidevops --with-registry-auth

swarm-status:
	@docker stack services aidevops

swarm-down:
	@docker stack rm aidevops

# ─── P3: Helm / K8s ───
helm-lint:
	@helm lint helm/aidevops

helm-deploy-staging:
	@helm upgrade --install aidevops helm/aidevops \
	  -f helm/aidevops/values-staging.yaml \
	  --namespace aidevops-staging --create-namespace \
	  --atomic --timeout 5m

helm-deploy-prod:
	@helm upgrade --install aidevops helm/aidevops \
	  -f helm/aidevops/values-prod.yaml \
	  --namespace aidevops-production --create-namespace \
	  --atomic --timeout 10m

# ─── P4: 本地开发栈 ───
dev-up:
	@echo "=== 启动本地开发栈 (企业服务 + Ollama) ==="
	@docker compose -f docker-compose.yml -f docker-compose.dev.yml up enterprise-tool-service mcp-wechat ollama -d
	@echo "✓ 开发栈已启动"
	@echo "  Ollama:       http://localhost:11434"
	@echo "  Tool Service: http://localhost:3100"
	@echo "  MCP WeChat:   http://localhost:3001"
	@echo ""
	@echo "热重载: make devkit-watch"

dev-down:
	@docker compose -f docker-compose.yml -f docker-compose.dev.yml down

ollama-pull:
	@echo "=== 拉取 Ollama 模型: $${OLLAMA_MODEL:-llama3.2:3b} ==="
	@docker exec ollama ollama pull $${OLLAMA_MODEL:-llama3.2:3b}

devkit-watch:
	@echo "=== DevKit 热重载模式 ==="
	@cd enterprise/dev-kit && npm run dev -- watch --verbose

devkit-sync-prompts:
	@echo "=== 从 Langfuse 同步 Prompt ==="
	@cd enterprise/dev-kit && npm run dev -- sync-prompts $(file)

# ─── P5: 生态系统 ───
devkit-search:
	@echo "=== 搜索组件注册表 ==="
	@cd enterprise/dev-kit && npm run dev -- search $(query)

devkit-install:
	@echo "=== 从注册表安装组件 ==="
	@cd enterprise/dev-kit && npm run dev -- install $(name)

devkit-publish:
	@echo "=== 发布组件到注册表 ==="
	@cd enterprise/dev-kit && npm run dev -- publish $(path)

feishu-up:
	@echo "=== 启动 Feishu MCP Server ==="
	@docker compose -f docker-compose.yml up mcp-feishu -d
	@echo "✓ mcp-feishu running on port 3003"

dingtalk-up:
	@echo "=== 启动 DingTalk MCP Server ==="
	@docker compose -f docker-compose.yml up mcp-dingtalk -d
	@echo "✓ mcp-dingtalk running on port 3004"

custom-im-up:
	@echo "=== 启动自定义 IM MCP Server ==="
	@docker compose -f docker-compose.yml up mcp-custom-im -d
	@echo "✓ mcp-custom-im running on port 3005"
	@echo "  /health:   http://localhost:3005/health"
	@echo "  /metrics:  http://localhost:3005/metrics"
	@echo "  SSE:       http://localhost:3005/sse"

custom-im-config:
	@echo "=== 生成自定义 IM 配置文件 ==="
	@cp enterprise/mcp-servers/mcp-custom-im/im-config.example.json enterprise/mcp-servers/mcp-custom-im/im-config.json
	@echo "✓ 配置文件已生成: enterprise/mcp-servers/mcp-custom-im/im-config.json"
	@echo "  请编辑该文件，填写您的 IM 后端信息"

mcp-all-up:
	@echo "=== 启动全部 MCP Servers ==="
	@docker compose -f docker-compose.yml up mcp-wechat mcp-feishu mcp-dingtalk mcp-custom-im -d
	@echo "✓ mcp-wechat:     http://localhost:3001"
	@echo "✓ mcp-feishu:     http://localhost:3003"
	@echo "✓ mcp-dingtalk:   http://localhost:3004"
	@echo "✓ mcp-custom-im:  http://localhost:3005"

registry-validate:
	@echo "=== 验证注册表索引 ==="
	@node -e "const r=require('./registry/index.json'); console.log('Registry v'+r.version+': '+r.components.length+' components'); r.components.forEach(c=>console.log('  '+c.name+'@'+c.version+' ['+c.kind+']'));"
