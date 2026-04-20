# Dify DevKit

> **Language / 语言:** English | [中文](#中文文档)

Dify DevKit is a CLI tool for **Code-Driven Development (CDD)** of Dify components — Tools, MCP Servers, Workflows, Agents, and Knowledge bases — using a declarative YAML DSL backed by TypeScript implementation.

---

## Features

- **Zero-intrusion** — integrates with Dify through the public REST API; no source code modifications
- **Declarative YAML DSL** — define components as code, version them in Git
- **Auto-registration** — one-command deploy to Dify; no manual UI configuration
- **Hybrid encryption** — full RSA+AES encryption compatible with Dify's internal scheme
- **Human-In-The-Loop (HITL)** — workflow nodes with approval gates
- **Observability** — Langfuse + OpenTelemetry tracing built-in

---

## Quick Start

```bash
cd enterprise/dev-kit
npm install
npm run build

# Create a new API tool
node dist/cli.js create tool my-tool --type api

# Validate all components
node dist/cli.js validate --all

# Deploy a component to Dify
DIFY_BASE_URL=http://localhost:5001 DIFY_API_KEY=<key> \
  node dist/cli.js deploy my-tool

# Check registered components
node dist/cli.js status
```

---

## Configuration

Create `dify-dev.yaml` in the project root:

```yaml
dify:
  apiUrl: "${DIFY_BASE_URL:-http://localhost:5001}"
  consoleUrl: "${DIFY_CONSOLE_URL:-http://localhost}"

componentsDir: "./enterprise/components"
```

> The DB adapter (`dify.db.*`) is deprecated. Use API adapter (`dify.apiUrl` + `DIFY_API_KEY` env var) for all new deployments.

---

## CLI Commands

### `create <kind> <name>`

Scaffold a new component from a template.

```bash
dify-dev create tool weather-api --type api
dify-dev create tool wechat-mcp --type mcp
```

**Options:**
- `-t, --type <type>` — `api` or `mcp` (default: `api`)

### `validate [name]`

Validate component DSL — schema + semantic checks.

```bash
# Validate all components
node dist/cli.js validate --all --level 2

# Validate a specific component (strict)
node dist/cli.js validate weather-api --level 3 --verbose
```

**Validation levels:**
- `1` — schema only
- `2` — schema + semantic (default)
- `3` — schema + semantic + Dify API connectivity check

### `deploy <name>`

Compile DSL and register component with Dify.

```bash
node dist/cli.js deploy weather-api --verbose
```

### `registry`

Manage the component registry (`registry/index.json`).

```bash
node dist/cli.js registry list
node dist/cli.js registry add weather-api
node dist/cli.js registry remove old-tool
```

### `status`

Show all registered components and their Dify sync state.

```bash
node dist/cli.js status
```

### `watch`

Watch component files and auto-validate on change.

```bash
node dist/cli.js watch --all
```

### `sync-prompts`

Sync prompt templates from Dify to local files.

```bash
node dist/cli.js sync-prompts
```

---

## YAML DSL Reference

### API Tool

```yaml
apiVersion: v1
kind: Tool
metadata:
  name: weather-api
  description: "Weather query API"
  icon: "🌤️"
  version: "1.0.0"
  author: "enterprise"
  labels: [api, weather]
spec:
  type: api
  server: http://tool-service:3100
  authentication:
    type: api_key
    keyName: X-API-Key
    keyLocation: header
  endpoints:
    - path: /v1/current
      method: GET
      operationId: getCurrentWeather
      summary: "Get current weather"
      inputs:
        - name: city
          type: string
          required: true
          description: "City name"
      outputs:
        - name: temperature
          type: number
        - name: condition
          type: string
```

### MCP Tool

```yaml
apiVersion: v1
kind: Tool
metadata:
  name: wechat-publisher
  description: "WeChat Official Account publishing"
  icon: "📰"
  version: "1.0.0"
  author: "enterprise"
  labels: [mcp, wechat]
spec:
  type: mcp
  server: http://mcp-wechat:3001/sse
  tools:
    - name: publish_article
      description: "Publish a WeChat article"
      inputs:
        - name: title
          type: string
          required: true
        - name: content
          type: string
          required: true
      outputs:
        - name: article_id
          type: string
```

### Workflow

```yaml
apiVersion: v1
kind: Workflow
metadata:
  name: content-review
  version: "1.0.0"
spec:
  nodes:
    - id: llm_review
      type: llm
      model: gpt-4o
      prompt: "Review the following content for policy compliance: {{content}}"
    - id: human_gate
      type: human-in-loop
      approvers: ["@content-team"]
      timeout: 3600
    - id: publish
      type: tool
      tool: wechat-publisher/publish_article
```

---

## Project Structure

```
enterprise/dev-kit/
├── src/
│   ├── cli.ts                      # CLI entry point
│   ├── commands/                   # CLI commands (7)
│   │   ├── create.ts               # Scaffold new component
│   │   ├── deploy.ts               # Deploy to Dify
│   │   ├── validate.ts             # DSL validation
│   │   ├── registry.ts             # Registry management
│   │   ├── status.ts               # Component status
│   │   ├── watch.ts                # File watcher
│   │   └── sync-prompts.ts         # Prompt sync
│   ├── compilers/                  # DSL → Dify JSON
│   │   ├── workflow-compiler.ts
│   │   ├── agent-compiler.ts
│   │   ├── knowledge-compiler.ts
│   │   └── node-builders/          # Individual Dify node builders
│   │       ├── llm-node.ts
│   │       ├── tool-node.ts
│   │       ├── condition-node.ts
│   │       └── human-in-loop-node.ts
│   ├── adapters/                   # Dify integration adapters
│   │   ├── dify-adapter.interface.ts
│   │   ├── dify-api-adapter.ts     # REST API (recommended)
│   │   └── dify-db-adapter.ts      # Direct DB (deprecated)
│   ├── core/
│   │   ├── config.ts               # Configuration (YAML parsing)
│   │   ├── parser.ts               # DSL YAML parser
│   │   ├── compiler.ts             # Generic DSL compiler
│   │   ├── component-registry.ts   # Registry management
│   │   ├── workflow-parser.ts
│   │   ├── workflow-compiler.ts
│   │   ├── agent-orchestrator.ts   # Agent composition
│   │   ├── observability.ts        # Langfuse/OTEL integration
│   │   └── hitl.ts                 # Human-In-The-Loop support
│   ├── registry/
│   │   ├── crypto.ts               # RSA+AES hybrid encryption
│   │   ├── db-client.ts            # PostgreSQL client
│   │   ├── dify-client.ts          # Dify REST client
│   │   └── backend.ts              # Backend switching (Dify/Langflow)
│   ├── types/
│   │   ├── dsl.ts                  # Component DSL TypeScript interfaces
│   │   └── dify.ts                 # Dify internal API types
│   ├── utils/
│   │   └── llm-adapter.ts          # LLM provider abstraction
│   └── audit/
│       └── audit-service.ts        # Audit logging
├── tests/
│   ├── agent-orchestrator.test.ts
│   ├── compiler.test.ts
│   ├── component-registry.test.ts
│   ├── crypto.test.ts
│   ├── dify-api-adapter.test.ts
│   ├── parser.test.ts
│   ├── workflow-compiler.test.ts
│   ├── workflow-parser.test.ts
│   └── contract/
│       ├── dify-api.contract.test.ts
│       └── dify-schema.contract.test.ts
├── scripts/
│   └── encrypt_helper.py           # Python AES-EAX encryption helper
├── Dockerfile
├── dify-dev.yaml                   # Example configuration
└── package.json
```

---

## Architecture

### Registration Flow

```
YAML DSL
    │
    ▼  Parse
TypeScript Objects (validated)
    │
    ▼  Compile
Dify API payload / JSON
    │
    ▼  Register (via IDifyAdapter)
Dify (tool_providers / workflows tables)
```

### Encryption Scheme

Dify uses RSA+AES hybrid encryption for sensitive config fields (`server_url`, `credentials`, `headers`). DevKit replicates this exactly:

1. Generate random 16-byte AES key
2. Encrypt data with AES-128-EAX
3. Encrypt AES key with RSA-OAEP (SHA-1)
4. Concatenate: `HYBRID:` + `rsa_encrypted_key (256B)` + `nonce (16B)` + `tag (16B)` + `ciphertext`
5. Base64 encode

> Node.js native `crypto` doesn't support AES-EAX mode. DevKit uses `scripts/encrypt_helper.py` as a subprocess for this step.

### Adapter Pattern

`IDifyAdapter` abstracts Dify integration with two implementations:

| Adapter | Method | Status |
|---|---|---|
| `DifyApiAdapter` | REST API (`DIFY_BASE_URL` + `DIFY_API_KEY`) | **Recommended** |
| `DifyDbAdapter` | Direct PostgreSQL writes | Deprecated — bypasses API auth |

---

## Development

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Local development (ts-node)
npm run dev -- create tool test-tool --type api

# Build
npm run build
```

---

---

## 中文文档

Dify DevKit 是一个 CLI 工具，通过**代码驱动开发（Code-Driven Development, CDD）**方式管理 Dify 组件（Tool、MCP Server、Workflow、Agent、知识库），以声明式 YAML DSL 定义组件，TypeScript 实现业务逻辑。

### 快速开始

```bash
cd enterprise/dev-kit
npm install
npm run build

# 创建新的 API Tool
node dist/cli.js create tool my-tool --type api

# 校验所有组件
node dist/cli.js validate --all

# 部署组件到 Dify
DIFY_BASE_URL=http://localhost:5001 DIFY_API_KEY=<key> \
  node dist/cli.js deploy my-tool

# 查看已注册组件状态
node dist/cli.js status
```

### 配置文件

在项目根目录创建 `dify-dev.yaml`：

```yaml
dify:
  apiUrl: "${DIFY_BASE_URL:-http://localhost:5001}"
  consoleUrl: "${DIFY_CONSOLE_URL:-http://localhost}"

componentsDir: "./enterprise/components"
```

> DB Adapter（`dify.db.*`）已废弃。新部署请使用 API Adapter（`dify.apiUrl` + `DIFY_API_KEY` 环境变量）。

### CLI 命令速查

| 命令 | 说明 |
|---|---|
| `create <kind> <name>` | 从模板创建新组件 |
| `validate [name]` | 校验组件 DSL（Schema + 语义） |
| `deploy <name>` | 编译并注册组件到 Dify |
| `registry list/add/remove` | 管理组件注册表 |
| `status` | 显示所有组件及 Dify 同步状态 |
| `watch` | 监听文件变更自动校验 |
| `sync-prompts` | 从 Dify 同步 Prompt 模板 |

### 架构说明

**注册流程：** YAML DSL → Parse → TypeScript 对象 → Compile → Dify API Payload → Register

**加密方案：** Dify 使用 RSA+AES 混合加密保护敏感字段。DevKit 完整复现该算法：

1. 生成随机 16 字节 AES 密钥
2. AES-128-EAX 加密数据
3. RSA-OAEP (SHA-1) 加密 AES 密钥
4. 拼接：`HYBRID:` + RSA 加密密钥(256B) + nonce(16B) + tag(16B) + 密文
5. Base64 编码

> Node.js 原生 `crypto` 不支持 AES-EAX 模式，DevKit 通过子进程调用 `scripts/encrypt_helper.py` 完成此步骤。
