.PHONY: init build up down logs status health restart clean up-all down-all dify-up dify-down register-tools devkit-build devkit-test devkit-deploy devkit-validate devkit-status observability-up observability-down security-up security-down standalone-up standalone-down init-secrets sso-up sso-down sso-keycloak-up llm-gateway-up llm-gateway-down enterprise-plus-up enterprise-plus-down quota-status scim-test analytics-up register-pipeline pipeline-init pipeline-status

# ─── 初始化 ───
init:
	@test -f .env || cp .env.example .env
	@echo "=== 自动生成安全随机密钥 ==="
	@$(MAKE) _gen-secrets
	@docker network inspect dify-network >/dev/null 2>&1 || docker network create dify-network
	@echo ""
	@echo "=== 初始化完成 ==="
	@echo "下一步:"
	@echo "  1. 编辑 .env 填写业务配置 (DIFY_BASE_URL, WECHAT_APP_ID 等)"
	@echo "  2a. 有 Dify: make up-all"
	@echo "  2b. 无 Dify: make standalone-up"

# 内部目标：将 .env 中所有 changeme/REPLACE_WITH 占位符替换为随机值
_gen-secrets:
	@if command -v openssl >/dev/null 2>&1; then \
	  for placeholder in changeme REPLACE_WITH; do \
	    while grep -q "$$placeholder" .env 2>/dev/null; do \
	      secret=$$(openssl rand -hex 32); \
	      pattern=$$(grep -m1 "$$placeholder" .env | head -c120); \
	      key=$$(echo "$$pattern" | cut -d= -f1); \
	      sed -i "0,/$$placeholder/s/$$placeholder/$$secret/" .env; \
	      echo "  [generated] $$key"; \
	    done; \
	  done; \
	  echo "  ✓ 所有弱默认密钥已替换为随机值"; \
	else \
	  echo "  ⚠️  openssl not found — please manually replace 'changeme' values in .env"; \
	fi

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

# ─── 企业流水线注册 ─────────────────────────────────────────────
# register-pipeline: 手动触发一次流水线注册
# pipeline-init:     同上（别名），与 docker compose 服务名对齐
# pipeline-status:   查看 pipeline-init 容器运行状态与日志
register-pipeline:
	@echo "=== 注册 Enterprise AI DevOps Pipeline 到 Dify ==="
	@echo "  需要在 .env 中配置 DIFY_CONSOLE_EMAIL / DIFY_CONSOLE_PASSWORD"
	@docker compose run --rm pipeline-init
	@echo "✓ 流水线注册完成"
	@echo "  在 Dify UI 刷新页面，搜索 'Enterprise AI DevOps Pipeline' 即可看到流水线"

pipeline-init: register-pipeline

pipeline-status:
	@echo "=== pipeline-init 容器状态 ==="
	@docker compose ps pipeline-init
	@echo ""
	@echo "=== pipeline-init 最近日志 ==="
	@docker compose logs --tail=40 pipeline-init 2>/dev/null || echo "  (容器未运行)"

# ─── DevKit CLI ───
devkit-build:
	@echo "=== 构建 DevKit ==="
	@cd enterprise/dev-kit && npm run build
	@echo "✓ DevKit 构建完成"

devkit-test:
	@echo "=== 运行 DevKit 测试 ==="
	@cd enterprise/dev-kit && npm test
	@echo "✓ DevKit 测试完成"

devkit-validate:
	@echo "=== 验证所有组件 DSL ==="
	@cd enterprise/dev-kit && npm run build --silent
	@node enterprise/dev-kit/dist/cli.js validate --all --level 2 --verbose
	@echo "✓ 所有组件验证通过"

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

down-all: standalone-down dify-down
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

# ─── Enterprise Plus: SSO 认证网关 ───────────────────────────
sso-up:
	@echo "=== 启动 SSO 认证网关 (nginx + oauth2-proxy) ==="
	@echo "  需要设置: SSO_OIDC_ISSUER_URL, SSO_CLIENT_ID, SSO_CLIENT_SECRET, SSO_COOKIE_SECRET"
	@docker compose -f docker-compose.yml -f docker-compose.sso.yml up sso-nginx oauth2-proxy -d
	@echo "✓ SSO 网关已启动"
	@echo "  入口:       http://localhost (通过 SSO 保护)"
	@echo "  OAuth2回调: http://localhost/oauth2/callback"
	@echo ""
	@echo "  如使用自托管 Keycloak: make sso-keycloak-up"

sso-keycloak-up:
	@echo "=== 启动 Keycloak IdP (自托管) ==="
	@docker compose -f docker-compose.yml -f docker-compose.sso.yml --profile keycloak up keycloak keycloak-db -d
	@echo "✓ Keycloak 已启动"
	@echo "  管理控制台: http://localhost:8180/admin (admin/changeme)"
	@echo "  Realm:      dify-enterprise (从模板自动导入)"

sso-down:
	@docker compose -f docker-compose.yml -f docker-compose.sso.yml down sso-nginx oauth2-proxy keycloak keycloak-db 2>/dev/null || true

# ─── Enterprise Plus: LLM 网关 ─────────────────────────────
llm-gateway-up:
	@echo "=== 启动 LLM 网关 (LiteLLM 多模型负载均衡) ==="
	@echo "  需要设置: OPENAI_API_KEY_1, ANTHROPIC_API_KEY 等"
	@docker compose -f docker-compose.yml -f docker-compose.llm-gateway.yml up llm-gateway llm-gateway-db -d
	@echo "✓ LLM 网关已启动"
	@echo "  API:    http://localhost:4000/v1  (OpenAI 兼容)"
	@echo "  Admin:  http://localhost:4000/ui  (LITELLM_MASTER_KEY)"
	@echo "  Metrics: http://localhost:4000/metrics"
	@echo ""
	@echo "  在 Dify 模型配置中将 base_url 设置为 http://llm-gateway:4000"

llm-gateway-down:
	@docker compose -f docker-compose.yml -f docker-compose.llm-gateway.yml down llm-gateway llm-gateway-db

# ─── Enterprise Plus: 配额/SCIM/Analytics ─────────────────
enterprise-plus-up:
	@echo "=== 启动 Enterprise Plus 服务 ==="
	@echo "  包含: 配额管理 + SCIM适配 + 分析聚合"
	@docker compose --profile enterprise-plus up quota-manager quota-db scim-adapter analytics-service -d
	@echo "✓ Enterprise Plus 服务已启动"
	@echo "  配额管理 API:    http://localhost:3006/quotas"
	@echo "  SCIM 2.0 端点:  http://localhost:3007/scim/v2"
	@echo "  分析 Metrics:    http://localhost:3008/metrics"

enterprise-plus-down:
	@docker compose --profile enterprise-plus down quota-manager quota-db scim-adapter analytics-service

# ─── Enterprise Plus: 运维命令 ────────────────────────────
quota-status:
	@echo "=== 当前工作区配额状态 ==="
	@curl -sf -H "Authorization: Bearer $${JWT_TOKEN}" http://localhost:3006/quotas | \
	  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const r=JSON.parse(d); r.data.forEach(ws=>{ console.log(''); console.log('Workspace: '+ws.policy.workspaceId+' ['+ws.status+']'); if(ws.violations.length) ws.violations.forEach(v=>console.log('  EXCEEDED: '+v)); if(ws.warnings.length) ws.warnings.forEach(w=>console.log('  WARNING:  '+w)); if(ws.status==='ok') console.log('  All quotas within limits'); });" 2>/dev/null || \
	  echo "  未能获取配额状态 — 确认 JWT_TOKEN 已设置且 quota-manager 已启动"

scim-test:
	@echo "=== 测试 SCIM 2.0 端点 ==="
	@curl -sf -H "Authorization: Bearer $${SCIM_BEARER_TOKEN}" \
	  http://localhost:3007/scim/v2/ServiceProviderConfig | python3 -m json.tool
	@echo ""
	@echo "=== SCIM Users ==="
	@curl -sf -H "Authorization: Bearer $${SCIM_BEARER_TOKEN}" \
	  http://localhost:3007/scim/v2/Users | python3 -m json.tool
	@echo ""
	@echo "=== SCIM Groups ==="
	@curl -sf -H "Authorization: Bearer $${SCIM_BEARER_TOKEN}" \
	  http://localhost:3007/scim/v2/Groups | python3 -m json.tool

analytics-up:
	@docker compose --profile enterprise-plus up analytics-service -d
	@echo "✓ Analytics service started: http://localhost:3008/metrics"
	@echo "  Grafana仪表盘: 导入 enterprise/analytics/config/grafana-dashboard.json"

# ─── 完整 Enterprise 栈 ────────────────────────────────────
enterprise-full-up: up observability-up enterprise-plus-up
	@echo ""
	@echo "=== 完整 Enterprise 栈已启动 ==="
	@echo "  企业服务:     http://localhost:3100  (tool-service)"
	@echo "  配额管理:     http://localhost:3006/quotas"
	@echo "  SCIM 2.0:    http://localhost:3007/scim/v2"
	@echo "  分析指标:     http://localhost:3008/metrics"
	@echo "  Langfuse:     http://localhost:3002"
	@echo "  Grafana:      http://localhost:3003"
	@echo "  (SSO): make sso-up"
	@echo "  (LLM网关): make llm-gateway-up"

enterprise-health:
	@echo "=== Enterprise 服务健康检查 ==="
	@for port in 3006 3007 3008; do \
	  name=$$(case $$port in 3006) echo "quota-manager";; 3007) echo "scim-adapter";; 3008) echo "analytics";; esac); \
	  curl -sf http://localhost:$$port/health >/dev/null && echo "✓ $$name ($$port) healthy" || echo "✗ $$name ($$port) unhealthy"; \
	done
