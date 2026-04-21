# AIDevOps — Enterprise Agent Framework

> **Language / 语言:** English | [中文](README.zh-CN.md)

Enterprise-grade Agent application framework built on top of open-source [Dify](https://github.com/langgenius/dify), with zero-intrusion architecture — all enterprise logic lives in a separate layer; Dify is included as a git submodule and never modified.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Development Guide](#development-guide)
- [Commands Reference](#commands-reference)
- [Dify Integration](#dify-integration)
- [CI/CD Pipeline](#cicd-pipeline)
- [Configuration Reference](#configuration-reference)
- [License](#license)

---

## Overview

AIDevOps provides a **Code-Driven Development (CDD)** workflow for Dify-based AI applications. Teams declare components (Tools, MCP Servers, Workflows, Skills) as YAML DSL, implement business logic in TypeScript, and let the DevKit CLI handle registration, validation, and deployment to Dify.

**Core Principle: Zero-intrusion into Dify source code.**

Dify is included as a `git submodule` and is never modified. Enterprise capabilities are developed in the `/enterprise` layer and integrated with Dify through its public API adapter.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Enterprise Layer                   │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  DevKit CLI │  │ Tool Service │  │MCP Servers│  │
│  │  (YAML DSL) │  │  (REST API)  │  │ (SSE/MCP) │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                │                │         │
│  ┌──────▼────────────────▼────────────────▼──────┐  │
│  │           Dify API Adapter (API-first)         │  │
│  └──────────────────────┬──────────────────────┬─┘  │
└─────────────────────────│──────────────────────│───┘
                          │                      │
┌─────────────────────────▼──────────────────────▼───┐
│                    Dify (submodule)                  │
│         Console · API Server · Worker · DB           │
└─────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **Dify as submodule** — upgrade by bumping `DIFY_VERSION`, no merge conflicts
- **API-first adapter** — all Dify interactions through REST API, no direct DB writes in production
- **Declarative YAML DSL** — components defined as code, versioned in Git
- **Hybrid encryption** — full RSA+AES encryption compatible with Dify's internal scheme

---

## Features

| Category | Feature |
|---|---|
| **CDD** | YAML DSL for Tools, MCP Servers, Workflows, Skills |
| **DevKit CLI** | `create`, `deploy`, `validate`, `registry`, `status`, `watch` commands |
| **MCP Servers** | WeChat (微信), Feishu (飞书), DingTalk (钉钉), Custom IM |
| **Security** | JWT RBAC (4 tiers), PII detection (Presidio), prompt injection guard |
| **Encryption** | RSA+AES hybrid encryption, Dify-compatible |
| **Observability** | Langfuse tracing, OpenTelemetry, Prometheus metrics |
| **Kubernetes** | Helm charts, HPA, NetworkPolicy, ArgoCD GitOps |
| **CI/CD** | 7-stage GitHub Actions pipeline with HITL production gate |

---

## Quick Start

### Prerequisites

- Docker & Docker Compose v2 (`docker compose` plugin)
- Node.js 18+ with npm 8+ (for DevKit CLI development)
- Python 3 + `pycryptodome` — required for MCP Server credential encryption:
  ```bash
  pip install pycryptodome
  ```
- Make (optional, simplifies commands — all targets also work as raw `docker compose` / `node` commands)

### 1. Clone with submodules

```bash
git clone --recursive https://github.com/theneoai/aidevops.git
cd aidevops

# If already cloned without submodules:
git submodule update --init --recursive
```

### 2. Initialize

```bash
make init
# or
./enterprise/scripts/init.sh
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set DIFY_BASE_URL and DIFY_API_KEY
vim .env
```

### 4. Build and start

```bash
# Enterprise services only (no Dify)
make up

# Enterprise + Dify (full stack)
make up-all
```

### 5. Verify health

```bash
make health
```

### 6. Build DevKit CLI

```bash
make devkit-build

# Validate all components
make devkit-validate
```

---

## Project Structure

```
.
├── DIFY_VERSION                    # Pinned Dify submodule SHA
├── Makefile                        # Unified command shortcuts (100+ targets)
├── .env.example                    # Environment variable template
├── docker-compose.yml              # Enterprise services orchestration
├── docker-compose.dev.yml          # Development overrides
├── docker-compose.observability.yml# Prometheus + Grafana + Langfuse
├── docker-compose.security.yml     # Presidio PII detection stack
├── docker-compose.swarm.yml        # Docker Swarm deployment
│
├── enterprise/                     # Enterprise self-developed layer
│   ├── dev-kit/                    # DevKit CLI (TypeScript)
│   │   ├── src/
│   │   │   ├── cli.ts              # CLI entry point
│   │   │   ├── commands/           # CLI commands (7)
│   │   │   ├── compilers/          # DSL → Dify JSON compilers
│   │   │   ├── adapters/           # IDifyAdapter implementations
│   │   │   ├── core/               # Parser, config, orchestrator, HITL
│   │   │   ├── types/              # DSL + Dify TypeScript types
│   │   │   └── audit/              # Audit logging service
│   │   └── tests/                  # Unit + contract tests
│   │
│   ├── tool-service/               # Generic REST API Tool service
│   │   └── src/
│   │       ├── middleware/         # RBAC + prompt-guard
│   │       ├── routes/             # health + tools endpoints
│   │       └── pii/                # Presidio PII client
│   │
│   ├── mcp-servers/                # MCP Server implementations
│   │   ├── mcp-wechat/             # WeChat Official Account
│   │   ├── mcp-feishu/             # Feishu / Lark
│   │   ├── mcp-dingtalk/           # DingTalk
│   │   ├── mcp-custom-im/          # Generic IM (webhook / config)
│   │   └── mcp-template/           # Scaffold for new MCP servers
│   │
│   ├── components/                 # Component YAML definitions + templates
│   ├── workflows/                  # Workflow template library
│   ├── skills/                     # Skill configuration library
│   └── scripts/                    # Init, health-check, tool registration
│
├── dify/                           # Dify (git submodule — do not modify)
├── docs/                           # Project documentation
├── helm/                           # Kubernetes Helm charts
├── argocd/                         # ArgoCD GitOps ApplicationSet
├── prometheus/                     # Prometheus + Alertmanager config
├── registry/                       # Component registry index
└── vscode-dify-dev/                # VSCode extension (validate + deploy)
```

---

## Development Guide

### Adding a New MCP Server

```bash
# 1. Copy the scaffold template
cp -r enterprise/mcp-servers/mcp-template enterprise/mcp-servers/mcp-yourservice

# 2. Implement tools in src/index.ts
# 3. Add credentials via readSecret() in src/config.ts
# 4. Ensure /health and /metrics endpoints are present
# 5. Add service to docker-compose.yml
# 6. Register a component spec in registry/index.json
```

### Adding a New Tool (REST)

Add a route file under `enterprise/tool-service/src/routes/` following the pattern in `tools.ts`.

### Adding a New CLI Command

```bash
# 1. Create enterprise/dev-kit/src/commands/<name>.ts
# 2. Export async function <name>Command(...)
# 3. Register in enterprise/dev-kit/src/cli.ts
# 4. Add tests in enterprise/dev-kit/tests/
```

### Component DSL

Define components as YAML. See [DevKit README](enterprise/dev-kit/README.md) for full DSL reference.

```yaml
apiVersion: v1
kind: Tool
metadata:
  name: weather-api
  version: "1.0.0"
  labels: [api, weather]
spec:
  type: api
  server: http://tool-service:3100
  authentication:
    type: api_key
    keyName: X-API-Key
    keyLocation: header
  endpoints:
    - path: /v1/weather
      method: GET
      operationId: getWeather
      inputs:
        - name: city
          type: string
          required: true
```

### Running Tests

```bash
# DevKit unit tests
make devkit-test

# With local Ollama (avoids LLM API costs)
USE_LOCAL_LLM=true make devkit-test

# Type checking
cd enterprise/dev-kit && npm run typecheck
```

### VSCode Extension

Install from `vscode-dify-dev/`. Provides:
- YAML syntax highlighting for `dify-dsl` files
- Schema validation on save
- `Cmd+Shift+D` — deploy component to Dify
- Command palette: `Dify: Validate`, `Dify: Watch`

---

## Commands Reference

| Command | Description |
|---|---|
| `make init` | Initialize project (secrets, submodules) |
| `make build` | Build enterprise services |
| `make up` | Start enterprise services |
| `make down` | Stop enterprise services |
| `make dify-up` | Start Dify services |
| `make dify-down` | Stop Dify services |
| `make up-all` | Start all services (Dify + enterprise) |
| `make down-all` | Stop all services |
| `make logs` | Tail enterprise service logs |
| `make status` | Show service container status |
| `make health` | Run health checks |
| `make restart` | Restart enterprise services |
| `make clean` | Remove containers and images |
| `make devkit-build` | Build DevKit CLI |
| `make devkit-test` | Run DevKit unit tests |
| `make devkit-validate` | Validate all components |
| `make observability-up` | Start monitoring stack |
| `make security-up` | Start PII detection stack |

---

## Dify Integration

### Connecting Enterprise Services to Dify

**Option 1: Dify Plugin (Recommended — full feature set)**

Dify 1.0+ uses a plugin system. Build enterprise services as plugins:

```bash
# Install Dify Plugin CLI
brew tap langgenius/dify && brew install dify

# Create a Tool plugin pointing to tool-service
cd enterprise/plugins
dify plugin init   # Select: Tool type

# Package and install
dify plugin package ./your-plugin
# Upload via: Dify → Plugins → Install
```

**Option 2: External API Tool (Simple)**

1. Dify → Tools → Custom → Add HTTP API
2. URL: `http://enterprise-tool-service:3100/...`
3. For MCP: Dify → Tools → MCP → Add MCP Server (HTTP/SSE)
   - Server URL: `http://mcp-wechat:3001/sse`

### Service Endpoints

| Service | Address |
|---|---|
| Dify Console | http://localhost/install |
| Dify API | http://localhost:5001 |
| Enterprise Tool Service | http://localhost:3100 |
| WeChat MCP | http://localhost:3001/sse |
| Feishu MCP | http://localhost:3003/sse |
| DingTalk MCP | http://localhost:3005/sse |
| Custom IM MCP | http://localhost:3004/sse |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 |

### Dify Version Management

```bash
# Check pinned version
cat DIFY_VERSION

# Upgrade Dify submodule
cd dify && git fetch origin && git checkout <new-sha>
cd .. && echo "<new-sha>" > DIFY_VERSION

# Trigger compatibility check in CI
git commit -m "chore: upgrade dify submodule [dify-upgrade]"
```

The CI pipeline detects `[dify-upgrade]` in commit messages and automatically runs contract tests.

---

## CI/CD Pipeline

The pipeline runs 7 stages. See [GitHub Actions documentation](docs/github-actions.md) for full details.

```
validate → dify-compat → test-unit ─┐
                                     ├─→ build → deploy-staging → integration-tests → deploy-production
                        security  ──┘
```

**Manual triggers** support `deploy_env` (staging/production) and `skip_tests` (emergency deploys).

---

## Configuration Reference

Copy `.env.example` to `.env` and set the required values.

| Variable | Required | Description |
|---|---|---|
| `DIFY_BASE_URL` | Yes | Dify API base URL |
| `DIFY_API_KEY` | Yes | Dify console API key |
| `JWT_SECRET` | Yes | JWT signing secret (RBAC) |
| `STANDALONE_MODE` | No | `true` to disable Dify registration |
| `LANGFUSE_PUBLIC_KEY` | No | Langfuse observability |
| `PRESIDIO_ANALYZER_URL` | No | PII detection endpoint |
| `WECHAT_APP_ID` | No | WeChat Official Account App ID |
| `FEISHU_APP_ID` | No | Feishu App ID |
| `DINGTALK_APP_KEY` | No | DingTalk App Key |

See `.env.example` for the complete list with descriptions.

---

## License

[MIT](LICENSE)
