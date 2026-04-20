# P2 安全合规加固计划

> 执行周期：4周（Week 3–6）
> 合规要求：SOC2 Type I 准备的前提条件
> 优先级：P2（在 P1 可观测性完成后立即启动）

---

## 当前安全评估

基于 OWASP LLM Top 10（2025版）对本项目的覆盖度如实评估：

| OWASP LLM 风险项 | 当前覆盖状态 | 说明 |
|---|---|---|
| LLM01: Prompt Injection | 未覆盖 | MCP 工具接受任意用户输入，无清洗层 |
| LLM02: Insecure Output Handling | 未覆盖 | tool-service 直接透传 LLM 输出至下游 |
| LLM03: Training Data Poisoning | 不适用 | 本项目不做模型训练 |
| LLM04: Model Denial of Service | 部分 | 无请求速率限制，无并发上限 |
| LLM05: Supply Chain Vulnerabilities | 部分覆盖 | npm audit 已接入 CI，但无 SBOM |
| LLM06: Sensitive Information Disclosure | 未覆盖 | PII 可能经 LLM 泄露，无脱敏机制 |
| LLM07: Insecure Plugin Design | 未覆盖 | MCP server 无输入 schema 校验 |
| LLM08: Excessive Agency | 未覆盖 | Agent 调用工具无审批流、无最小权限 |
| LLM09: Overreliance | 不适用 | 属于使用规范问题 |
| LLM10: Model Theft | 低风险 | 使用 Dify 托管模型，风险由上游承担 |

**结论**：关键风险（LLM01、LLM06、LLM08）全部未覆盖，需在本阶段全部闭合。

---

## P2-1: RBAC 权限体系实现

### 角色设计

系统定义四个内置角色，遵循最小权限原则：

| 角色 | 说明 | 典型用户 |
|---|---|---|
| `platform_admin` | 平台超级管理员 | 运维、SRE |
| `project_owner` | 项目所有者 | 技术负责人 |
| `developer` | 开发者 | 工程师 |
| `viewer` | 只读观察者 | 审计员、业务方 |

**权限矩阵：**

| 操作 | platform_admin | project_owner | developer | viewer |
|---|:---:|:---:|:---:|:---:|
| 管理用户/角色 | Y | N | N | N |
| 创建/删除项目 | Y | Y | N | N |
| 部署组件 | Y | Y | Y | N |
| 调用工具 API | Y | Y | Y | N |
| 修改密钥/凭证 | Y | Y | N | N |
| 查看审计日志 | Y | Y | N | N |
| 只读查看 | Y | Y | Y | Y |

### 实现方案（JWT + Express Middleware）

新增文件路径：`enterprise/tool-service/src/middleware/rbac.ts`

```typescript
// enterprise/tool-service/src/middleware/rbac.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type Role = 'platform_admin' | 'project_owner' | 'developer' | 'viewer';

export interface JwtClaims {
  sub: string;          // user ID
  email: string;
  role: Role;
  tenant_id: string;    // for future multi-tenancy (P3)
  project_ids: string[]; // scoped project access
  iat: number;
  exp: number;
}

const ROLE_HIERARCHY: Record<Role, number> = {
  platform_admin: 40,
  project_owner: 30,
  developer: 20,
  viewer: 10,
};

export function requireRole(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    try {
      const claims = jwt.verify(token, process.env.JWT_SECRET!) as JwtClaims;
      const userLevel = ROLE_HIERARCHY[claims.role] ?? 0;
      const requiredLevel = ROLE_HIERARCHY[minRole];

      if (userLevel < requiredLevel) {
        res.status(403).json({
          error: 'Insufficient permissions',
          required: minRole,
          actual: claims.role,
        });
        return;
      }

      // Attach claims to request for downstream handlers
      (req as any).user = claims;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

// Usage example in enterprise/tool-service/src/routes/tools.ts:
// router.post('/tools/invoke', requireRole('developer'), toolInvokeHandler);
// router.delete('/tools/:id', requireRole('project_owner'), toolDeleteHandler);
// router.get('/admin/users', requireRole('platform_admin'), userListHandler);
```

JWT 签发时需在 `enterprise/tool-service/src/auth/token.ts` 中包含上述 claims 结构，`JWT_SECRET` 通过 Vault / Secret Manager 注入（替代现有静态 `.env`，详见 P2-5）。

### 工作量：5人天

---

## P2-2: 审计日志系统

### 审计事件分类

| 事件类型 | 触发场景 | 保留期 |
|---|---|---|
| `component.deploy` | 通过 dev-kit CLI 部署组件 | 1年 |
| `tool.invoke` | Agent 调用 MCP 工具 | 90天 |
| `credential.change` | 凭证新增/轮转/删除 | 永久 |
| `user.login` / `user.logout` | 身份认证事件 | 1年 |
| `rbac.change` | 角色分配变更 | 永久 |
| `policy.violation` | RBAC 拒绝、Prompt 注入检测命中 | 1年 |

### 实现方案

新增目录：`enterprise/dev-kit/src/audit/`

**PostgreSQL 审计表 DDL：**

```sql
-- enterprise/dev-kit/src/audit/schema.sql

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  VARCHAR(64)  NOT NULL,
  actor_id    VARCHAR(128) NOT NULL,  -- user ID or 'system'
  actor_role  VARCHAR(32),
  tenant_id   VARCHAR(64),
  resource    VARCHAR(256),           -- e.g. 'tool:wechat-send', 'component:mcp-wechat'
  action      VARCHAR(64)  NOT NULL,
  result      VARCHAR(16)  NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  metadata    JSONB,                  -- arbitrary context (request_id, ip, etc.)
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor    ON audit_logs (actor_id, created_at DESC);
CREATE INDEX idx_audit_logs_tenant   ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_event    ON audit_logs (event_type, created_at DESC);
```

**审计服务实现：**

```typescript
// enterprise/dev-kit/src/audit/audit-service.ts

import { Pool } from 'pg';

export interface AuditEvent {
  event_type: string;
  actor_id: string;
  actor_role?: string;
  tenant_id?: string;
  resource?: string;
  action: string;
  result: 'success' | 'failure' | 'denied';
  metadata?: Record<string, unknown>;
}

export class AuditService {
  constructor(private pool: Pool) {}

  async log(event: AuditEvent): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_logs
           (event_type, actor_id, actor_role, tenant_id, resource, action, result, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          event.event_type,
          event.actor_id,
          event.actor_role ?? null,
          event.tenant_id ?? null,
          event.resource ?? null,
          event.action,
          event.result,
          event.metadata ? JSON.stringify(event.metadata) : null,
        ]
      );
    } catch (err) {
      // Audit failures must NEVER break the main request path.
      // Route to a dead-letter queue or secondary log sink instead.
      console.error('[AuditService] Failed to write audit log:', err);
    }
  }
}

// Integrate into RBAC middleware: when requireRole() denies access,
// call auditService.log({ event_type: 'policy.violation', result: 'denied', ... })
```

### 工作量：3人天

---

## P2-3: Prompt 注入防御

### 攻击面分析

本系统的 Prompt 注入风险集中于以下路径：

1. **MCP 工具输入**：用户通过 Agent 传入的工具参数（如 `mcp-wechat` 的消息内容）可携带指令覆写 system prompt。
2. **YAML DSL 解析**：`dev-kit` 的 YAML 配置若来自不可信来源，可能注入恶意描述字段传递给 LLM。
3. **tool-service 透传**：`enterprise/tool-service` 将用户输入直接拼接到发往 Dify 的请求体中，无过滤层。

### 防御方案

**方案一：输入清洗中间件**（立即实施）

```typescript
// enterprise/tool-service/src/middleware/prompt-guard.ts

import { Request, Response, NextFunction } from 'express';

// Patterns that signal injection attempts targeting system prompt override
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /system\s*:\s*you\s+are/i,
  /\bact\s+as\s+(a\s+)?(?:different|new|another)\b/i,
  /\bjailbreak\b/i,
  /\bdan\s+mode\b/i,
  /<\s*system\s*>/i,           // XML-style system tag injection
  /\[\s*system\s*\]/i,          // bracket-style system tag injection
  /#{3,}\s*system/i,            // markdown heading injection
];

const MAX_INPUT_LENGTH = 4000;  // tokens proxy; tune per model context window

export function promptGuard(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as Record<string, unknown>;
  const textFields = extractTextFields(body);

  for (const [field, value] of textFields) {
    if (value.length > MAX_INPUT_LENGTH) {
      res.status(400).json({ error: `Field '${field}' exceeds maximum allowed length` });
      return;
    }
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        // Log the violation via AuditService before rejecting
        console.warn(`[PromptGuard] Injection pattern detected in field '${field}'`);
        res.status(400).json({ error: 'Input contains disallowed content' });
        return;
      }
    }
  }
  next();
}

function extractTextFields(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  const results: [string, string][] = [];
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'string') results.push([path, val]);
    else if (val && typeof val === 'object') {
      results.push(...extractTextFields(val as Record<string, unknown>, path));
    }
  }
  return results;
}
```

**方案二：Guardrails AI sidecar**（Week 5 接入）

在 `docker-compose.yml` 中新增 Guardrails AI 服务作为 sidecar，`tool-service` 在转发至 Dify 前先调用其验证 API：

```yaml
# docker-compose.yml 新增 service（在 P2 阶段追加）
  guardrails:
    image: guardrailsai/guardrails-server:latest
    environment:
      - GUARDRAILS_TOKEN=${GUARDRAILS_TOKEN}
    ports:
      - "8000:8000"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

### 工作量：3人天

---

## P2-4: PII 检测与脱敏

### 风险场景

用户通过 Agent 发送的消息可能包含：
- 中国居民身份证号（18位）
- 手机号（+86 格式或 11位）
- 银行卡号（16–19位）
- 姓名 + 手机号组合（高风险）

这些数据若经 LLM 处理后被记录在日志或审计系统中，将违反《个人信息保护法》（PIPL）的最小化原则。

### 方案：Microsoft Presidio 集成

**docker-compose.yml 新增：**

```yaml
# enterprise/presidio 服务（P2 阶段追加至 docker-compose.yml）
  presidio-analyzer:
    image: mcr.microsoft.com/presidio-analyzer:latest
    ports:
      - "5001:3000"
    restart: unless-stopped

  presidio-anonymizer:
    image: mcr.microsoft.com/presidio-anonymizer:latest
    ports:
      - "5002:3000"
    restart: unless-stopped
```

**TypeScript 调用封装（**`enterprise/tool-service/src/pii/presidio-client.ts`**）：**

```typescript
// enterprise/tool-service/src/pii/presidio-client.ts

import axios from 'axios';

const ANALYZER_URL  = process.env.PRESIDIO_ANALYZER_URL  ?? 'http://presidio-analyzer:3000';
const ANONYMIZER_URL = process.env.PRESIDIO_ANONYMIZER_URL ?? 'http://presidio-anonymizer:3000';

// Chinese PII patterns (补充 Presidio 默认识别器未覆盖的中国场景)
const CHINESE_PII_PATTERNS = [
  {
    name: 'CN_ID_CARD',
    regex: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    replacement: '[身份证号已脱敏]',
  },
  {
    name: 'CN_PHONE',
    regex: /(?:\+?86[-\s]?)?1[3-9]\d{9}\b/g,
    replacement: '[手机号已脱敏]',
  },
  {
    name: 'CN_BANK_CARD',
    regex: /\b(?:6\d{15,18}|4\d{15}|5[1-5]\d{14})\b/g,
    replacement: '[银行卡号已脱敏]',
  },
];

export async function anonymizeText(text: string): Promise<string> {
  // Step 1: Apply Chinese-specific regex patterns locally (fast path)
  let sanitized = text;
  for (const pattern of CHINESE_PII_PATTERNS) {
    sanitized = sanitized.replace(pattern.regex, pattern.replacement);
  }

  // Step 2: Call Presidio for international PII (email, credit cards, etc.)
  try {
    const analyzeRes = await axios.post(`${ANALYZER_URL}/analyze`, {
      text: sanitized,
      language: 'zh',
    });

    if (analyzeRes.data.length === 0) return sanitized;

    const anonymizeRes = await axios.post(`${ANONYMIZER_URL}/anonymize`, {
      text: sanitized,
      analyzer_results: analyzeRes.data,
      anonymizers: {
        DEFAULT: { type: 'replace', new_value: '[REDACTED]' },
      },
    });

    return anonymizeRes.data.text as string;
  } catch (err) {
    // If Presidio is unavailable, fall back to regex-only result (degraded mode)
    console.error('[PIIClient] Presidio unavailable, using regex-only sanitization');
    return sanitized;
  }
}
```

**集成点**：在 `promptGuard` 中间件之后、转发至 Dify 之前，调用 `anonymizeText()` 处理所有用户输入字段。

### 工作量：4人天

---

## P2-5: CI/CD 安全增强

在现有 `.github/workflows/agent-ci.yml` 的 `security-scan` job 后追加以下步骤：

```yaml
# .github/workflows/agent-ci.yml — 在现有 TruffleHog/CodeQL/npm audit 步骤之后追加

      - name: License compliance check
        run: |
          npx license-checker --production --failOn "GPL-2.0;GPL-3.0;AGPL-3.0" \
            --excludePackages "" --json > license-report.json
          echo "License check passed"

      - name: Container image scan (Trivy)
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: 'ghcr.io/${{ github.repository }}/tool-service:${{ github.sha }}'
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'

      - name: Upload Trivy SARIF to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'
          category: 'container-scanning'

      - name: Generate SBOM (Syft)
        uses: anchore/sbom-action@v0
        with:
          image: 'ghcr.io/${{ github.repository }}/tool-service:${{ github.sha }}'
          format: spdx-json
          output-file: sbom.spdx.json

      - name: Upload SBOM artifact
        uses: actions/upload-artifact@v4
        with:
          name: sbom-${{ github.sha }}
          path: sbom.spdx.json
          retention-days: 90

      - name: Verify no hardcoded secrets in .env.example
        run: |
          if grep -E "(password|secret|key)\s*=\s*['\"]?[A-Za-z0-9+/]{16,}" \
               .env.example 2>/dev/null; then
            echo "ERROR: Hardcoded secret values detected in .env.example"
            exit 1
          fi
          echo "Secret hygiene check passed"
```

**注**：Trivy 扫描需要在 `build` job 之后运行，确保镜像已推送至 GHCR。调整 job 依赖：`security-scan` → `needs: [build, test]`。

---

## 验收标准 & 合规检查清单

| 检查项 | 验收方式 | 负责人 |
|---|---|---|
| RBAC middleware 覆盖所有 API 路由 | 路由枚举测试 + 集成测试 | 后端 |
| JWT 签发/验证流程通过渗透测试 | 手工测试：token 篡改、过期 | 安全 |
| 审计日志 100% 覆盖定义的 6 类事件 | 集成测试断言 DB 写入 | 后端 |
| 审计日志写入失败不影响主请求 | chaos 测试：DB 断连 | SRE |
| Prompt 注入测试集全部拦截 | 自动化测试（OWASP LLM01 样本库）| 安全 |
| PII 脱敏覆盖：身份证、手机、银行卡 | 单元测试：正例/负例各20条 | 后端 |
| CI Trivy 扫描无 CRITICAL 漏洞 | CI badge green | DevOps |
| SBOM 已生成并存档 | Artifact 存在于 GitHub Actions | DevOps |
| 测试覆盖率维持 ≥ 60%（新增代码需 ≥ 80%）| Jest coverage report | 全员 |
