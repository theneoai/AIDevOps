# Contributing to AIDevOps

> **Language / 语言:** English | [中文](#中文贡献指南)

Thank you for your interest in contributing! AIDevOps is a Code-Driven Development framework for managing AI components (LLM agents, workflows, tools, MCP servers) built on Dify.

---

## Development Setup

### Prerequisites

- Node.js >= 18
- Docker + Docker Compose
- Git

### Getting Started

```bash
git clone --recursive https://github.com/theneoai/aidevops.git
cd aidevops
cp .env.example .env
# Edit .env with your local config

# Build DevKit CLI
make devkit-build

# Start local dev stack (no Dify required)
make up
```

### Running Tests

```bash
# DevKit unit tests
make devkit-test

# With local Ollama (no LLM API cost)
USE_LOCAL_LLM=true make devkit-test

# Type checking
cd enterprise/dev-kit && npm run typecheck
```

---

## Project Structure

```
enterprise/
  dev-kit/          # DevKit CLI (TypeScript)
    src/
      commands/     # CLI commands (deploy, validate, registry, ...)
      compilers/    # DSL → Dify JSON compilers
      adapters/     # IDifyAdapter implementations (API + DB)
      core/         # Parser, config, orchestrator, HITL
      types/        # DSL + Dify TypeScript type definitions
      audit/        # Audit logging service
  mcp-servers/      # MCP server implementations
    mcp-wechat/     # WeChat Official Account
    mcp-feishu/     # Feishu (Lark)
    mcp-dingtalk/   # DingTalk
    mcp-custom-im/  # Generic IM (webhook / config file backends)
    mcp-template/   # Scaffold for new MCP servers
  tool-service/     # Generic REST API Tool service
  components/       # Component YAML definitions + templates
  skills/           # Skill configuration library
  workflows/        # Workflow template library
registry/           # Component registry index
helm/               # Kubernetes Helm charts
argocd/             # GitOps ApplicationSet
```

---

## Making Changes

### Adding a New MCP Server

1. Copy `enterprise/mcp-servers/mcp-template/` to `enterprise/mcp-servers/mcp-<name>/`
2. Implement the MCP tools in `src/index.ts`
3. Add credential handling via `readSecret()` in `src/config.ts`
4. Ensure `/health` and `/metrics` endpoints exist
5. Add the server to `docker-compose.yml`
6. Register a component spec in `registry/index.json`

### Adding a New CLI Command

1. Create `enterprise/dev-kit/src/commands/<name>.ts`
2. Export `async function <name>Command(...)`
3. Register it in `enterprise/dev-kit/src/cli.ts`
4. Add tests in `enterprise/dev-kit/tests/`

### Component DSL Changes

- DSL types live in `enterprise/dev-kit/src/types/dsl.ts`
- Schema validation is in `enterprise/dev-kit/src/commands/validate.ts`
- Update the corresponding compiler in `enterprise/dev-kit/src/compilers/`

---

## Pull Request Guidelines

- Keep PRs focused on a single concern
- Include tests for new functionality (coverage threshold: 60%)
- Run `make devkit-test` and `npm run typecheck` before opening a PR
- Validate any new component YAML with `node dist/cli.js validate --all`
- Update `registry/index.json` if adding a new component template
- Reference the related issue number in the PR description

---

## Commit Message Format

```
<type>(<scope>): <short summary>

<optional body>
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

**Examples:**
```
feat(mcp-feishu): add send_message and create_document tools
fix(devkit): resolve tool ref map lookup for mcp providers
docs(contributing): add MCP server setup guide
chore: upgrade dify submodule [dify-upgrade]
```

> Include `[dify-upgrade]` in the commit message when bumping the Dify submodule to trigger compatibility contract tests in CI.

---

## Code Style

- TypeScript strict mode is required
- No `any` types without explicit justification and comment
- No inline secrets or hardcoded credentials
- Follow the existing pattern: `readSecret(secretName, envFallback)` for credentials
- Each MCP server must expose `/health` (200 OK) and `/metrics` endpoints

---

## Reporting Issues

Use the GitHub issue templates:
- **Bug Report** — for unexpected behavior
- **Feature Request** — for new functionality ideas

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

---

## 中文贡献指南

感谢您对 AIDevOps 的贡献！AIDevOps 是基于 Dify 构建的 AI 组件代码驱动开发框架，支持 LLM Agent、Workflow、Tool、MCP Server 等组件的版本化管理。

### 开发环境搭建

**前置依赖：**
- Node.js >= 18
- Docker + Docker Compose
- Git

```bash
git clone --recursive https://github.com/theneoai/aidevops.git
cd aidevops
cp .env.example .env
# 编辑 .env，填写本地配置

# 构建 DevKit CLI
make devkit-build

# 启动本地开发服务栈（无需 Dify）
make up
```

### 运行测试

```bash
# DevKit 单元测试
make devkit-test

# 使用本地 Ollama（避免 LLM API 费用）
USE_LOCAL_LLM=true make devkit-test

# 类型检查
cd enterprise/dev-kit && npm run typecheck
```

### PR 提交规范

- 每个 PR 只关注单一问题
- 新功能必须包含测试（覆盖率门槛：60%）
- 提 PR 前运行 `make devkit-test` 和 `npm run typecheck`
- 新增组件 YAML 需用 `node dist/cli.js validate --all` 校验
- 新增组件模板需同步更新 `registry/index.json`

### 提交消息格式

```
<类型>(<范围>): <简短描述>

<可选正文>
```

**类型：** `feat`、`fix`、`refactor`、`test`、`docs`、`chore`

**示例：**
```
feat(mcp-feishu): 添加 send_message 和 create_document 工具
fix(devkit): 修复 MCP Provider 的工具引用映射查找问题
docs: 更新 GitHub Actions 流水线文档
chore: 升级 Dify 子模块 [dify-upgrade]
```

> 升级 Dify 子模块时，在提交消息中加入 `[dify-upgrade]`，CI 将自动触发兼容性契约测试。

### 代码规范

- 必须启用 TypeScript 严格模式
- 不允许未加注释的 `any` 类型
- 禁止内联密钥或硬编码凭证
- 凭证处理遵循现有模式：`readSecret(secretName, envFallback)`
- 每个 MCP Server 必须暴露 `/health`（返回 200）和 `/metrics` 端点

### 许可证

贡献代码即表示您同意将贡献内容以 [MIT 许可证](LICENSE) 授权发布。
