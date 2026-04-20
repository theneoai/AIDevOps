# Contributing to AIDevOps

Thank you for your interest in contributing! This project provides GitOps tooling for managing AI components (LLM agents, workflows, tools) as code.

## Development Setup

### Prerequisites

- Node.js >= 18
- Docker + Docker Compose
- Git

### Getting Started

```bash
git clone https://github.com/theneoai/aidevops.git
cd aidevops
cp .env.example .env
# Edit .env with your local config

# Build DevKit CLI
make devkit-build

# Start local dev stack (no Dify required)
make dev-up
```

### Running Tests

```bash
# DevKit unit tests
make devkit-test

# With local Ollama (no OpenAI cost)
USE_LOCAL_LLM=true make devkit-test
```

## Project Structure

```
enterprise/
  dev-kit/          # DevKit CLI (TypeScript)
    src/
      commands/     # CLI commands (deploy, watch, registry, ...)
      compilers/    # DSL → Dify JSON compilers
      adapters/     # IDifyAdapter implementations
      core/         # Parser, config, orchestrator
  mcp-servers/      # MCP server implementations
    mcp-wechat/     # WeChat Official Account
    mcp-feishu/     # Feishu (Lark)
    mcp-dingtalk/   # DingTalk
  components/       # Example component YAML definitions
registry/           # Component registry index
helm/               # Kubernetes Helm charts
argocd/             # GitOps ApplicationSet
```

## Making Changes

### Adding a New MCP Server

1. Copy `enterprise/mcp-servers/mcp-template/` to `enterprise/mcp-servers/mcp-<name>/`
2. Implement the MCP tools in `src/index.ts`
3. Add secrets handling via `readSecret()` in `src/config.ts`
4. Ensure `/health` and `/metrics` endpoints exist
5. Add the server to `docker-compose.yml`
6. Register a component spec in `registry/index.json`

### Adding a New CLI Command

1. Create `enterprise/dev-kit/src/commands/<name>.ts`
2. Export an `async function <name>Command(...)` 
3. Register it in `enterprise/dev-kit/src/cli.ts`
4. Add tests in `enterprise/dev-kit/tests/`

### Component DSL Changes

- DSL types live in `enterprise/dev-kit/src/types/dsl.ts`
- Schema validation is in `enterprise/dev-kit/src/commands/validate.ts`
- Update the corresponding compiler in `enterprise/dev-kit/src/compilers/`

## Pull Request Guidelines

- Keep PRs focused on a single concern
- Include tests for new functionality
- Run `make devkit-test` and `npm run typecheck` before opening a PR
- Validate any new component YAML with `dify-dev validate --all`
- Update `registry/index.json` if adding a new component template

## Commit Message Format

```
<type>(<scope>): <short summary>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

Examples:
```
feat(mcp-feishu): add send_message and create_document tools
fix(devkit): resolve tool ref map lookup for mcp providers
docs(contributing): add MCP server setup guide
```

## Code Style

- TypeScript strict mode is required
- No `any` types without explicit justification
- No inline secrets or hardcoded credentials
- Follow the existing pattern: `readSecret(secretName, envFallback)` for credentials

## Reporting Issues

Use the GitHub issue templates:
- **Bug Report**: for unexpected behavior
- **Feature Request**: for new functionality ideas

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
