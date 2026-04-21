# GitHub Actions CI/CD 流水线

> **Language / 语言:** [English](github-actions.md) | 中文

AIDevOps 的 CI/CD 流水线定义于 `.github/workflows/agent-ci.yml`。每次向 `main`、`claude/**`、`feat/**`、`fix/**` 分支推送涉及 `enterprise/**` 文件的变更时，均会触发全部 7 个阶段。

---

## 流水线总览

```
┌──────────────────────────────────────────────────────────────────┐
│  触发条件: push / pull_request / workflow_dispatch                │
└──────────────────────────────┬───────────────────────────────────┘
                               │
              ┌────────────────▼──────────────────┐
              │   阶段 1: validate                 │  TypeScript 类型检查
              │   （每次提交均运行）                │  DevKit 构建
              └──────┬─────────────────┬──────────┘  组件 DSL 校验
                     │                 │
          ┌──────────▼──┐    ┌─────────▼──────────┐
          │ dify-compat  │    │    test-unit        │
          │ (升级提交时)  │    │    security         │
          │              │    │    （并行执行）      │
          └──────────────┘    └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │   阶段 4: build      │  Docker 多平台构建
                              │                      │  推送至 ghcr.io
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ container-security   │  Trivy + SBOM (Syft)
                              │ deploy-staging       │  main 分支自动部署
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ integration-tests    │  对接测试 Dify
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ deploy-production    │  HITL 审批门控
                              │ （手动触发）          │  Slack 通知
                              └─────────────────────┘
```

---

## 阶段详解

### 阶段 1 — `validate`：DSL 组件校验

**触发条件：** 每次触发提交均运行  
**超时：** 10 分钟

| 步骤 | 说明 |
|---|---|
| TypeScript 类型检查 | `npm run typecheck` — 类型错误时强制失败 |
| 构建 DevKit | 将 `enterprise/dev-kit` TypeScript 编译到 `dist/` |
| 校验组件 | `node dist/cli.js validate --all --level 2 --verbose` |

失败时产物：`typecheck-results`（类型检查日志）

---

### 阶段 1b — `dify-compat`：Dify 兼容性检查

**触发条件：** 提交消息包含 `[dify-upgrade]` 或手动触发时运行  
**依赖：** `validate`  
**超时：** 10 分钟  
**服务：** PostgreSQL 15（Runner 内置）

| 步骤 | 说明 |
|---|---|
| 验证 DIFY_VERSION | 检查 `DIFY_VERSION` 文件是否与实际子模块 SHA 一致 |
| 契约测试 | `npm test -- --testPathPattern=contract` 连接真实 Postgres 运行 |

**触发方式：** 更新 Dify 子模块时，在提交消息中包含 `[dify-upgrade]`。

---

### 阶段 2 — `test-unit`：单元测试

**触发条件：** 所有提交（`skip_tests=true` 时跳过）  
**依赖：** `validate`  
**超时：** 15 分钟

| 步骤 | 说明 |
|---|---|
| 启动 Ollama | 拉取 `llama3.2:3b` 用于本地 LLM 测试（无需 OpenAI 费用） |
| 运行测试 | Jest 含覆盖率统计，`USE_LOCAL_LLM=true` |
| 覆盖率检查 | 语句覆盖率低于 60% 时失败 |

产物：`coverage-report`（LCOV + JSON 摘要）

**本地等效命令：**
```bash
USE_LOCAL_LLM=true make devkit-test
```

---

### 阶段 3 — `security`：安全扫描

**触发条件：** 所有提交  
**依赖：** `validate`  
**超时：** 10 分钟

| 步骤 | 说明 |
|---|---|
| npm audit（DevKit） | 高危依赖漏洞检测 |
| npm audit（tool-service） | 高危依赖漏洞检测 |
| TruffleHog | 密钥扫描（仅检测已验证的密钥） |
| CodeQL SAST | 静态分析（javascript-typescript） |
| 许可证合规检查 | 阻断 GPL-2.0、GPL-3.0、AGPL-3.0 许可证依赖 |
| .env.example 卫生检查 | 检测到硬编码密钥时失败 |

产物：`license-report`（保留 30 天）

> 所有安全步骤均设置 `continue-on-error: true`，用于汇总扫描结果而不阻断流水线；失败结果在 Security 标签页展示。

---

### 阶段 3b — `container-security`：容器扫描 + SBOM

**触发条件：** 非 PR 的推送（在 `build` 之后运行）  
**依赖：** `build`  
**超时：** 15 分钟

| 步骤 | 说明 |
|---|---|
| Trivy（tool-service） | CRITICAL/HIGH CVE 扫描 → SARIF 格式 |
| Trivy（mcp-wechat） | CRITICAL/HIGH CVE 扫描 → SARIF 格式 |
| 上传 SARIF | 上传至 GitHub Security 标签页 |
| Syft SBOM（tool-service） | 生成 SPDX-JSON 格式 SBOM |

产物：`sbom-<sha>`（保留 90 天）

---

### 阶段 4 — `build`：构建 Docker 镜像

**触发条件：** 非 PR 推送  
**依赖：** `test-unit`、`security`  
**超时：** 20 分钟  
**镜像仓库：** `ghcr.io/<org>/<repo>/`

构建的镜像：
- `tool-service` — `linux/amd64`、`linux/arm64`
- `mcp-wechat` — `linux/amd64`、`linux/arm64`

**镜像标签规则：**
| 规则 | 示例 |
|---|---|
| SHA 前缀 | `sha-abc1234` |
| 分支名称 | `main` |
| 语义化版本（打标签时） | `1.2.3` |
| `latest`（仅 main 分支） | `latest` |

**所需密钥：** `GITHUB_TOKEN`（自动提供）

---

### 阶段 5 — `deploy-staging`：部署到测试环境

**触发条件：** 推送到 `main`，或手动触发选择 `deploy_env=staging`  
**依赖：** `build`  
**环境：** `staging`（URL：`https://staging.dify.internal`）  
**超时：** 15 分钟

| 步骤 | 说明 |
|---|---|
| 构建 DevKit | 部署前重新构建 |
| 部署组件 | 校验（级别 3）+ 部署所有 `enterprise/components/*.yml` |
| ArgoCD 同步 | 同步 `aidevops-staging` 应用（可选，未配置时跳过） |
| 记录部署事件 | 向 Harness Webhook 发送通知（可选） |

**所需密钥：**
| 密钥 | 用途 |
|---|---|
| `STAGING_DIFY_BASE_URL` | 测试环境 Dify API 端点 |
| `STAGING_DIFY_API_KEY` | 测试环境 Dify API 密钥 |
| `ARGOCD_TOKEN` | ArgoCD 认证 Token（可选） |
| `ARGOCD_SERVER` | ArgoCD 服务器地址（可选） |
| `HARNESS_WEBHOOK_URL` | Harness CD Webhook（可选） |

---

### 阶段 6 — `integration-tests`：集成测试

**触发条件：** `deploy-staging` 成功后运行（`skip_tests=true` 时跳过）  
**依赖：** `deploy-staging`  
**超时：** 20 分钟

针对测试环境 Dify 运行集成测试套件（`npm run test:integration`）。

> 当前为宽松模式 — 若集成测试尚未配置，输出警告但不阻断流水线。

产物：`integration-test-results`

---

### 阶段 7 — `deploy-production`：部署到生产环境

**触发条件：** `main` 分支 + 手动触发 `deploy_env=production`  
**依赖：** `integration-tests`  
**环境：** `production`（URL：`https://dify.internal`）— **需要 GitHub 环境审批**  
**超时：** 20 分钟

| 步骤 | 说明 |
|---|---|
| 构建 DevKit | 部署前重新构建 |
| 部署组件 | 校验（级别 3）+ 部署所有组件 |
| 更新锁文件 | 通过组件注册表 API 保存 `registry.lock.json` |
| 提交锁文件 | 自动提交 `[skip ci]` 到 `main` 分支 |
| Slack 通知 | 向 `#deployments` 频道发送成功/失败通知 |

**所需密钥：**
| 密钥 | 用途 |
|---|---|
| `PROD_DIFY_BASE_URL` | 生产环境 Dify API 端点 |
| `PROD_DIFY_API_KEY` | 生产环境 Dify API 密钥 |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook（可选） |

> **HITL 门控：** `production` GitHub 环境必须配置必要审批者。流水线在执行部署步骤前会暂停等待人工审批。

---

## 手动触发（workflow_dispatch）

在 **Actions → Agent Workflow CI/CD → Run workflow** 中触发。

| 输入项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `deploy_env` | 选择 | `staging` | 目标环境（`staging` 或 `production`） |
| `skip_tests` | 布尔 | `false` | 跳过单元测试和集成测试（紧急部署使用） |

**部署到生产环境：**
1. 确保变更已合入 `main` 分支
2. 触发工作流，选择 `deploy_env=production`
3. 在 GitHub 环境门控中审批部署

**紧急部署（跳过测试）：**
```
deploy_env=staging, skip_tests=true
```

---

## 仓库 Secrets 配置

在 **Settings → Secrets and variables → Actions** 中配置以下密钥：

| 密钥 | 使用阶段 | 备注 |
|---|---|---|
| `STAGING_DIFY_BASE_URL` | deploy-staging | 示例：`https://staging.dify.internal` |
| `STAGING_DIFY_API_KEY` | deploy-staging | Dify 控制台 API 密钥（测试环境） |
| `PROD_DIFY_BASE_URL` | deploy-production | 示例：`https://dify.internal` |
| `PROD_DIFY_API_KEY` | deploy-production | Dify 控制台 API 密钥（生产环境） |
| `CI_POSTGRES_PASSWORD` | dify-compat | 可选 — 未设置时默认使用 `ci-only-test-password` |
| `ARGOCD_TOKEN` | deploy-staging | 可选 — ArgoCD 认证 Token |
| `ARGOCD_SERVER` | deploy-staging | 可选 — ArgoCD 服务器地址 |
| `HARNESS_WEBHOOK_URL` | deploy-staging | 可选 — Harness CD Webhook |
| `SLACK_WEBHOOK_URL` | deploy-production | 可选 — Slack 通知 |

---

## 触发矩阵

| 触发事件 | validate | test-unit | security | build | deploy-staging | deploy-production |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| PR → main | ✓ | ✓ | ✓ | — | — | — |
| push → main | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| push → claude/\*\* | ✓ | ✓ | ✓ | ✓ | — | — |
| 手动（staging） | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 手动（production） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 手动 + skip_tests | ✓ | — | ✓ | ✓ | ✓ | — |

---

## 产物汇总

| 产物 | 来源阶段 | 保留时间 |
|---|---|---|
| `typecheck-results` | validate（失败时） | 默认 |
| `coverage-report` | test-unit | 默认 |
| `license-report` | security | 30 天 |
| `sbom-<sha>` | container-security | 90 天 |
| `integration-test-results` | integration-tests | 默认 |

---

## 本地等效命令

```bash
# 阶段 1：validate
cd enterprise/dev-kit
npm run typecheck && npm run build
node dist/cli.js validate --all --level 2

# 阶段 2：单元测试
USE_LOCAL_LLM=true npm test -- --coverage

# 阶段 3：安全检查
npm audit --audit-level=high
npx license-checker --production --failOn "GPL-2.0;GPL-3.0;AGPL-3.0"

# 阶段 5：部署到测试环境
DIFY_BASE_URL=<url> DIFY_API_KEY=<key> node dist/cli.js deploy <component>
```

---

## 故障排查

**validate 失败 — TypeScript 类型错误**
- 下载 `typecheck-results` 产物查看完整日志
- 在本地运行 `npm run typecheck` 修复错误后再推送

**test-unit 失败 — Ollama 未就绪**
- Ollama 需要约 15 秒启动，流水线中已有 `sleep 15` 等待
- 若 `llama3.2:3b` 拉取失败，测试将回退到 Mock LLM（非阻断）

**覆盖率低于 60%**
- 为新增代码路径补充测试用例
- 查看 `coverage-report` 产物了解行级覆盖率详情

**deploy-staging 失败 — ArgoCD 同步超时**
- ArgoCD 同步为非阻断操作（`|| echo "ArgoCD not configured, skipping"`）
- 请在 ArgoCD 控制台（`$ARGOCD_SERVER`）单独排查

**deploy-production 卡在审批**
- 前往 **Actions → （运行记录） → deploy-production → Review deployments**
- 在 GitHub UI 中审批或拒绝
