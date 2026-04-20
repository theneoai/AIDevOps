# P0 紧急修复计划

> 执行周期：2周内完成
> 阻塞原因：这些问题不解决，Phase 2 开发将在不稳定基础上叠加更多技术债
> 优先级：P0（全员停新需求，立即修复）

---

## 当前技术债评估

| 风险项 | 严重程度 | 当前状态 |
|---|---|---|
| 直接写 Dify PostgreSQL（绕过 API） | 极高 | `enterprise/dev-kit/src/registry/db-client.ts` 直接执行 INSERT/UPDATE |
| Pydantic v2 升级导致 27 个验证错误 | 极高 | Dify 升级到 0.15.x 后字段映射断裂 |
| `.env` 明文存储微信 AppSecret | 高 | `WECHAT_APP_SECRET=your-wechat-app-secret` 静态写在环境变量 |
| Dify git submodule 跟踪 `main` 分支 | 高 | `.gitmodules` 中 `branch = main`，任何上游 commit 都可破坏本地 |
| MCP SSE body parsing 冲突 | 中（已绕过） | `index.ts` 的 `express.json` type-guard 是临时补丁 |

---

## P0-1: Dify API 抽象层重构

### 背景

当前 `DifyDbClient`（`enterprise/dev-kit/src/registry/db-client.ts`）直接向 Dify 的 PostgreSQL 执行原生 SQL：

```sql
INSERT INTO tool_api_providers (id, tenant_id, name, icon, schema, schema_type_str, ...)
INSERT INTO tool_mcp_providers (id, tenant_id, user_id, name, server_identifier, ...)
```

这产生了两类耦合：

1. **表结构耦合**：Dify 的 DB schema 在每个 minor 版本都可能变更（0.14→0.15 时 `tool_mcp_providers` 新增了 `authed` 字段，导致现有 INSERT 语句失败）。
2. **业务逻辑耦合**：Dify 内部对 `server_url` 有 RSA 加密、对 `schema` 有 OpenAPI 校验，直连 DB 绕过了这些不变量，留下隐蔽的数据不一致。

Pydantic v2 升级（`pydantic>=2.0`）已经直接导致 Dify API 层 27 个 ValidationError，其中 `tool_api_providers.credentials_str` 字段的序列化格式从 `str(dict)` 变为 `json.dumps(dict)`，导致所有已注册工具在 Dify 重启后无法加载。

### 重构方案

引入适配器接口层，将"Dify 内部实现"与"DevKit 业务逻辑"隔离。短期使用 Dify REST API；当 API 不可用时降级到 DB（保留但标记为 deprecated）。

**新增文件结构：**

```
enterprise/dev-kit/src/
├── adapters/
│   ├── dify-adapter.interface.ts   ← 纯接口定义，不依赖任何实现
│   ├── dify-api-adapter.ts         ← 调用 Dify REST API（推荐）
│   ├── dify-db-adapter.ts          ← 保留旧 DB 实现（标记 @deprecated）
│   └── index.ts                    ← 工厂函数，按配置选择适配器
└── registry/
    ├── dify-client.ts              ← 改为依赖 IDifyAdapter 接口
    └── db-client.ts                ← 保留但仅作 fallback
```

### 任务分解

**第 1 天：**
- [ ] 新建 `enterprise/dev-kit/src/adapters/dify-adapter.interface.ts`，定义 `IDifyAdapter` 接口
- [ ] 新建 `enterprise/dev-kit/src/adapters/dify-api-adapter.ts`，实现基于 REST API 的适配器
- [ ] 在 `enterprise/dev-kit/src/core/config.ts` 新增 `dify.apiKey` 和 `dify.baseUrl` 配置项

**第 2 天：**
- [ ] 重构 `enterprise/dev-kit/src/registry/dify-client.ts`，将 `DifyDbClient` 替换为 `IDifyAdapter`
- [ ] 新建 `enterprise/dev-kit/src/adapters/dify-db-adapter.ts`，将原 `db-client.ts` 逻辑迁移进去并打上 `@deprecated` 注释
- [ ] 新建 `enterprise/dev-kit/src/adapters/index.ts`，实现适配器工厂

**第 3 天：**
- [ ] 为 `DifyApiAdapter` 编写单元测试（`enterprise/dev-kit/tests/dify-api-adapter.test.ts`）
- [ ] 更新 `enterprise/dev-kit/dify-dev.yaml` 添加 `adapter: api | db` 配置开关
- [ ] 更新 `.env.example` 添加 `DIFY_API_KEY` 和 `DIFY_BASE_URL`

### 代码示例

```typescript
// enterprise/dev-kit/src/adapters/dify-adapter.interface.ts

import { ToolDSL } from '../types/dsl';

export interface ToolRegistrationResult {
  success: boolean;
  providerId: string;
  providerType: 'api' | 'mcp';
  action: 'created' | 'updated';
  message: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  type: 'api' | 'mcp';
  updatedAt: Date;
}

/**
 * Dify 适配器统一接口。
 * 所有对 Dify 状态的写操作必须经过此接口，禁止直接操作 PostgreSQL。
 */
export interface IDifyAdapter {
  /** 初始化连接（API：验证 token；DB：建立连接池） */
  connect(): Promise<void>;

  /** 释放资源 */
  disconnect(): Promise<void>;

  /** 注册或更新工具提供者 */
  registerTool(dsl: ToolDSL): Promise<ToolRegistrationResult>;

  /** 列出当前租户下所有提供者 */
  listProviders(tenantId?: string): Promise<ProviderStatus[]>;

  /** 删除工具提供者 */
  deleteProvider(providerId: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// enterprise/dev-kit/src/adapters/dify-api-adapter.ts

import axios, { AxiosInstance } from 'axios';
import { IDifyAdapter, ToolRegistrationResult, ProviderStatus } from './dify-adapter.interface';
import { ToolDSL } from '../types/dsl';

export class DifyApiAdapter implements IDifyAdapter {
  private client: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
  }

  async connect(): Promise<void> {
    // Validate API key by calling a lightweight endpoint
    await this.client.get('/v1/info');
  }

  async disconnect(): Promise<void> {
    // HTTP client: no persistent connection to close
  }

  async registerTool(dsl: ToolDSL): Promise<ToolRegistrationResult> {
    const endpoint = dsl.spec.type === 'api'
      ? '/v1/workspaces/current/tool-providers/api'
      : '/v1/workspaces/current/tool-providers/mcp';

    const response = await this.client.post(endpoint, dsl);
    return {
      success: true,
      providerId: response.data.id,
      providerType: dsl.spec.type,
      action: response.status === 201 ? 'created' : 'updated',
      message: `Tool '${dsl.metadata.name}' registered via Dify API`,
    };
  }

  async listProviders(tenantId?: string): Promise<ProviderStatus[]> {
    const params = tenantId ? { tenant_id: tenantId } : {};
    const response = await this.client.get('/v1/workspaces/current/tool-providers', { params });
    return response.data.data.map((p: Record<string, unknown>) => ({
      id: p.id as string,
      name: p.name as string,
      type: p.type as 'api' | 'mcp',
      updatedAt: new Date(p.updated_at as string),
    }));
  }

  async deleteProvider(providerId: string): Promise<void> {
    await this.client.delete(`/v1/workspaces/current/tool-providers/${providerId}`);
  }
}

// ─────────────────────────────────────────────────────────────
// enterprise/dev-kit/src/adapters/index.ts  (工厂函数)

import { IDifyAdapter } from './dify-adapter.interface';
import { DifyApiAdapter } from './dify-api-adapter';
import { DifyDbAdapter } from './dify-db-adapter';
import { DevKitConfig } from '../core/config';

export function createDifyAdapter(config: DevKitConfig): IDifyAdapter {
  const adapterType = config.dify.adapter ?? 'api';

  if (adapterType === 'api') {
    if (!config.dify.apiKey || !config.dify.baseUrl) {
      throw new Error(
        'adapter=api requires DIFY_API_KEY and DIFY_BASE_URL. ' +
        'Set adapter=db in dify-dev.yaml to use the legacy DB adapter.'
      );
    }
    return new DifyApiAdapter(config.dify.baseUrl, config.dify.apiKey);
  }

  // @deprecated: DB adapter will be removed in v0.4.0
  console.warn('[DEPRECATED] dify.adapter=db bypasses Dify API. Migrate to adapter=api.');
  return new DifyDbAdapter(config.dify.db);
}
```

### 验收标准

- [ ] `npm run typecheck` 零错误，所有直接 SQL 调用从 `dify-client.ts` 中消除
- [ ] `DifyApiAdapter` 单元测试覆盖率 ≥ 80%（mock axios）
- [ ] `dify-dev.yaml` 中 `adapter: api` 为默认值，CI 部署使用 REST API
- [ ] `DifyDbAdapter` 保留但打上 `@deprecated` JSDoc 注释，计划在 v0.4.0 删除
- [ ] 在 `DIFY_BASE_URL=http://localhost/v1` 和真实 staging 环境中均验证工具注册成功

### 工作量：3 人天

---

## P0-2: 静态密钥迁移（.env → Vault/Secrets Manager）

### 背景

当前密钥管理现状：

```bash
# .env.example（明文模板，真实 .env 同结构）
WECHAT_APP_ID=your-wechat-app-id
WECHAT_APP_SECRET=your-wechat-app-secret   # 高危：微信 API 主密钥
DIFY_DB_PASSWORD=difyai123456              # 高危：PostgreSQL root 密码（见 docker-compose.yml）
```

`docker-compose.yml` 通过 `environment:` 块直接传入容器，`mcp-wechat` 服务的 `WECHAT_APP_SECRET` 在容器内部以明文出现在 `docker inspect` 输出中，任何有 Docker socket 访问权限的人员均可提取。

风险：微信 AppSecret 被盗后攻击者可完全接管公众号，无法在不更换 AppID 的情况下撤销。

### 方案：Docker Secrets（短期）→ HashiCorp Vault（中期）

**阶段一（本周）：Docker Secrets**
- 将敏感变量从 `environment:` 迁移到 Docker Swarm/Compose secrets
- 容器内以 `/run/secrets/<name>` 文件形式挂载，避免 `docker inspect` 泄露

**阶段二（第 2 周）：HashiCorp Vault Agent**
- 部署 Vault 容器，与 Dify 共享 `dify-network`
- 使用 Vault Agent Sidecar 注入凭证，支持动态轮转

### 任务分解

**第 1 天（Docker Secrets）：**
- [ ] 修改 `docker-compose.yml`，将 `WECHAT_APP_SECRET`、`DIFY_DB_PASSWORD` 从 `environment` 移到 `secrets` 块
- [ ] 修改 `enterprise/mcp-servers/mcp-wechat/src/config.ts`，支持从 `/run/secrets/wechat_app_secret` 文件读取
- [ ] 创建 `enterprise/mcp-servers/mcp-wechat/src/secrets.ts`，封装 secret 读取逻辑
- [ ] 更新 `README.md` 的环境变量配置说明

**第 2–3 天（Vault 部署）：**
- [ ] 新增 `docker-compose.vault.yml`，定义 Vault 服务
- [ ] 新建 `enterprise/vault/config/vault.hcl`，配置 file storage + audit log
- [ ] 新建 `enterprise/vault/policies/mcp-wechat.hcl`，最小权限策略
- [ ] 编写 `enterprise/vault/init.sh`，一键初始化 Vault 并写入初始密钥

### 代码示例

```yaml
# docker-compose.yml 修改片段 —— 使用 Docker Secrets

secrets:
  wechat_app_secret:
    file: ./secrets/wechat_app_secret.txt   # 仅存在于服务器本地，不入 git
  dify_db_password:
    file: ./secrets/dify_db_password.txt

services:
  mcp-wechat:
    build:
      context: ./enterprise/mcp-servers/mcp-wechat
    secrets:
      - wechat_app_secret
    environment:
      - WECHAT_APP_ID=${WECHAT_APP_ID}
      # WECHAT_APP_SECRET 已移除，改由 /run/secrets/wechat_app_secret 读取
      - MCP_SERVER_PORT=3000
      - MCP_SERVER_PATH=/sse
      - LOG_LEVEL=${LOG_LEVEL:-info}
```

```typescript
// enterprise/mcp-servers/mcp-wechat/src/secrets.ts

import { readFileSync, existsSync } from 'fs';

/**
 * 按优先级读取 secret：
 * 1. Docker Secret 文件（/run/secrets/<name>）—— 生产推荐
 * 2. 环境变量 —— 开发/测试兼容
 * 3. 抛出错误 —— 明确失败，拒绝静默降级
 */
export function readSecret(name: string, envFallback: string): string {
  const secretPath = `/run/secrets/${name}`;

  if (existsSync(secretPath)) {
    return readFileSync(secretPath, 'utf-8').trim();
  }

  const envValue = process.env[envFallback];
  if (envValue && envValue !== '') {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        `[SECURITY] Secret '${name}' loaded from env var '${envFallback}'. ` +
        'Use Docker Secrets in production.'
      );
    }
    return envValue;
  }

  throw new Error(
    `Required secret '${name}' not found. ` +
    `Provide via /run/secrets/${name} or env var ${envFallback}.`
  );
}
```

```hcl
# enterprise/vault/config/vault.hcl

storage "file" {
  path = "/vault/data"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true   # TLS 由 nginx 反向代理终止
}

audit {
  type = "file"
  path = "/vault/logs/audit.log"
}

ui = false
```

```bash
#!/bin/bash
# enterprise/vault/init.sh — 首次初始化 Vault 并写入密钥

set -euo pipefail

VAULT_ADDR="http://localhost:8200"

echo "[1/4] Initializing Vault..."
vault operator init -key-shares=3 -key-threshold=2 \
  -format=json > /secure-location/vault-init.json

echo "[2/4] Unseal (手动执行，需要 2/3 unseal keys)..."
echo "Run: vault operator unseal <key1>"
echo "Run: vault operator unseal <key2>"

echo "[3/4] Writing secrets to kv/mcp-wechat..."
vault kv put kv/mcp-wechat \
  app_id="${WECHAT_APP_ID}" \
  app_secret="${WECHAT_APP_SECRET}"

echo "[4/4] Writing secrets to kv/dify-db..."
vault kv put kv/dify-db \
  password="${DIFY_DB_PASSWORD}"

echo "Done. Root token and unseal keys are in /secure-location/vault-init.json"
echo "IMPORTANT: Move this file offline immediately."
```

### 验收标准

- [ ] `docker inspect mcp-wechat` 输出中不再含有 `WECHAT_APP_SECRET` 明文
- [ ] `enterprise/mcp-servers/mcp-wechat/src/config.ts` 通过 `readSecret()` 读取 AppSecret，本地开发 fallback 到 env var
- [ ] `secrets/` 目录已加入 `.gitignore`，`git log --all --full-history -- secrets/` 为空
- [ ] Vault 服务启动后，`vault kv get kv/mcp-wechat` 返回正确值
- [ ] CI 流水线中的 secret scanning（trufflehog）通过，无新增泄漏

### 工作量：3 人天

---

## P0-3: Dify 版本锁定与兼容性测试

### 背景：随意升级 Dify 导致破坏性变更

当前 `.gitmodules` 配置：

```ini
[submodule "dify"]
    path = dify
    branch = main
    shallow = true
```

`branch = main` 意味着每次 `git submodule update --remote` 都会拉取 Dify 最新 commit，这已经至少造成两次生产事故：

1. Dify 0.15.0 将 `tool_mcp_providers.server_url` 从明文改为 RSA 加密存储，导致所有已注册 MCP 工具失效
2. Dify 升级 Pydantic v1→v2 后，`credentials_str` 字段序列化格式变更，引发 27 个 ValidationError

正确做法是 pin 到具体 commit SHA，并建立 contract test 在升级前验证兼容性。

### 方案：Commit SHA Pinning + Contract Tests

**原则：** 像管理 `package.json` 中的依赖版本一样管理 Dify submodule，任何升级都需要通过 contract test 验证后才能合并。

### 任务分解（具体到文件级）

**第 1 天：**
- [ ] 修改 `.gitmodules`：移除 `branch = main`，改为锁定当前 commit SHA
  ```bash
  cd dify && git log --oneline -1  # 记录当前 SHA
  git submodule set-branch --default dify  # 解除 branch tracking
  ```
- [ ] 新建 `enterprise/dev-kit/tests/contract/dify-schema.contract.test.ts`，验证 DB 表结构
- [ ] 新建 `enterprise/dev-kit/tests/contract/dify-api.contract.test.ts`，验证 REST API 响应格式

**第 2 天：**
- [ ] 新建 `enterprise/dev-kit/scripts/check-dify-compat.sh`，升级前自动运行 contract tests
- [ ] 在 `.github/workflows/agent-ci.yml` 中新增 `dify-compat` job，在 PR 时自动验证
- [ ] 新建 `DIFY_VERSION` 文件（项目根目录），记录当前锁定版本

**第 3 天：**
- [ ] 完善 contract tests 覆盖以下表/接口：
  - `tool_api_providers`（列名、类型、约束）
  - `tool_mcp_providers`（列名、类型、约束）
  - `GET /v1/info`（API 版本、功能开关）
  - `POST /v1/workspaces/current/tool-providers/api`（请求/响应格式）

### 代码示例

```typescript
// enterprise/dev-kit/tests/contract/dify-schema.contract.test.ts

import { Pool } from 'pg';

/**
 * Contract tests: 验证 Dify DB schema 与 DevKit 期望的结构一致。
 * 在 Dify 升级前必须通过，否则阻断升级。
 */
describe('Dify DB Schema Contract', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.DIFY_DB_HOST ?? 'localhost',
      port: Number(process.env.DIFY_DB_PORT ?? 5432),
      user: process.env.DIFY_DB_USER ?? 'postgres',
      password: process.env.DIFY_DB_PASSWORD,
      database: process.env.DIFY_DB_NAME ?? 'dify',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('tool_api_providers table', () => {
    it('should have all required columns with correct types', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'tool_api_providers'
        ORDER BY ordinal_position
      `);

      const columns = Object.fromEntries(
        result.rows.map((r) => [r.column_name, { type: r.data_type, nullable: r.is_nullable }])
      );

      // These columns MUST exist with these exact types
      expect(columns['id']?.type).toBe('uuid');
      expect(columns['tenant_id']?.type).toBe('uuid');
      expect(columns['name']?.type).toBe('character varying');
      expect(columns['schema_type_str']?.type).toBe('character varying');
      expect(columns['tools_str']?.type).toBe('text');
      expect(columns['credentials_str']?.type).toBe('text');
    });
  });

  describe('tool_mcp_providers table', () => {
    it('should have server_url_hash column (added in Dify 0.15.0)', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'tool_mcp_providers'
        AND column_name = 'server_url_hash'
      `);
      // If this fails after a Dify upgrade, DifyDbAdapter needs updating
      expect(result.rows.length).toBe(1);
    });

    it('should have authed column as boolean', async () => {
      const result = await pool.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'tool_mcp_providers'
        AND column_name = 'authed'
      `);
      expect(result.rows[0]?.data_type).toBe('boolean');
    });
  });
});
```

```bash
#!/bin/bash
# enterprise/dev-kit/scripts/check-dify-compat.sh
# 在 Dify submodule 升级前运行，验证兼容性

set -euo pipefail

CURRENT_SHA=$(git -C dify rev-parse HEAD)
PINNED_SHA=$(cat DIFY_VERSION)

if [ "$CURRENT_SHA" != "$PINNED_SHA" ]; then
  echo "WARNING: Dify submodule ($CURRENT_SHA) differs from pinned version ($PINNED_SHA)"
  echo "Running contract tests to verify compatibility..."

  cd enterprise/dev-kit
  npm run test -- --testPathPattern=contract --runInBand --forceExit

  if [ $? -eq 0 ]; then
    echo "Contract tests PASSED. Update DIFY_VERSION to $CURRENT_SHA to accept the upgrade."
  else
    echo "ERROR: Contract tests FAILED. Do not upgrade Dify until compatibility issues are resolved."
    exit 1
  fi
fi
```

```yaml
# .github/workflows/agent-ci.yml 新增 job（在 test-unit 之后）

  dify-compat:
    name: 'Dify Compatibility Check'
    runs-on: ubuntu-latest
    needs: [validate]
    if: contains(github.event.head_commit.message, '[dify-upgrade]') || github.event_name == 'workflow_dispatch'
    timeout-minutes: 10
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: difyai123456
          POSTGRES_DB: dify
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: enterprise/dev-kit/package-lock.json

      - name: Install dependencies
        working-directory: enterprise/dev-kit
        run: npm ci

      - name: Apply Dify DB migrations
        run: |
          psql -h localhost -U postgres -d dify \
            -f dify/api/migrations/versions/$(ls dify/api/migrations/versions/ | tail -1)

      - name: Run contract tests
        working-directory: enterprise/dev-kit
        run: npm test -- --testPathPattern=contract --runInBand --forceExit
        env:
          DIFY_DB_HOST: localhost
          DIFY_DB_PASSWORD: difyai123456
          DIFY_DB_NAME: dify
```

### 验收标准

- [ ] `.gitmodules` 中 `branch = main` 已移除，submodule 指向具体 commit SHA
- [ ] `DIFY_VERSION` 文件存在于项目根目录，格式为 `<sha> # dify@<tag>`
- [ ] Contract tests 覆盖 `tool_api_providers` 和 `tool_mcp_providers` 的所有 DevKit 使用到的列
- [ ] `check-dify-compat.sh` 在本地可正常运行，升级检测逻辑经过人工验证
- [ ] CI 中 `dify-compat` job 在含 `[dify-upgrade]` 的 commit message 时自动触发

### 工作量：3 人天

---

## 执行时序

```
Week 1                              Week 2
Mon  Tue  Wed  Thu  Fri  |  Mon  Tue  Wed  Thu  Fri
─────────────────────────|──────────────────────────
P0-1 API Adapter (3d)    |
     ←──────────────→    |
                P0-2 Secrets (3d)
                ←──────────────→
                              P0-3 Version Lock (3d)
                              ←──────────────→
```

**总工作量：9 人天**
**上线顺序：P0-1 → P0-2 → P0-3**（P0-1 完成后可并行启动 P0-2 和 P0-3）
