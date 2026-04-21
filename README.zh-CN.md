# AIDevOps — 企业级 Agent 应用框架

> **Language / 语言:** [English](README.md) | 中文

基于开源社区版 [Dify](https://github.com/langgenius/dify) 构建的企业级 Agent 应用框架，采用**零侵入架构**——所有企业自研逻辑独立成层，Dify 以 Git 子模块方式引入，从不修改其源码。

---

## 目录

- [项目简介](#项目简介)
- [架构设计](#架构设计)
- [核心特性](#核心特性)
- [用户快速开始](#用户快速开始)
- [开发者快速开始](#开发者快速开始)
- [项目结构](#项目结构)
- [常用命令](#常用命令)
- [与 Dify 集成](#与-dify-集成)
- [CI/CD 流水线](#cicd-流水线)
- [配置参考](#配置参考)
- [许可证](#许可证)

---

## 项目简介

AIDevOps 提供了基于 Dify 的 AI 应用**代码驱动开发（Code-Driven Development, CDD）**工作流。团队以 YAML DSL 声明组件（Tool、MCP Server、Workflow、Skill），用 TypeScript 实现业务逻辑，由 DevKit CLI 完成注册、校验和部署到 Dify。

**核心原则：零侵入 Dify 源码。**

Dify 以 `git submodule` 方式引入，绝不修改。企业能力在 `/enterprise` 层独立开发，通过 Dify 公开 API Adapter 与 Dify 集成。

---

## 架构设计

```
┌─────────────────────────────────────────────────────┐
│                   企业自研层 (Enterprise Layer)        │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  DevKit CLI │  │  Tool 服务   │  │MCP Servers│  │
│  │  (YAML DSL) │  │  (REST API)  │  │ (SSE/MCP) │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                │                │         │
│  ┌──────▼────────────────▼────────────────▼──────┐  │
│  │         Dify API Adapter（API 优先模式）        │  │
│  └──────────────────────┬──────────────────────┬─┘  │
└─────────────────────────│──────────────────────│───┘
                          │                      │
┌─────────────────────────▼──────────────────────▼───┐
│                Dify（git submodule，零侵入）          │
│      控制台 · API Server · Worker · 数据库            │
└─────────────────────────────────────────────────────┘
```

**关键架构决策：**
- **Dify 作为子模块** — 通过更新 `DIFY_VERSION` 升级，无合并冲突
- **API 优先 Adapter** — 所有 Dify 交互通过 REST API，生产环境不直接写数据库
- **声明式 YAML DSL** — 组件即代码，纳入 Git 版本管理
- **混合加密** — 完整复现 RSA+AES 加密方案，与 Dify 内部机制兼容

---

## 核心特性

| 类别 | 特性 |
|---|---|
| **CDD** | YAML DSL 声明 Tool、MCP Server、Workflow、Skill |
| **DevKit CLI** | `create`、`deploy`、`validate`、`registry`、`status`、`watch` 命令 |
| **MCP Servers** | 微信公众号、飞书、钉钉、自定义 IM |
| **安全** | JWT RBAC（4 级角色）、PII 检测（Presidio）、Prompt 注入防护 |
| **加密** | RSA+AES 混合加密，兼容 Dify 内部机制 |
| **可观测性** | Langfuse 链路追踪、OpenTelemetry、Prometheus 监控 |
| **Kubernetes** | Helm Charts、HPA、NetworkPolicy、ArgoCD GitOps |
| **CI/CD** | 7 阶段 GitHub Actions 流水线，生产部署支持 HITL 审批 |

---

## 用户快速开始

> 只想运行企业工具栈——无需安装 Dify。

**环境要求：** Docker & Docker Compose v2（`docker compose` 插件版）、Node.js 20+（最低 18，推荐 20 LTS）、npm 8+

### 1. 克隆仓库

```bash
git clone https://github.com/theneoai/aidevops.git
cd aidevops
```

> 如需完整 Dify 服务栈（`make up-all`）才需要初始化子模块；独立模式无需子模块。

### 2. 初始化（自动生成密钥）

```bash
make init
```

此命令将 `.env.example` 复制为 `.env`，并通过 `openssl rand -hex 32` 将所有占位符替换为加密安全随机值。

### 3. 配置

```bash
# 编辑 .env — 已生成的密钥值是安全默认值
# 仅在需要连接已有 Dify 实例时填写：
#   DIFY_BASE_URL=https://your-dify.example.com
#   DIFY_API_KEY=your-api-key
vim .env
```

### 4. 启动企业服务（独立模式，无需 Dify）

```bash
make standalone-up
```

启动的服务：
- 企业 Tool Service：http://localhost:3100/health
- 微信 MCP Server：http://localhost:3001/health
- 自定义 IM MCP Server：http://localhost:3005/health
- Ollama（本地 LLM）：http://localhost:11434

### 5. 健康检查

```bash
make health
```

### 连接已有 Dify 实例

在 `.env` 中设置 `DIFY_BASE_URL` 和 `DIFY_API_KEY`，然后：

```bash
make up               # 启动企业自研服务
make devkit-validate  # 对接 Dify 校验所有组件
```

### 启动完整服务栈（Dify + 企业自研）

```bash
git submodule update --init --recursive   # 初始化 Dify 子模块
make up-all
```

Dify 控制台：http://localhost/install

---

## 开发者快速开始

> 构建新的 AI 组件（Tool、MCP Server、Workflow）并部署到 Dify。

**额外环境要求：** Python 3 + `pycryptodome`（MCP 凭证加密所需）：

```bash
pip install pycryptodome
```

### 1. 先完成上方的用户快速开始

### 2. 安装 DevKit CLI 依赖

```bash
cd enterprise/dev-kit
npm install
npm run build
cd ../..
```

### 3. 校验现有组件

```bash
make devkit-validate
# 等效命令：node enterprise/dev-kit/dist/cli.js validate --all --level 2 --verbose
```

### 4. 创建新组件

```bash
node enterprise/dev-kit/dist/cli.js create tool my-api-tool
```

编辑生成的 `enterprise/components/my-api-tool.yml`：

```yaml
apiVersion: v1
kind: Tool
metadata:
  name: my-api-tool
  version: "1.0.0"
  labels: [api]
spec:
  type: api
  server: http://tool-service:3100
  authentication:
    type: api_key
    keyName: X-API-Key
    keyLocation: header
  endpoints:
    - path: /v1/my-endpoint
      method: GET
      operationId: myEndpoint
      inputs:
        - name: query
          type: string
          required: true
          description: "查询参数"
```

### 5. 校验并部署

```bash
# 校验 DSL
node enterprise/dev-kit/dist/cli.js validate enterprise/components/my-api-tool.yml

# 部署到 Dify（需要 .env 中的 DIFY_BASE_URL + DIFY_API_KEY）
make devkit-deploy name=my-api-tool
```

### 6. 新增 MCP Server

```bash
cp -r enterprise/mcp-servers/mcp-template enterprise/mcp-servers/mcp-myservice

# 在 src/index.ts 中实现工具逻辑
# 在 src/config.ts 中通过 readSecret() 管理凭证
# 确保 /health 和 /metrics 端点存在
# 在 docker-compose.yml 中添加服务配置
# 在 registry/index.json 中注册组件规范
```

### 7. 运行测试

```bash
# 单元测试
make devkit-test

# 类型检查
cd enterprise/dev-kit && npm run typecheck

# 使用本地 Ollama（避免 LLM API 费用）
USE_LOCAL_LLM=true make devkit-test
```

### VSCode 扩展

从 `vscode-dify-dev/` 安装。功能包括：
- `dify-dsl` 文件 YAML 语法高亮
- 保存时自动进行 Schema 校验
- `Cmd+Shift+D` — 部署组件到 Dify
- 命令面板：`Dify: Validate`、`Dify: Watch`

---

## 项目结构

```
.
├── DIFY_VERSION                    # 锁定的 Dify 子模块 SHA
├── Makefile                        # 统一命令入口（100+ 目标）
├── .env.example                    # 环境变量模板
├── docker-compose.yml              # 企业自研服务编排
├── docker-compose.dev.yml          # 开发环境覆盖配置
├── docker-compose.observability.yml# Prometheus + Grafana + Langfuse
├── docker-compose.security.yml     # Presidio PII 检测服务栈
├── docker-compose.swarm.yml        # Docker Swarm 部署配置
│
├── enterprise/                     # 企业自研层
│   ├── dev-kit/                    # DevKit CLI（TypeScript）
│   │   ├── src/
│   │   │   ├── cli.ts              # CLI 入口
│   │   │   ├── commands/           # CLI 命令（7 个）
│   │   │   ├── compilers/          # DSL → Dify JSON 编译器
│   │   │   ├── adapters/           # IDifyAdapter 实现
│   │   │   ├── core/               # 解析器、配置、编排器、HITL
│   │   │   ├── types/              # DSL + Dify TypeScript 类型定义
│   │   │   └── audit/              # 审计日志服务
│   │   └── tests/                  # 单元测试 + 契约测试
│   │
│   ├── tool-service/               # 通用 REST API Tool 服务
│   │   └── src/
│   │       ├── middleware/         # RBAC + 提示注入防护
│   │       ├── routes/             # health + tools 端点
│   │       └── pii/                # Presidio PII 客户端
│   │
│   ├── mcp-servers/                # MCP Server 集群
│   │   ├── mcp-wechat/             # 微信公众号
│   │   ├── mcp-feishu/             # 飞书
│   │   ├── mcp-dingtalk/           # 钉钉
│   │   ├── mcp-custom-im/          # 通用 IM（Webhook / 配置文件）
│   │   └── mcp-template/           # MCP 脚手架模板
│   │
│   ├── components/                 # 组件 YAML 定义与模板
│   ├── workflows/                  # Workflow 模板库
│   ├── skills/                     # Skill 配置库
│   └── scripts/                    # 初始化、健康检查、工具注册脚本
│
├── dify/                           # Dify（git 子模块，禁止修改）
├── docs/                           # 项目文档
├── helm/                           # Kubernetes Helm Charts
├── argocd/                         # ArgoCD GitOps ApplicationSet
├── prometheus/                     # Prometheus + Alertmanager 配置
├── registry/                       # 组件注册表索引
└── vscode-dify-dev/                # VSCode 扩展（校验 + 部署）
```

---

## 常用命令

### Make 命令

| 命令 | 说明 |
|---|---|
| `make init` | 初始化项目（自动生成密钥、创建网络） |
| `make standalone-up` | 启动企业自研服务（无需 Dify） |
| `make up` | 启动企业自研服务（需要 Dify） |
| `make down` | 停止企业自研服务 |
| `make up-all` | 启动全部服务（Dify + 企业自研） |
| `make down-all` | 停止全部服务 |
| `make dify-up` | 启动 Dify 服务 |
| `make dify-down` | 停止 Dify 服务 |
| `make logs` | 查看企业自研服务日志 |
| `make status` | 查看服务容器状态 |
| `make health` | 运行健康检查 |
| `make restart` | 重启企业自研服务 |
| `make clean` | 清理容器和镜像 |
| `make devkit-build` | 构建 DevKit CLI |
| `make devkit-test` | 运行 DevKit 单元测试 |
| `make devkit-validate` | 校验所有组件（构建后校验） |
| `make devkit-status` | 查看组件状态（离线，无需 Dify） |
| `make observability-up` | 启动监控服务栈（Langfuse + Prometheus + Grafana） |
| `make security-up` | 启动 PII 检测服务栈（Presidio） |
| `make mcp-all-up` | 启动全部 MCP Servers |
| `make dev-up` | 启动本地开发栈（热重载） |

### DevKit CLI 命令

通过 `node enterprise/dev-kit/dist/cli.js <命令>` 执行（开发时可用 `npm run dev -- <命令>`）。

**全局参数：** `-c, --config <路径>` · `-v, --verbose` · `--dry-run` · `--tenant <名称>`

| 命令 | 说明 |
|---|---|
| `create tool <名称> [-t api\|mcp]` | 生成新的 Tool 组件 YAML 脚手架 |
| `deploy <名称>` | 编译并向 Dify 注册组件 |
| `validate [名称] [--all] [-l 1\|2\|3]` | 校验 DSL（1=Schema，2=语义，3=注册表引用） |
| `status [--offline]` | 显示组件同步状态；`--offline` 跳过 Dify 连接 |
| `test <名称> [-i key=val] [--mock-file]` | 以 Mock 响应对 Workflow/Orchestration 做空跑 |
| `watch [-p glob] [-d ms]` | 文件变更时自动热部署组件 |
| `sync-prompts <component.yml>` | 从 Langfuse 拉取最新 Prompt 版本写入 DSL |
| `search <关键词>` | 检索组件注册表 |
| `install <名称[@版本]>` | 从注册表安装组件 |
| `publish <路径>` | 将组件发布到注册表（先执行质量门控） |

---

## 与 Dify 集成

### 将企业服务接入 Dify

**方式一：Dify 插件（推荐，功能完整）**

Dify 1.0+ 使用插件系统扩展能力，将企业自研服务打包为插件：

```bash
# 安装 Dify Plugin CLI
pip install dify-plugin-cli

# 在本仓库外创建插件目录
mkdir my-enterprise-plugin && cd my-enterprise-plugin
dify plugin init   # 选择：Tool 类型，Server 地址指向 http://enterprise-tool-service:3100

# 打包并安装
dify plugin package .
# 在 Dify → Plugins → Install Plugin → 上传 .difypkg 文件
```

**方式二：外部 API Tool（简单，功能受限）**

1. Dify → Tools → Custom → 添加 HTTP API
2. URL：`http://enterprise-tool-service:3100/...`
3. 配置 MCP：Dify → Tools → MCP → 添加 MCP Server (HTTP/SSE)
   - Server URL：`http://mcp-wechat:3001/sse`

### 服务访问地址

| 服务 | 地址 |
|---|---|
| Dify 控制台 | http://localhost/install |
| Dify API | http://localhost:5001 |
| 企业 Tool Service | http://localhost:3100 |
| 微信 MCP | http://localhost:3001/sse |
| 飞书 MCP | http://localhost:3003/sse |
| 钉钉 MCP | http://localhost:3004/sse |
| 自定义 IM MCP | http://localhost:3005/sse |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 |

### Dify 版本管理

```bash
# 查看当前锁定版本
cat DIFY_VERSION

# 升级 Dify 子模块
cd dify && git fetch origin && git checkout <new-sha>
cd .. && echo "<new-sha>" > DIFY_VERSION

# 触发 CI 兼容性检查
git commit -m "chore: upgrade dify submodule [dify-upgrade]"
```

CI 流水线检测到提交消息中包含 `[dify-upgrade]` 时，会自动运行契约测试。

---

## CI/CD 流水线

流水线包含 7 个阶段。完整说明见 [GitHub Actions 文档](docs/github-actions.md)。

```
                    validate
                   /    |    \
         dify-compat  test-unit  security   （并行；dify-compat 仅在 [dify-upgrade] 提交时运行）
                          \       /
                           build
                             |
                      deploy-staging
                             |
                    integration-tests
                             |
                    deploy-production  （HITL 审批门控）
```

**手动触发**支持选择部署目标（`deploy_env`: staging/production）以及跳过测试（`skip_tests`: 紧急部署）。

---

## 配置参考

将 `.env.example` 复制为 `.env` 并填写必要配置。

| 变量 | 必填 | 说明 |
|---|---|---|
| `DIFY_BASE_URL` | 是 | Dify API 基础 URL |
| `DIFY_API_KEY` | 是 | Dify 控制台 API 密钥 |
| `JWT_SECRET` | 是 | JWT 签名密钥（RBAC） |
| `STANDALONE_MODE` | 否 | `true` 则禁用 Dify 注册 |
| `LANGFUSE_PUBLIC_KEY` | 否 | Langfuse 可观测性 |
| `PRESIDIO_ANALYZER_URL` | 否 | PII 检测端点 |
| `WECHAT_APP_ID` | 否 | 微信公众号 App ID |
| `FEISHU_APP_ID` | 否 | 飞书 App ID |
| `DINGTALK_APP_KEY` | 否 | 钉钉 App Key |

完整列表及说明见 `.env.example`。

---

## 许可证

[MIT](LICENSE)
