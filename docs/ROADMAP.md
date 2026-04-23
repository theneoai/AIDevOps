# AIDevOps Roadmap

> 本文件整合了代码库中各处提及的待改进项、架构建议和版本规划，作为单一追踪来源。
>
> **语言 / Language:** 中文 | [English sections inline]
>
> 最后更新：2026-04-23

---

## 当前版本状态

| 版本 | 状态 | 主要交付物 |
|---|---|---|
| **v0.3.x** | 已发布 | DevKit CLI、Tool/MCP 完整生命周期、基础 CI/CD |
| **v0.4.0** | 已发布 | load-test 阶段（k6）、生产自动回滚、REDIS_URL / JWKS_URI / PROMPT_GUARD_CLASSIFIER_URL 新密钥 |
| **v0.5.0** | 规划中 | 见下方短期优先级 |

---

## 近期待改进项（本次对话产出）

以下条目来自本次架构审查，尚未实施：

### CI/CD

- [ ] **SBOM 长期存储**：当前 `sbom-<sha>` 制品仅在 GitHub 保留 90 天，不满足合规要求。需在 `container-security` 阶段添加后处理步骤，将 SPDX-JSON 上传至 S3 或 GCS。（来源：`docs/github-actions.md`，已标注 v0.5.0）
- [ ] **load-test 阈值可配置化**：当前 p99 < 500ms、错误率 < 1% 为硬编码值。预发布环境资源不足时需手动调整，应抽取为 workflow input 或环境变量 `LOAD_TEST_VUS` / `LOAD_TEST_DURATION` / `LOAD_TEST_P99_THRESHOLD`。
- [ ] **集成测试完善**：`integration-tests` 阶段当前为宽松模式（测试未配置时仅警告），需补充针对预发布 Dify 实例的真实 API 集成用例。
- [ ] **覆盖率门禁提升**：当前 Jest 覆盖率门槛 60%，低于行业建议（关键路径 80%+）。建议分两步提升：v0.5.0 → 70%，v0.6.0 → 80%。（来源：`docs/design/industry-comparison.md`）

### 安全

- [ ] **审计日志**：所有 Agent 操作需写入不可变审计日志（S3 / CloudTrail），企业合规的最紧迫需求。
- [ ] **PII 检测**：集成 Presidio 或 Guardrails AI，阻止敏感信息流入 LLM 上下文。
- [ ] **RBAC v0**：区分最基础的管理员/操作员/只读三个角色，消除当前单租户无权限隔离的高风险状态。

### 可观测性

- [ ] **Langfuse 接入**：当前 LLM 调用完全黑盒。通过 `docker compose` 部署 Langfuse 自托管实例，在 MCP Server 与 Tool Service 中集成 OpenTelemetry SDK，上报 Span 至 Langfuse，配置 Token 成本告警与 P99 延迟基线。预计 1 周。（优先级：最高）

---

## v0.5.0 规划

| 条目 | 优先级 | 预估工作量 |
|---|---|---|
| SBOM 上传至 S3/GCS | P1 | 0.5 天 |
| Langfuse 可观测性接入 | P1 | 1 周 |
| load-test 阈值可配置化 | P2 | 0.5 天 |
| 集成测试用例补充 | P2 | 1 周 |
| 覆盖率门禁提升至 70% | P2 | 视代码覆盖情况 |
| 审计日志（不可变存储） | P1 | 1-2 周 |

---

## 短期优先级（0–3 个月 / Q2 2026）

来源：`docs/design/industry-comparison.md § 8.1`

### 建议一：Langfuse 可观测性（优先级：最高）

在生产 AI 系统中盲目运行是不可接受的风险。

**实施方案：**
1. `docker compose` 部署 Langfuse 自托管实例
2. MCP Server 与 Tool Service 集成 OpenTelemetry SDK，Span 上报至 Langfuse
3. 配置 Token 成本告警阈值与 P99 延迟基线

**成功指标：** LLM 调用 100% 有追踪记录

---

### 建议二：Dify API 抽象层（优先级：高）

直接操纵 PostgreSQL 已在 Pydantic v2 升级中造成实际故障，每次 Dify 版本升级均是潜在的系统中断。

**实施方案：**
1. 封装所有 DB 操作为版本化适配器接口 `DifyAdapterV1`
2. CI 中引入 contract test 套件，验证适配器与目标 Dify 版本的兼容性
3. 逐步将直接 SQL 迁移至 Dify 官方 REST API 或 Webhook

**成功指标：** 零直接 SQL 操作；Dify 版本升级耗时 < 1 天

---

### 建议三：Guardrails 防护层（优先级：高）

当前对 LLM 输入输出无任何校验，存在提示词注入、PII 泄露、有害内容输出等风险。

**实施方案：**
- 部署 Guardrails AI 或 LlamaGuard 作为请求/响应拦截中间件
- 实现输入净化、PII 自动脱敏、输出合规检测

**成功指标：** PII 检测召回率 > 95%；prompt injection 拦截率 > 99%

---

### 建议四：容器编排迁移（优先级：中）

单机 Docker Compose 无法满足高可用要求。

**实施方案：**
- 近期：Docker Swarm 作为低成本过渡方案
- 中期：Helm Chart 管理完整部署生命周期，接入 ArgoCD GitOps

**成功指标：** 部署成功率 > 99%；支持多副本水平扩展

---

### 建议五：多租户与 RBAC（优先级：中）

企业客户商业化的必要前提。

**实施方案：**
- 角色定义：`Platform Admin` / `Project Owner` / `Developer` / `Viewer`
- 通过 JWT Claims 传递租户上下文
- 组件 YAML 与工具调用权限在租户边界内隔离

**成功指标：** RBAC 覆盖所有 API 端点；支持 10+ 租户并发

---

## DevKit 组件覆盖路线（CDD 设计文档）

来源：`docs/design/cdd-design.md § 7`，状态：**Phase 1 已完成，Phase 2-6 待实施**

| Phase | 目标 | 主要交付物 | 预估工时 |
|---|---|---|---|
| **Phase 1** ✅ | 基础设施 | `dify-dev create tool` / `deploy` 可用，Tool 完整生命周期 | 已完成 |
| **Phase 2** | Workflow DSL | `dify-dev create workflow`，支持条件分支、循环、HITL 节点 | 2 周 |
| **Phase 3** | Agent & Chatflow | `dify-dev create agent/chatflow`，工具绑定、记忆配置 | 2 周 |
| **Phase 4** | 知识库 & 文本生成 | `dify-dev create knowledge/text-generation`，文件/Web/API 数据源 | 2 周 |
| **Phase 5** | LLM 智能化 | 自然语言生成组件代码，`dify-dev iterate` 迭代优化 | 2 周 |
| **Phase 6** | 生产化 | 多环境、CI/CD 深度集成、监控日志、权限管理、完整文档 | 2 周 |

---

## 中期架构演进（3–12 个月 / Q3–Q4 2026）

目标：从单机原型演进为生产级企业平台。

```
外部流量
    │
    ▼
Ingress-NGINX / Cloudflare Tunnel
    │
    ▼
Guardrails Pipeline
(PII Detection | Prompt Injection Filter | Output Validation)
    │
    ├──────────────────┬──────────────────┐
    ▼                  ▼                  ▼
Dify Platform     MCP Server Pool    Tool Service
(K8s, 多租户)    (K8s StatefulSet)  (K8s, Auto-scaling)
    │                  │                  │
    └──────────────────┴──────────────────┘
                       │ OpenTelemetry (TraceID propagation)
                       ▼
         Langfuse │ Prometheus │ Grafana │ Alertmanager
                       │
                       ▼
         ArgoCD (Helm Chart Sync) + GitHub Actions CI
         DevKit CLI → YAML DSL → Git → ArgoCD → K8s
                       │
                       ▼
         HashiCorp Vault (动态密钥) │ OPA / Kyverno (策略即代码)
                       │
                       ▼
         RBAC (4 roles) │ Tenant Namespace Isolation │ Audit Log (S3)
```

---

## 长期竞争力建议（6–18 个月 / Q4 2026–Q2 2027）

来源：`docs/design/industry-comparison.md § 8.3`

| # | 方向 | 核心价值 |
|---|---|---|
| 1 | **DevKit 开源为独立工具（非 Dify 专属）** | 扩大用户基数，建立开源社区飞轮；Plugin 形式支持 Dify、Langflow、LangChain |
| 2 | **多后端适配器** | `ComponentBackend` 统一接口，DevKit 成为跨平台"AI 组件 Terraform" |
| 3 | **组件市场（Component Marketplace）** | 类 Terraform Registry，团队发布/发现/复用已验证组件模板 |
| 4 | **VS Code 扩展** | YAML 校验、lint、一键部署集成至 IDE；语法高亮、Schema 补全、部署状态展示 |
| 5 | **MCP 原生优先策略** | 将"MCP 组件的代码驱动管理"作为核心卖点，抢占新兴标准的最佳实践定义权 |

---

## 里程碑时间线

来源：`docs/design/industry-comparison.md § 8.5`

| 时间 | 里程碑 | 成功指标 |
|---|---|---|
| **Q2 2026**（0–3 月） | 可观测性基线；DB 抽象层；静态密钥迁移至 Vault | LLM 调用 100% 有追踪；零直接 SQL；密钥轮换 < 5 分钟 |
| **Q3 2026**（3–6 月） | K8s 迁移（Swarm 过渡）；RBAC v1；Guardrails 防护层 | 部署成功率 > 99%；RBAC 覆盖所有端点；PII 召回率 > 95% |
| **Q4 2026**（6–9 月） | 多租户架构；Workflow Phase 2；本地 LLM 测试集成 | 支持 10+ 租户；CI 不依赖外部 LLM API；审计日志覆盖 100% |
| **Q1 2027**（9–12 月） | DevKit 后端无关化；VS Code 扩展 Beta；组件市场 v1 | 支持 Dify + Langflow 双后端；VS Code MAU > 100；市场组件 > 20 |
| **Q2 2027**（12–18 月） | Agent Phase 3；混沌工程集成；多模型网关 | Agent 任务成功率 > 90%；混沌测试每月执行；模型切换 < 1 天 |

---

## 已知风险

来源：`docs/design/industry-comparison.md § 8.4`

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| **Dify 平台单一依赖**（直接 DB 操纵，版本升级即断裂） | 高 | 高 | 短期锁版本；中期完成 API 抽象层；长期 DevKit 后端无关化 |
| **MCP 协议成熟度**（SSE 长连接可靠性未经大规模验证） | 中 | 中 | 所有 MCP 工具提供 REST Fallback；季度 SDK 升级窗口；K8s 迁移时评估 Stdio 传输 |
| **Phase 1 技术债务积累**（直接 DB、单租户、无可观测性、静态密钥） | 高 | 高 | Phase 2 启动前必须完成 DB 抽象层与 Langfuse 接入；债务偿还与功能需求 3:7 混排；CI 引入架构守护测试 |

---

## 变更记录

| 日期 | 版本 | 变更内容 |
|---|---|---|
| 2026-04-23 | v0.4.0 | 新增 load-test 阶段（k6）、生产自动回滚、REDIS_URL / JWKS_URI / PROMPT_GUARD_CLASSIFIER_URL |
| 2026-04-23 | — | 创建本 ROADMAP 文件，整合架构审查中所有待改进项 |
