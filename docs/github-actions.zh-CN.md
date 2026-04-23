# GitHub Actions CI/CD 流水线

> **Language / 语言:** [English](github-actions.md) | 中文

AIDevOps CI/CD 流水线定义于 `.github/workflows/agent-ci.yml`，在每次推送到 `main`、`claude/**`、`feat/**`、`fix/**` 分支且涉及 `enterprise/**` 文件时触发。

**v0.4.0 更新：** 新增 `load-test` 阶段（k6，50 VU/60s），生产环境冒烟测试失败时自动回滚，以及三个分布式功能新密钥。

---

## 流水线总览

```
┌──────────────────────────────────────────────────────────────────────┐
│  触发条件：push / pull_request / workflow_dispatch                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
               ┌────────────────▼──────────────────┐
               │   阶段 1：validate（校验）          │  TypeScript 类型检查
               │   （每次提交必跑）                  │  DevKit 构建
               └──────┬────────────────┬───────────┘  DSL 校验
                      │                │
           ┌──────────▼──┐   ┌─────────▼──────────┐
           │ dify-compat  │   │    test-unit        │
           │（含[dify-   │   │    security         │
           │  upgrade]）  │   │    （并行）          │
           └─────────────┘   └──────────┬───────────┘
                                        │
                             ┌──────────▼──────────┐
                             │   阶段 4：build      │  Docker 多平台构建
                             │                      │  推送至 ghcr.io
                             └──────────┬───────────┘
                                        │
                    ┌───────────────────┼────────────────────┐
                    │                   │                    │
         ┌──────────▼──────┐  ┌─────────▼─────────┐         │
         │ container-      │  │  deploy-staging    │         │
         │ security        │  │  （main 分支）      │         │
         │ (Trivy + SBOM)  │  └─────────┬──────────┘         │
         └─────────────────┘            │                    │
                                        │                    │
                             ┌──────────▼──────────┐         │
                             │  load-test  ★新增   │  k6     │
                             │  50 VU / 60s        │  p99<500│
                             └──────────┬───────────┘         │
                                        │                    │
                             ┌──────────▼──────────┐         │
                             │  integration-tests  │         │
                             └──────────┬───────────┘         │
                                        │                    │
                             ┌──────────▼──────────┐         │
                             │  deploy-production  │  人工    │
                             │  + 冒烟 + 回滚★     │  审批    │
                             └─────────────────────┘         │
```

---

## 阶段详情

### 阶段 1 — `validate`（校验）

**触发：** 每次触发提交  
**超时：** 10 分钟

| 步骤 | 说明 |
|---|---|
| TypeScript 类型检查 | `npm run typecheck` — 类型错误直接失败 |
| 构建 DevKit | 将 `enterprise/dev-kit` TypeScript 编译至 `dist/` |
| 校验组件 | `node dist/cli.js validate --all --level 2 --verbose` |

失败时制品：`typecheck-results`

---

### 阶段 1b — `dify-compat`（Dify 兼容性检查）

**触发：** 提交消息/标题含 `[dify-upgrade]`，或手动触发  
**依赖：** `validate`  
**超时：** 10 分钟  
**服务：** PostgreSQL 15（Runner 内）

| 步骤 | 说明 |
|---|---|
| 验证 DIFY_VERSION | 检查 `DIFY_VERSION` 文件与子模块 SHA 一致 |
| 契约测试 | `bash scripts/check-dify-compat.sh` — 版本边界 + API 契约 |

**触发方式：** 更新 Dify 子模块时在提交消息中包含 `[dify-upgrade]`。

---

### 阶段 2 — `test-unit`（单元测试）

**触发：** 所有提交（`skip_tests=true` 时跳过）  
**依赖：** `validate`  
**超时：** 15 分钟

| 步骤 | 说明 |
|---|---|
| 启动 Ollama | 拉取 `llama3.2:3b`（本地 LLM，无云端费用） |
| 运行测试 | Jest + `--coverage`，`USE_LOCAL_LLM=true` |
| 覆盖率门禁 | 语句覆盖率低于 60% 时失败 |

制品：`coverage-report`（LCOV + JSON）

**本地等效命令：**
```bash
USE_LOCAL_LLM=true make devkit-test
```

---

### 阶段 3 — `security`（安全扫描）

**触发：** 所有提交  
**依赖：** `validate`  
**超时：** 10 分钟

| 步骤 | 说明 |
|---|---|
| npm audit (DevKit) | 高危依赖漏洞 |
| npm audit (tool-service) | 高危依赖漏洞 |
| TruffleHog | 密钥扫描（仅已验证密钥） |
| CodeQL SAST | 静态分析（javascript-typescript） |
| License 检查 | 阻止 GPL-2.0、GPL-3.0、AGPL-3.0 |
| .env.example 检查 | 检测到硬编码密钥时失败 |

制品：`license-report`（保留 30 天）

> 所有安全步骤使用 `continue-on-error: true`，收集结果但不阻塞流水线。

---

### 阶段 3b — `container-security`（容器安全）

**触发：** 非 PR 推送（`build` 完成后）  
**依赖：** `build`  
**超时：** 15 分钟

| 步骤 | 说明 |
|---|---|
| Trivy (tool-service) | CRITICAL/HIGH CVE 扫描 → SARIF |
| Trivy (mcp-wechat) | CRITICAL/HIGH CVE 扫描 → SARIF |
| 上传 SARIF | 上传至 GitHub 安全选项卡 |
| Syft SBOM (tool-service) | 生成 SPDX-JSON SBOM |

制品：`sbom-<sha>`（GitHub 保留 90 天）

> **注意：** GitHub 制品 90 天保留期可能不满足合规要求。如需长期存储，请在构建后步骤中将制品上传至 S3/GCS。此问题已列入 v0.5.0 规划。

---

### 阶段 4 — `build`（构建）

**触发：** 非 PR 推送  
**依赖：** `test-unit`、`security`  
**超时：** 20 分钟  
**镜像仓库：** `ghcr.io/<org>/<repo>/`

构建镜像：
- `tool-service` — `linux/amd64`、`linux/arm64`
- `mcp-wechat` — `linux/amd64`、`linux/arm64`

**镜像标签规则：**

| 规则 | 示例 |
|---|---|
| SHA 前缀 | `sha-abc1234` |
| 分支名 | `main` |
| Semver（Tag 触发） | `1.2.3` |
| `latest`（仅 main） | `latest` |

**所需密钥：** `GITHUB_TOKEN`（自动提供）

---

### 阶段 5 — `deploy-staging`（预发布部署）

**触发：** 推送到 `main`，或手动触发 `deploy_env=staging`  
**依赖：** `build`  
**环境：** `staging`（URL：`https://staging.dify.internal`）  
**超时：** 15 分钟

| 步骤 | 说明 |
|---|---|
| 构建 DevKit | 为部署重新构建 |
| 部署组件 | 校验（level 3）+ 部署所有 `enterprise/components/*.yml` |
| ArgoCD 同步 | 同步 `aidevops-staging` 应用（可选） |
| 记录事件 | 发送至 Harness Webhook（可选） |

**部署时环境变量：**
```
OTEL_SAMPLE_RATIO=0.1
PROMPT_GUARD_MODE=balanced
```

**所需密钥：**

| 密钥 | 用途 |
|---|---|
| `STAGING_DIFY_BASE_URL` | 预发布 Dify API 地址 |
| `STAGING_DIFY_API_KEY` | 预发布 Dify API 密钥 |
| `REDIS_URL` | Token 黑名单 + 限流 Redis（可选） |
| `JWKS_URI` | RS256 JWT 验证的 OIDC JWKS 地址（可选） |
| `PROMPT_GUARD_CLASSIFIER_URL` | Tier-3 LLM 分类器 URL（可选） |
| `ARGOCD_TOKEN` | ArgoCD 认证（可选） |
| `ARGOCD_SERVER` | ArgoCD 服务器地址（可选） |
| `HARNESS_WEBHOOK_URL` | Harness CD Webhook（可选） |

---

### 阶段 5b — `load-test`（负载测试）★ v0.4.0 新增

**触发：** `deploy-staging` 完成后（非 PR，main 分支）  
**依赖：** `deploy-staging`  
**超时：** 10 分钟

使用 `.github/k6/smoke.js` 对预发布 Tool Service 执行 k6 冒烟负载测试。

**测试参数：**

| 参数 | 值 |
|---|---|
| 虚拟用户数（VU） | 50 |
| 持续时长 | 60 秒 |
| 测试端点 | `GET /health`、`POST /tools/summarize` |
| p99 延迟阈值 | < 500ms |
| 错误率阈值 | < 1% |
| HTTP 失败率阈值 | < 1% |

**通过/失败逻辑：**
- `GET /health` 必须返回 HTTP 200
- `POST /tools/summarize` 无认证时必须返回 < 500（401 为预期行为，可接受）
- 任一阈值超标则流水线失败

**本地等效命令：**
```bash
k6 run --env TARGET_URL=http://localhost:3100 .github/k6/smoke.js
```

**k6 脚本位置：** `.github/k6/smoke.js`

---

### 阶段 6 — `integration-tests`（集成测试）

**触发：** `load-test` 完成后（或跳过 load-test 时接在 `deploy-staging` 后）  
**依赖：** `deploy-staging`  
**超时：** 20 分钟

针对预发布 Dify 实例运行集成测试套件（`npm run test:integration`）。

> 当前为宽松模式——集成测试尚未配置时仅输出警告，不阻塞流水线。

制品：`integration-test-results`

---

### 阶段 7 — `deploy-production`（生产部署）★ v0.4.0 更新

**触发：** `main` 分支 + 手动触发 `deploy_env=production`  
**依赖：** `integration-tests`  
**环境：** `production`（URL：`https://dify.internal`）— **需要 GitHub 环境审批**  
**超时：** 20 分钟

| 步骤 | 说明 |
|---|---|
| 构建 DevKit | 为部署重新构建 |
| 部署组件 | 校验（level 3）+ 部署所有组件 |
| 更新锁定文件 | 通过组件注册表 API 保存 `registry.lock.json` |
| 提交锁定文件 | 自动提交 `[skip ci]` 至 `main` |
| 生产冒烟测试 | `GET /health` 须在 30s 内返回 200 |
| **失败自动回滚 ★** | 冒烟测试失败时执行 `helm rollback aidevops-production` |
| **回滚 Slack 告警 ★** | 回滚后向 `#deployments` 发送失败通知 |
| 成功 Slack 通知 | 部署成功后向 `#deployments` 发送摘要 |

**自动回滚流程：**

```
deploy-production
       │
       ▼
  冒烟测试（GET /health，30s 超时）
       │
   ┌───┴─────────────────┐
   │ 通过                 │ 失败
   ▼                     ▼
Slack：成功通知     helm rollback aidevops-production
                         │
                         ▼
                    Slack：":rotating_light: 已触发回滚"
                         │
                         ▼
                    流水线退出码 1（标记为失败）
```

**所需密钥：**

| 密钥 | 用途 |
|---|---|
| `PROD_DIFY_BASE_URL` | 生产 Dify API 地址 |
| `PROD_DIFY_API_KEY` | 生产 Dify API 密钥 |
| `REDIS_URL` | 分布式功能 Redis（可选） |
| `JWKS_URI` | OIDC JWKS 地址（可选） |
| `PROMPT_GUARD_CLASSIFIER_URL` | Tier-3 分类器 URL（可选） |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook（可选） |
| `KUBECONFIG` | helm 回滚所需 K8s 凭证（可选） |

> **人工审批门禁（HITL）：** `production` GitHub 环境须配置必要审批人，流水线在执行部署步骤前将暂停等待审批。

---

## 手动触发（workflow_dispatch）

进入 **Actions → Agent Workflow CI/CD → Run workflow**。

| 输入项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `deploy_env` | 选择 | `staging` | 目标环境（`staging` 或 `production`） |
| `skip_tests` | 布尔 | `false` | 跳过单元测试 + 集成测试（仅限紧急部署） |

**部署到生产环境：**
1. 确认变更已合并至 `main`
2. 使用 `deploy_env=production` 触发流水线
3. 在 GitHub 环境门禁处审批部署

---

## 仓库密钥配置

在 **Settings → Secrets and variables → Actions** 中配置：

### 核心密钥

| 密钥 | 用于 | 示例 |
|---|---|---|
| `STAGING_DIFY_BASE_URL` | deploy-staging | `https://staging.dify.internal` |
| `STAGING_DIFY_API_KEY` | deploy-staging | Dify 控制台预发布 API 密钥 |
| `PROD_DIFY_BASE_URL` | deploy-production | `https://dify.internal` |
| `PROD_DIFY_API_KEY` | deploy-production | Dify 控制台生产 API 密钥 |

### v0.4.0 新增密钥

| 密钥 | 用于 | 说明 |
|---|---|---|
| `REDIS_URL` | staging + production | 启用 Token 黑名单、微信 Token 缓存、限流。格式：`redis://:password@host:6379` |
| `JWKS_URI` | staging + production | RS256 JWT 验证的 OIDC JWKS 地址。未设置时回退至 HS256。 |
| `PROMPT_GUARD_CLASSIFIER_URL` | staging + production | 提示注入 Tier-3 LLM 分类器。可选；未设置时使用正则+启发式规则。 |

### 可选密钥

| 密钥 | 用于 | 说明 |
|---|---|---|
| `CI_POSTGRES_PASSWORD` | dify-compat | 未设置时默认 `ci-only-test-password` |
| `ARGOCD_TOKEN` | deploy-staging | ArgoCD 认证 Token |
| `ARGOCD_SERVER` | deploy-staging | ArgoCD 服务器地址 |
| `HARNESS_WEBHOOK_URL` | deploy-staging | Harness CD 部署事件 Webhook |
| `SLACK_WEBHOOK_URL` | deploy-production | Slack Incoming Webhook |
| `KUBECONFIG` | deploy-production | 自动 helm 回滚所需 K8s 凭证 |

---

## 触发条件矩阵

| 事件 | validate | dify-compat | test-unit | security | build | deploy-staging | load-test | deploy-production |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| PR → main | ✓ | — | ✓ | ✓ | — | — | — | — |
| PR + `[dify-upgrade]` | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| push → main | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| push → main + `[dify-upgrade]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| push → claude/\*\* | ✓ | — | ✓ | ✓ | ✓ | — | — | — |
| 手动（staging） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 手动（production） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 手动 + skip_tests | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |

---

## 制品汇总

| 制品 | 阶段 | 保留期 |
|---|---|---|
| `typecheck-results` | validate（失败时） | 默认（90天） |
| `coverage-report` | test-unit | 默认（90天） |
| `license-report` | security | 30 天 |
| `sbom-<sha>` | container-security | 90 天 |
| `k6-results` | load-test | 默认（90天） |
| `integration-test-results` | integration-tests | 默认（90天） |

> **SBOM 保留说明：** GitHub 制品 90 天保留期可能不满足合规要求，建议配置上传至 S3/GCS 的后处理步骤。见 v0.5.0 规划。

---

## 本地开发等效命令

```bash
# 阶段 1：校验
cd enterprise/dev-kit
npm run typecheck && npm run build
node dist/cli.js validate --all --level 2

# 阶段 2：单元测试
USE_LOCAL_LLM=true npm test -- --coverage

# 阶段 3：安全扫描
npm audit --audit-level=high
npx license-checker --production --failOn "GPL-2.0;GPL-3.0;AGPL-3.0"

# 阶段 5b：负载测试（需安装 k6）
k6 run --env TARGET_URL=http://localhost:3100 .github/k6/smoke.js

# 阶段 5：部署到预发布
DIFY_BASE_URL=<url> DIFY_API_KEY=<key> node dist/cli.js deploy <component>
```

---

## 故障排查

**validate 失败 — 类型检查错误**
- 下载 `typecheck-results` 制品查看完整日志
- 本地运行 `npm run typecheck` 修复后再推送

**test-unit 失败 — Ollama 未就绪**
- Ollama 启动需约 15 秒，流水线已通过 `sleep 15` 等待
- `llama3.2:3b` 拉取失败时测试回退至 Mock LLM（不阻塞）

**覆盖率低于 60%**
- 查看 `coverage-report` 制品获取逐行详情
- 合并前为新代码路径补充测试

**load-test 失败 — p99 超过阈值**
- 检查预发布服务日志，排查慢查询或上游超时
- 常见原因：Redis 冷连接、Dify API 延迟尖峰
- 若预发布环境资源不足，可调整 `LOAD_TEST_TARGET` 阈值参数

**deploy-production 触发了回滚**
- 流水线会向 `#deployments` Slack 发送含精确 SHA 的通知
- 排查命令：`kubectl logs -n aidevops-production -l app=tool-service --since=10m`
- 修复后重新部署：手动触发流水线，`deploy_env=production`

**deploy-staging 失败 — ArgoCD 同步超时**
- ArgoCD 同步为非阻塞步骤（`|| echo "ArgoCD not configured, skipping"`）
- 请在 `$ARGOCD_SERVER` ArgoCD 控制台单独检查

**deploy-production 停在审批状态**
- 进入 **Actions → (运行记录) → deploy-production → Review deployments**
- 在 GitHub UI 中审批或拒绝
