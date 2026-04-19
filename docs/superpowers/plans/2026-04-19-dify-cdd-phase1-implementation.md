# Dify 代码驱动开发框架（Dify-CDD）Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Dify-CDD DevKit 核心框架，支持 Tool（API 和 MCP）的完整生命周期（创建、测试、部署）。

**Architecture:** 基于 Node.js/TypeScript 构建 CLI 工具，通过 YAML DSL 定义组件，编译为 Dify 内部格式（JSON/SQL），通过 HTTP API 或直接数据库操作注册到 Dify。

**Tech Stack:** TypeScript, Node.js 18+, Commander.js (CLI), YAML, Zod (验证), Axios (HTTP), PostgreSQL (直接 DB 操作)

---

## 文件结构

```
enterprise/dev-kit/
├── src/
│   ├── cli.ts                    # CLI 入口
│   ├── commands/
│   │   ├── create.ts             # dify-dev create
│   │   ├── test.ts               # dify-dev test
│   │   ├── deploy.ts             # dify-dev deploy
│   │   └── status.ts             # dify-dev status
│   ├── core/
│   │   ├── parser.ts             # YAML DSL 解析器
│   │   ├── validator.ts          # 语义验证器
│   │   ├── compiler.ts           # 编译器（AST → Dify 格式）
│   │   └── config.ts             # 配置管理
│   ├── generators/
│   │   ├── tool-generator.ts     # Tool 代码生成器
│   │   └── template-engine.ts    # 模板引擎
│   ├── registry/
│   │   ├── dify-client.ts        # Dify API 客户端
│   │   └── db-client.ts          # 数据库客户端（直接操作）
│   ├── types/
│   │   ├── dsl.ts                # DSL 类型定义
│   │   └── dify.ts               # Dify 内部类型
│   └── utils/
│       ├── logger.ts             # 日志工具
│       └── fs.ts                 # 文件系统工具
├── templates/
│   ├── tool/
│   │   ├── api/
│   │   │   └── spec.yml          # API Tool 模板
│   │   └── mcp/
│   │       └── spec.yml          # MCP Tool 模板
│   └── README.md
├── tests/
│   ├── parser.test.ts
│   ├── compiler.test.ts
│   └── fixtures/
│       └── sample-tool.yml
├── package.json
├── tsconfig.json
└── README.md
```

---

## Task 1: 项目初始化

**Files:**
- Create: `enterprise/dev-kit/package.json`
- Create: `enterprise/dev-kit/tsconfig.json`
- Create: `enterprise/dev-kit/.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "@enterprise/dify-dev-kit",
  "version": "0.1.0",
  "description": "Dify 代码驱动开发工具包",
  "main": "dist/cli.js",
  "bin": {
    "dify-dev": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/cli.ts",
    "test": "jest",
    "lint": "eslint src/**/*.ts"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "yaml": "^2.4.0",
    "zod": "^3.22.0",
    "axios": "^1.6.0",
    "pg": "^8.11.0",
    "chalk": "^4.1.2",
    "ora": "^5.4.1",
    "inquirer": "^8.2.6",
    "fs-extra": "^11.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/pg": "^8.11.0",
    "@types/fs-extra": "^11.0.4",
    "@types/inquirer": "^8.2.10",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0",
    "ts-jest": "^29.1.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: 创建 .gitignore**

```
node_modules/
dist/
*.log
.env
.dify-dev/
coverage/
```

- [ ] **Step 4: 安装依赖**

Run: `cd enterprise/dev-kit && npm install`

Expected: `node_modules/` 目录创建，无错误

- [ ] **Step 5: Commit**

```bash
git add enterprise/dev-kit/package.json enterprise/dev-kit/tsconfig.json enterprise/dev-kit/.gitignore
git commit -m "chore: init dev-kit project with TypeScript and CLI dependencies"
```

---

## Task 2: 类型定义

**Files:**
- Create: `enterprise/dev-kit/src/types/dsl.ts`
- Create: `enterprise/dev-kit/src/types/dify.ts`

- [ ] **Step 1: 创建 DSL 类型定义**

```typescript
// src/types/dsl.ts

export interface DSLMetadata {
  name: string;
  description: string;
  icon?: string;
  version?: string;
  author?: string;
  labels?: string[];
  annotations?: Record<string, string>;
}

export interface ToolEndpoint {
  path: string;
  method: 'get' | 'post' | 'put' | 'delete' | 'patch';
  operationId: string;
  summary: string;
  description?: string;
  inputs: ToolInput[];
  outputs: ToolOutput[];
}

export interface ToolInput {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
  enum?: string[];
}

export interface ToolOutput {
  name: string;
  type: string;
  description?: string;
}

export interface ToolSpec {
  type: 'api' | 'mcp';
  protocol?: 'openapi' | 'swagger';
  server: {
    url: string;
    timeout?: number;
  };
  authentication?: {
    type: 'none' | 'api_key' | 'oauth2' | 'basic';
    in?: 'header' | 'query';
    name?: string;
  };
  endpoints?: ToolEndpoint[];
  tools?: MCPTool[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputs: ToolInput[];
  outputs?: ToolOutput[];
}

export interface ToolDSL {
  apiVersion: string;
  kind: 'Tool';
  metadata: DSLMetadata;
  spec: ToolSpec;
}

export type ComponentDSL = ToolDSL;
export type ComponentKind = 'Tool' | 'Workflow' | 'Agent' | 'Knowledge' | 'Chatflow' | 'TextGeneration';
```

- [ ] **Step 2: 创建 Dify 内部类型定义**

```typescript
// src/types/dify.ts

export interface DifyMCPToolProvider {
  id: string;
  name: string;
  server_identifier: string;
  server_url: string;
  server_url_hash: string;
  icon?: string;
  tenant_id: string;
  user_id: string;
  tools: string; // JSON string
  authed: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface DifyApiToolProvider {
  id: string;
  name: string;
  icon: string;
  schema: string;
  schema_type_str: string;
  user_id: string;
  tenant_id: string;
  description?: string;
  tools_str: string;
  credentials_str: string;
  privacy_policy?: string;
  custom_disclaimer?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface DifyTenant {
  id: string;
  name: string;
  encrypt_public_key?: string;
}

export interface DifyAccount {
  id: string;
  name: string;
  email?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add enterprise/dev-kit/src/types/
git commit -m "feat: add DSL and Dify internal type definitions"
```

---

## Task 3: 配置管理

**Files:**
- Create: `enterprise/dev-kit/src/core/config.ts`

- [ ] **Step 1: 实现配置管理模块**

```typescript
// src/core/config.ts

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';

export interface DevKitConfig {
  dify: {
    apiUrl: string;
    consoleUrl: string;
    db: {
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
    };
  };
  componentsDir: string;
  llm?: {
    provider: string;
    model: string;
    apiKey: string;
  };
}

const DEFAULT_CONFIG: DevKitConfig = {
  dify: {
    apiUrl: 'http://localhost:5001',
    consoleUrl: 'http://localhost',
    db: {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'difyai123456',
      database: 'dify',
    },
  },
  componentsDir: './enterprise/components',
};

export function loadConfig(configPath?: string): DevKitConfig {
  const paths = [
    configPath,
    './dify-dev.yaml',
    './dify-dev.yml',
    './.dify-dev.yaml',
    './.dify-dev.yml',
  ].filter(Boolean) as string[];

  for (const path of paths) {
    const fullPath = resolve(path);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      const userConfig = YAML.parse(content);
      return mergeConfig(DEFAULT_CONFIG, userConfig);
    }
  }

  return DEFAULT_CONFIG;
}

function mergeConfig(defaults: DevKitConfig, user: Partial<DevKitConfig>): DevKitConfig {
  return {
    ...defaults,
    ...user,
    dify: {
      ...defaults.dify,
      ...user.dify,
      db: {
        ...defaults.dify.db,
        ...user.dify?.db,
      },
    },
  };
}

export function resolveComponentsDir(config: DevKitConfig): string {
  return resolve(config.componentsDir);
}
```

- [ ] **Step 2: Commit**

```bash
git add enterprise/dev-kit/src/core/config.ts
git commit -m "feat: add configuration management module"
```

---

## Task 4: YAML 解析器

**Files:**
- Create: `enterprise/dev-kit/src/core/parser.ts`
- Create: `enterprise/dev-kit/tests/fixtures/sample-tool.yml`

- [ ] **Step 1: 实现 YAML 解析器**

```typescript
// src/core/parser.ts

import { readFileSync } from 'fs';
import YAML from 'yaml';
import { z } from 'zod';
import { ComponentDSL, ToolDSL } from '../types/dsl';

const ToolInputSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.any().optional(),
  enum: z.array(z.string()).optional(),
});

const ToolOutputSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
});

const ToolEndpointSchema = z.object({
  path: z.string(),
  method: z.enum(['get', 'post', 'put', 'delete', 'patch']),
  operationId: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  inputs: z.array(ToolInputSchema).default([]),
  outputs: z.array(ToolOutputSchema).default([]),
});

const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputs: z.array(ToolInputSchema).default([]),
  outputs: z.array(ToolOutputSchema).optional(),
});

const ToolSpecSchema = z.object({
  type: z.enum(['api', 'mcp']),
  protocol: z.enum(['openapi', 'swagger']).optional(),
  server: z.object({
    url: z.string(),
    timeout: z.number().optional(),
  }),
  authentication: z.object({
    type: z.enum(['none', 'api_key', 'oauth2', 'basic']),
    in: z.enum(['header', 'query']).optional(),
    name: z.string().optional(),
  }).optional(),
  endpoints: z.array(ToolEndpointSchema).optional(),
  tools: z.array(MCPToolSchema).optional(),
});

const MetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  icon: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  labels: z.array(z.string()).optional(),
  annotations: z.record(z.string()).optional(),
});

const ToolDSLSchema = z.object({
  apiVersion: z.string(),
  kind: z.literal('Tool'),
  metadata: MetadataSchema,
  spec: ToolSpecSchema,
});

export class ParseError extends Error {
  constructor(message: string, public readonly details?: z.ZodError) {
    super(message);
    this.name = 'ParseError';
  }
}

export function parseToolDSL(content: string): ToolDSL {
  try {
    const parsed = YAML.parse(content);
    const result = ToolDSLSchema.safeParse(parsed);
    
    if (!result.success) {
      throw new ParseError('Invalid Tool DSL format', result.error);
    }
    
    return result.data;
  } catch (error) {
    if (error instanceof ParseError) {
      throw error;
    }
    throw new ParseError(`Failed to parse YAML: ${(error as Error).message}`);
  }
}

export function parseToolDSLFromFile(filePath: string): ToolDSL {
  const content = readFileSync(filePath, 'utf-8');
  return parseToolDSL(content);
}

export function parseDSL(content: string): ComponentDSL {
  const parsed = YAML.parse(content);
  
  switch (parsed.kind) {
    case 'Tool':
      return parseToolDSL(content);
    default:
      throw new ParseError(`Unknown component kind: ${parsed.kind}`);
  }
}
```

- [ ] **Step 2: 创建测试 fixture**

```yaml
# tests/fixtures/sample-tool.yml
apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: text-summarizer
  description: "文本摘要生成工具"
  icon: "📝"
  version: "1.0.0"
  author: "enterprise"
  labels:
    - text-processing
    - nlp

spec:
  type: api
  protocol: openapi
  server:
    url: "http://enterprise-tool-service:3000"
    timeout: 30
  authentication:
    type: none
  endpoints:
    - path: "/tools/summarize"
      method: post
      operationId: summarize
      summary: "生成文本摘要"
      description: "对输入文本生成简短摘要"
      inputs:
        - name: text
          type: string
          required: true
          description: "需要摘要的文本"
        - name: max_length
          type: number
          required: false
          default: 100
          description: "摘要最大长度"
      outputs:
        - name: summary
          type: string
          description: "生成的摘要"
        - name: original_length
          type: number
          description: "原始文本长度"
```

- [ ] **Step 3: Commit**

```bash
git add enterprise/dev-kit/src/core/parser.ts enterprise/dev-kit/tests/fixtures/
git commit -m "feat: add YAML DSL parser with Zod validation"
```

---

## Task 5: 编译器（Tool → Dify 格式）

**Files:**
- Create: `enterprise/dev-kit/src/core/compiler.ts`
- Create: `enterprise/dev-kit/tests/compiler.test.ts`

- [ ] **Step 1: 实现编译器**

```typescript
// src/core/compiler.ts

import { createHash } from 'crypto';
import { ToolDSL, ToolEndpoint, MCPTool } from '../types/dsl';
import { DifyApiToolProvider, DifyMCPToolProvider } from '../types/dify';

export interface CompileResult {
  sql?: string;
  params?: unknown[];
  difyJson?: Record<string, unknown>;
}

export function compileApiTool(dsl: ToolDSL, tenantId: string, userId: string): DifyApiToolProvider {
  const id = crypto.randomUUID();
  const { metadata, spec } = dsl;
  
  // 构建 OpenAPI schema
  const openapiSchema = buildOpenAPISchema(dsl);
  
  // 构建 tools_str
  const toolsStr = JSON.stringify(spec.endpoints?.map(endpoint => ({
    server_url: spec.server.url,
    method: endpoint.method,
    summary: endpoint.summary,
    operation_id: endpoint.operationId,
    author: metadata.author || 'enterprise',
    parameters: endpoint.inputs.map(input => ({
      name: input.name,
      label: { en_US: input.name, zh_Hans: input.name },
      type: mapTypeToDify(input.type),
      form: 'llm',
      llm_description: input.description || '',
      required: input.required,
      default: input.default,
    })),
    openapi: {
      operationId: endpoint.operationId,
      summary: endpoint.summary,
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: Object.fromEntries(
                endpoint.inputs.map(input => [
                  input.name,
                  { type: input.type, description: input.description }
                ])
              ),
              required: endpoint.inputs.filter(i => i.required).map(i => i.name),
            }
          }
        }
      }
    }
  })) || []);
  
  return {
    id,
    name: metadata.name,
    icon: metadata.icon || '',
    schema: JSON.stringify(openapiSchema),
    schema_type_str: spec.protocol || 'openapi',
    user_id: userId,
    tenant_id: tenantId,
    description: metadata.description,
    tools_str: toolsStr,
    credentials_str: JSON.stringify({ auth_type: spec.authentication?.type || 'none' }),
    privacy_policy: '',
    custom_disclaimer: '',
  };
}

export function compileMCPTool(dsl: ToolDSL, tenantId: string, userId: string): DifyMCPToolProvider {
  const id = crypto.randomUUID();
  const { metadata, spec } = dsl;
  const serverUrl = spec.server.url;
  
  // 计算 server_url_hash
  const serverUrlHash = createHash('sha256').update(serverUrl).digest('hex');
  
  // 构建 tools JSON
  const toolsJson = spec.tools?.map((tool: MCPTool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        tool.inputs.map(input => [
          input.name,
          { 
            type: input.type, 
            description: input.description,
            ...(input.enum ? { enum: input.enum } : {}),
          }
        ])
      ),
      required: tool.inputs.filter(i => i.required).map(i => i.name),
    }
  })) || [];
  
  return {
    id,
    name: metadata.name,
    server_identifier: metadata.name,
    server_url: serverUrl, // 注意：实际使用时需要加密
    server_url_hash: serverUrlHash,
    icon: metadata.icon || '',
    tenant_id: tenantId,
    user_id: userId,
    tools: JSON.stringify(toolsJson),
    authed: false,
  };
}

function buildOpenAPISchema(dsl: ToolDSL): Record<string, unknown> {
  const { metadata, spec } = dsl;
  
  return {
    openapi: '3.0.0',
    info: {
      title: metadata.name,
      version: metadata.version || '1.0.0',
      description: metadata.description,
    },
    servers: [
      { url: spec.server.url }
    ],
    paths: Object.fromEntries(
      spec.endpoints?.map(endpoint => [
        endpoint.path,
        {
          [endpoint.method]: {
            operationId: endpoint.operationId,
            summary: endpoint.summary,
            description: endpoint.description,
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: Object.fromEntries(
                      endpoint.inputs.map(input => [
                        input.name,
                        { 
                          type: input.type, 
                          description: input.description,
                          ...(input.default !== undefined ? { default: input.default } : {}),
                          ...(input.enum ? { enum: input.enum } : {}),
                        }
                      ])
                    ),
                    required: endpoint.inputs.filter(i => i.required).map(i => i.name),
                  }
                }
              }
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: Object.fromEntries(
                        endpoint.outputs?.map(output => [
                          output.name,
                          { type: output.type, description: output.description }
                        ]) || []
                      ),
                    }
                  }
                }
              }
            }
          }
        }
      ]) || []
    )
  };
}

function mapTypeToDify(type: string): string {
  const typeMap: Record<string, string> = {
    'string': 'string',
    'integer': 'number',
    'number': 'number',
    'boolean': 'boolean',
    'array': 'array',
    'object': 'object',
  };
  return typeMap[type] || 'string';
}
```

- [ ] **Step 2: 创建编译器测试**

```typescript
// tests/compiler.test.ts

import { compileApiTool, compileMCPTool } from '../src/core/compiler';
import { parseToolDSLFromFile } from '../src/core/parser';
import { resolve } from 'path';

describe('Compiler', () => {
  const tenantId = 'test-tenant-id';
  const userId = 'test-user-id';

  describe('compileApiTool', () => {
    it('should compile API tool to Dify format', () => {
      const dsl = parseToolDSLFromFile(resolve(__dirname, './fixtures/sample-tool.yml'));
      const result = compileApiTool(dsl, tenantId, userId);

      expect(result.name).toBe('text-summarizer');
      expect(result.schema_type_str).toBe('openapi');
      expect(result.tenant_id).toBe(tenantId);
      expect(result.user_id).toBe(userId);
      expect(result.tools_str).toContain('summarize');
      
      // 验证 tools_str 是有效的 JSON
      const tools = JSON.parse(result.tools_str);
      expect(tools).toHaveLength(1);
      expect(tools[0].operation_id).toBe('summarize');
      expect(tools[0].parameters).toHaveLength(2);
    });

    it('should map integer type to number', () => {
      const dsl = parseToolDSLFromFile(resolve(__dirname, './fixtures/sample-tool.yml'));
      const result = compileApiTool(dsl, tenantId, userId);
      const tools = JSON.parse(result.tools_str);
      
      const maxLengthParam = tools[0].parameters.find((p: any) => p.name === 'max_length');
      expect(maxLengthParam.type).toBe('number');
    });
  });

  describe('compileMCPTool', () => {
    it('should compile MCP tool to Dify format', () => {
      const mcpYaml = `
apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: wechat-publisher
  description: "微信发布工具"
spec:
  type: mcp
  server:
    url: "http://mcp-wechat:3000/sse"
  tools:
    - name: publish_article
      description: "发布文章"
      inputs:
        - name: title
          type: string
          required: true
`;
      const dsl = parseToolDSL(mcpYaml);
      const result = compileMCPTool(dsl, tenantId, userId);

      expect(result.name).toBe('wechat-publisher');
      expect(result.server_identifier).toBe('wechat-publisher');
      expect(result.server_url).toBe('http://mcp-wechat:3000/sse');
      expect(result.server_url_hash).toHaveLength(64); // SHA-256 hex
      
      const tools = JSON.parse(result.tools);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('publish_article');
    });
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add enterprise/dev-kit/src/core/compiler.ts enterprise/dev-kit/tests/compiler.test.ts
git commit -m "feat: add Tool compiler with tests"
```

---

## Task 6: Dify 注册客户端

**Files:**
- Create: `enterprise/dev-kit/src/registry/dify-client.ts`
- Create: `enterprise/dev-kit/src/registry/db-client.ts`

- [ ] **Step 1: 实现数据库客户端**

```typescript
// src/registry/db-client.ts

import { Client } from 'pg';
import { DevKitConfig } from '../core/config';
import { DifyApiToolProvider, DifyMCPToolProvider, DifyTenant, DifyAccount } from '../types/dify';

export class DifyDBClient {
  private client: Client;

  constructor(config: DevKitConfig) {
    this.client = new Client({
      host: config.dify.db.host,
      port: config.dify.db.port,
      user: config.dify.db.user,
      password: config.dify.db.password,
      database: config.dify.db.database,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.end();
  }

  async getDefaultTenant(): Promise<DifyTenant> {
    const result = await this.client.query('SELECT id, name, encrypt_public_key FROM tenants LIMIT 1');
    if (result.rows.length === 0) {
      throw new Error('No tenant found');
    }
    return result.rows[0];
  }

  async getDefaultUser(): Promise<DifyAccount> {
    const result = await this.client.query('SELECT id, name, email FROM accounts LIMIT 1');
    if (result.rows.length === 0) {
      throw new Error('No user found');
    }
    return result.rows[0];
  }

  async registerApiTool(provider: DifyApiToolProvider): Promise<void> {
    const existing = await this.client.query(
      'SELECT id FROM tool_api_providers WHERE name = $1 AND tenant_id = $2',
      [provider.name, provider.tenant_id]
    );

    if (existing.rows.length > 0) {
      // Update
      await this.client.query(
        `UPDATE tool_api_providers 
         SET schema = $1, tools_str = $2, icon = $3, description = $4, updated_at = NOW()
         WHERE id = $5`,
        [provider.schema, provider.tools_str, provider.icon, provider.description, existing.rows[0].id]
      );
    } else {
      // Insert
      await this.client.query(
        `INSERT INTO tool_api_providers 
         (id, name, icon, schema, schema_type_str, user_id, tenant_id, description, 
          tools_str, credentials_str, privacy_policy, custom_disclaimer)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          provider.id, provider.name, provider.icon, provider.schema, provider.schema_type_str,
          provider.user_id, provider.tenant_id, provider.description, provider.tools_str,
          provider.credentials_str, provider.privacy_policy, provider.custom_disclaimer
        ]
      );
    }
  }

  async registerMCPTool(provider: DifyMCPToolProvider): Promise<void> {
    const existing = await this.client.query(
      'SELECT id FROM tool_mcp_providers WHERE server_identifier = $1 AND tenant_id = $2',
      [provider.server_identifier, provider.tenant_id]
    );

    if (existing.rows.length > 0) {
      await this.client.query(
        `UPDATE tool_mcp_providers 
         SET server_url = $1, server_url_hash = $2, tools = $3, icon = $4, updated_at = NOW()
         WHERE id = $5`,
        [provider.server_url, provider.server_url_hash, provider.tools, provider.icon, existing.rows[0].id]
      );
    } else {
      await this.client.query(
        `INSERT INTO tool_mcp_providers 
         (id, name, server_identifier, server_url, server_url_hash, tenant_id, user_id, tools, authed, icon)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          provider.id, provider.name, provider.server_identifier, provider.server_url,
          provider.server_url_hash, provider.tenant_id, provider.user_id, provider.tools,
          provider.authed, provider.icon
        ]
      );
    }
  }
}
```

- [ ] **Step 2: 实现 Dify API 客户端**

```typescript
// src/registry/dify-client.ts

import axios, { AxiosInstance } from 'axios';
import { DevKitConfig } from '../core/config';

export class DifyAPIClient {
  private client: AxiosInstance;

  constructor(config: DevKitConfig) {
    this.client = axios.create({
      baseURL: config.dify.apiUrl,
      timeout: 30000,
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // 未来扩展：通过 API 创建 Workflow、Agent 等
  async createWorkflow(workflowJson: Record<string, unknown>): Promise<string> {
    const response = await this.client.post('/console/api/workflows', workflowJson);
    return response.data.id;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add enterprise/dev-kit/src/registry/
git commit -m "feat: add Dify DB and API clients for component registration"
```

---

## Task 7: CLI 命令实现

**Files:**
- Create: `enterprise/dev-kit/src/cli.ts`
- Create: `enterprise/dev-kit/src/commands/create.ts`
- Create: `enterprise/dev-kit/src/commands/deploy.ts`
- Create: `enterprise/dev-kit/src/commands/status.ts`

- [ ] **Step 1: 实现 CLI 入口**

```typescript
// src/cli.ts
#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from './core/config';
import { createCommand } from './commands/create';
import { deployCommand } from './commands/deploy';
import { statusCommand } from './commands/status';

const program = new Command();

program
  .name('dify-dev')
  .description('Dify 代码驱动开发工具包')
  .version('0.1.0')
  .option('-c, --config <path>', '配置文件路径')
  .option('-v, --verbose', '详细输出')
  .option('--dry-run', '模拟运行，不实际执行');

// 加载配置
const options = program.opts();
const config = loadConfig(options.config);

// 注册命令
program.addCommand(createCommand(config));
program.addCommand(deployCommand(config));
program.addCommand(statusCommand(config));

// 错误处理
program.exitOverride();

try {
  program.parse();
} catch (error) {
  if (error instanceof Error) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}
```

- [ ] **Step 2: 实现 create 命令**

```typescript
// src/commands/create.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { DevKitConfig } from '../core/config';

export function createCommand(config: DevKitConfig): Command {
  const cmd = new Command('create');
  
  cmd
    .description('创建新的 Dify 组件')
    .argument('<type>', '组件类型: tool')
    .argument('<name>', '组件名称')
    .option('-t, --template <template>', '使用模板')
    .option('--type <api|mcp>', 'Tool 类型', 'api')
    .action(async (type, name, options) => {
      const spinner = ora(`创建 ${type} 组件: ${name}`).start();
      
      try {
        if (type !== 'tool') {
          throw new Error(`暂不支持的组件类型: ${type}。当前仅支持: tool`);
        }
        
        const componentDir = resolve(config.componentsDir, 'tools', name);
        
        if (existsSync(componentDir)) {
          throw new Error(`组件已存在: ${componentDir}`);
        }
        
        mkdirSync(componentDir, { recursive: true });
        
        // 生成 YAML 模板
        const yamlContent = generateToolTemplate(name, options.type);
        writeFileSync(resolve(componentDir, 'spec.yml'), yamlContent);
        
        spinner.succeed(chalk.green(`组件创建成功: ${componentDir}`));
        console.log(chalk.blue('\n下一步:'));
        console.log(`  1. 编辑 ${componentDir}/spec.yml`);
        console.log(`  2. 运行: dify-dev deploy ${name}`);
        
      } catch (error) {
        spinner.fail(chalk.red(`创建失败: ${(error as Error).message}`));
        process.exit(1);
      }
    });
  
  return cmd;
}

function generateToolTemplate(name: string, type: string): string {
  if (type === 'mcp') {
    return `apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: ${name}
  description: "${name} MCP 工具"
  icon: "🔧"
  version: "1.0.0"
  author: "enterprise"

spec:
  type: mcp
  server:
    url: "http://${name}:3000/sse"
    timeout: 30
  tools:
    - name: example_tool
      description: "示例工具"
      inputs:
        - name: input_param
          type: string
          required: true
          description: "输入参数"
`;
  }
  
  return `apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: ${name}
  description: "${name} API 工具"
  icon: "🔧"
  version: "1.0.0"
  author: "enterprise"

spec:
  type: api
  protocol: openapi
  server:
    url: "http://${name}:3000"
    timeout: 30
  authentication:
    type: none
  endpoints:
    - path: "/api/example"
      method: post
      operationId: example
      summary: "示例接口"
      description: "这是一个示例接口"
      inputs:
        - name: input_param
          type: string
          required: true
          description: "输入参数"
      outputs:
        - name: result
          type: string
          description: "处理结果"
`;
}
```

- [ ] **Step 3: 实现 deploy 命令**

```typescript
// src/commands/deploy.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { DevKitConfig } from '../core/config';
import { parseToolDSLFromFile } from '../core/parser';
import { compileApiTool, compileMCPTool } from '../core/compiler';
import { DifyDBClient } from '../registry/db-client';

export function deployCommand(config: DevKitConfig): Command {
  const cmd = new Command('deploy');
  
  cmd
    .description('部署组件到 Dify')
    .argument('<name>', '组件名称')
    .option('-f, --force', '强制重新部署')
    .action(async (name, options) => {
      const spinner = ora(`部署组件: ${name}`).start();
      
      try {
        const specPath = resolve(config.componentsDir, 'tools', name, 'spec.yml');
        
        if (!existsSync(specPath)) {
          throw new Error(`组件不存在: ${specPath}`);
        }
        
        // 解析 DSL
        spinner.text = '解析 DSL...';
        const dsl = parseToolDSLFromFile(specPath);
        
        // 连接数据库
        spinner.text = '连接 Dify 数据库...';
        const dbClient = new DifyDBClient(config);
        await dbClient.connect();
        
        // 获取 tenant 和 user
        const tenant = await dbClient.getDefaultTenant();
        const user = await dbClient.getDefaultUser();
        
        // 编译并注册
        spinner.text = '编译并注册组件...';
        
        if (dsl.spec.type === 'api') {
          const provider = compileApiTool(dsl, tenant.id, user.id);
          await dbClient.registerApiTool(provider);
        } else if (dsl.spec.type === 'mcp') {
          const provider = compileMCPTool(dsl, tenant.id, user.id);
          // TODO: 加密 server_url
          await dbClient.registerMCPTool(provider);
        }
        
        await dbClient.disconnect();
        
        spinner.succeed(chalk.green(`组件部署成功: ${name}`));
        
      } catch (error) {
        spinner.fail(chalk.red(`部署失败: ${(error as Error).message}`));
        process.exit(1);
      }
    });
  
  return cmd;
}
```

- [ ] **Step 4: 实现 status 命令**

```typescript
// src/commands/status.ts

import { Command } from 'commander';
import chalk from 'chalk';
import { readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { DevKitConfig } from '../core/config';

export function statusCommand(config: DevKitConfig): Command {
  const cmd = new Command('status');
  
  cmd
    .description('查看组件状态')
    .action(async () => {
      const toolsDir = resolve(config.componentsDir, 'tools');
      
      if (!existsSync(toolsDir)) {
        console.log(chalk.yellow('暂无组件'));
        return;
      }
      
      const tools = readdirSync(toolsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      console.log(chalk.bold('\n📦 已注册组件:\n'));
      console.log(`${chalk.bold('NAME'.padEnd(20))} ${chalk.bold('TYPE'.padEnd(10))} ${chalk.bold('STATUS')}`);
      console.log('-'.repeat(50));
      
      for (const tool of tools) {
        const specPath = resolve(toolsDir, tool, 'spec.yml');
        const exists = existsSync(specPath);
        const status = exists ? chalk.green('✓ valid') : chalk.red('✗ missing spec');
        
        // TODO: 从 Dify 数据库查询实际部署状态
        console.log(`${tool.padEnd(20)} ${'tool'.padEnd(10)} ${status}`);
      }
      
      console.log();
    });
  
  return cmd;
}
```

- [ ] **Step 5: Commit**

```bash
git add enterprise/dev-kit/src/cli.ts enterprise/dev-kit/src/commands/
git commit -m "feat: add CLI commands (create, deploy, status)"
```

---

## Task 8: 构建和测试

**Files:**
- Modify: `enterprise/dev-kit/package.json`
- Create: `enterprise/dev-kit/tests/parser.test.ts`

- [ ] **Step 1: 添加测试脚本和构建配置**

```json
// 修改 package.json 中的 scripts 部分
{
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/cli.ts",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint src/**/*.ts",
    "clean": "rm -rf dist"
  }
}
```

- [ ] **Step 2: 创建 Jest 配置**

```json
// 添加到 package.json
{
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "roots": ["<rootDir>/src", "<rootDir>/tests"],
    "testMatch": ["**/*.test.ts"],
    "collectCoverageFrom": [
      "src/**/*.ts",
      "!src/cli.ts"
    ]
  }
}
```

- [ ] **Step 3: 创建 Parser 测试**

```typescript
// tests/parser.test.ts

import { parseToolDSL, parseToolDSLFromFile, ParseError } from '../src/core/parser';
import { resolve } from 'path';

describe('Parser', () => {
  describe('parseToolDSL', () => {
    it('should parse valid API tool DSL', () => {
      const yaml = `
apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: test-tool
  description: "测试工具"
spec:
  type: api
  protocol: openapi
  server:
    url: "http://localhost:3000"
  endpoints:
    - path: "/test"
      method: post
      operationId: test
      summary: "测试接口"
      inputs:
        - name: input
          type: string
          required: true
`;
      const result = parseToolDSL(yaml);
      
      expect(result.metadata.name).toBe('test-tool');
      expect(result.spec.type).toBe('api');
      expect(result.spec.endpoints).toHaveLength(1);
    });

    it('should parse valid MCP tool DSL', () => {
      const yaml = `
apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: test-mcp
  description: "测试 MCP"
spec:
  type: mcp
  server:
    url: "http://localhost:3000/sse"
  tools:
    - name: test_tool
      description: "测试工具"
`;
      const result = parseToolDSL(yaml);
      
      expect(result.spec.type).toBe('mcp');
      expect(result.spec.tools).toHaveLength(1);
    });

    it('should throw ParseError for invalid YAML', () => {
      expect(() => parseToolDSL('invalid yaml: [')).toThrow(ParseError);
    });

    it('should throw ParseError for missing required fields', () => {
      const yaml = `
apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: test
spec:
  type: api
`;
      expect(() => parseToolDSL(yaml)).toThrow(ParseError);
    });
  });

  describe('parseToolDSLFromFile', () => {
    it('should parse from file', () => {
      const result = parseToolDSLFromFile(resolve(__dirname, './fixtures/sample-tool.yml'));
      expect(result.metadata.name).toBe('text-summarizer');
      expect(result.spec.endpoints).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 4: 运行测试**

Run: `cd enterprise/dev-kit && npm test`

Expected: 所有测试通过

- [ ] **Step 5: 构建项目**

Run: `cd enterprise/dev-kit && npm run build`

Expected: `dist/` 目录生成，无编译错误

- [ ] **Step 6: Commit**

```bash
git add enterprise/dev-kit/package.json enterprise/dev-kit/tests/parser.test.ts
git commit -m "test: add parser tests and jest configuration"
```

---

## Task 9: 集成到项目

**Files:**
- Modify: `enterprise/dev-kit/package.json`
- Modify: `Makefile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: 添加 CLI bin 链接**

```json
// 确保 package.json 中有
{
  "bin": {
    "dify-dev": "./dist/cli.js"
  }
}
```

- [ ] **Step 2: 更新 Makefile**

```makefile
# 添加到 Makefile

# ─── DevKit ───
dev-kit-install:
	@cd enterprise/dev-kit && npm install && npm run build

# 使用本地开发的 dev-kit
dev-create:
	@node enterprise/dev-kit/dist/cli.js create $(filter-out $@,$(MAKECMDGOALS))

dev-deploy:
	@node enterprise/dev-kit/dist/cli.js deploy $(filter-out $@,$(MAKECMDGOALS))

dev-status:
	@node enterprise/dev-kit/dist/cli.js status

# 防止 make 将参数当作目标
%:
	@:
```

- [ ] **Step 3: 更新 docker-compose.yml**

```yaml
# 添加到 docker-compose.yml 的 services 部分
  dev-kit:
    build:
      context: ./enterprise/dev-kit
    container_name: dify-dev-kit
    volumes:
      - ./enterprise/components:/components
      - ./enterprise/dev-kit/dify-dev.yaml:/app/dify-dev.yaml
    environment:
      - DIFY_DB_PASSWORD=${DIFY_DB_PASSWORD:-difyai123456}
    networks:
      - dify-network
    command: ["node", "dist/cli.js", "status"]
```

- [ ] **Step 4: 创建 DevKit Dockerfile**

```dockerfile
# enterprise/dev-kit/Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
COPY templates/ ./templates/
ENTRYPOINT ["node", "dist/cli.js"]
```

- [ ] **Step 5: Commit**

```bash
git add enterprise/dev-kit/Dockerfile Makefile docker-compose.yml
git commit -m "chore: integrate dev-kit into project build system"
```

---

## Task 10: 文档和示例

**Files:**
- Create: `enterprise/dev-kit/README.md`
- Create: `enterprise/components/README.md`

- [ ] **Step 1: 创建 DevKit README**

```markdown
# Dify DevKit

Dify 代码驱动开发工具包。

## 安装

```bash
cd enterprise/dev-kit
npm install
npm run build
```

## 使用

### 创建组件

```bash
# 创建 API Tool
dify-dev create tool my-api-tool --type api

# 创建 MCP Tool
dify-dev create tool my-mcp-tool --type mcp
```

### 部署组件

```bash
# 部署到 Dify
dify-dev deploy my-api-tool
```

### 查看状态

```bash
dify-dev status
```

## 开发

```bash
# 运行测试
npm test

# 开发模式
npm run dev -- create tool test-tool
```
```

- [ ] **Step 2: 创建组件目录 README**

```markdown
# Enterprise Components

企业自研 Dify 组件目录。

## 目录结构

```
components/
├── tools/          # 自定义工具
├── workflows/      # 工作流（未来支持）
├── agents/         # Agent（未来支持）
└── knowledges/     # 知识库（未来支持）
```

## 创建新组件

```bash
# 使用 DevKit 创建
dify-dev create tool my-tool --type api

# 或手动创建目录和 spec.yml
mkdir -p components/tools/my-tool
cat > components/tools/my-tool/spec.yml << 'EOF'
apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: my-tool
  description: "我的工具"
spec:
  type: api
  server:
    url: "http://my-tool:3000"
  endpoints:
    - path: "/api/do-something"
      method: post
      operationId: doSomething
      summary: "做某事"
      inputs:
        - name: input
          type: string
          required: true
EOF
```

## 部署

```bash
dify-dev deploy my-tool
```
```

- [ ] **Step 3: Commit**

```bash
git add enterprise/dev-kit/README.md enterprise/components/README.md
git commit -m "docs: add dev-kit and components documentation"
```

---

## 验证清单

- [ ] `dify-dev create tool test-tool --type api` 成功创建组件
- [ ] `dify-dev deploy test-tool` 成功部署到 Dify
- [ ] `dify-dev status` 显示组件状态
- [ ] Dify UI 中能看到新注册的工具
- [ ] 所有测试通过 (`npm test`)
- [ ] 构建成功 (`npm run build`)

---

## 后续工作（Phase 2+）

### Phase 2: Workflow 支持
- 实现 Workflow DSL Parser
- 实现 Workflow Compiler（编译为 Dify Workflow JSON）
- 支持节点类型：LLM、Tool、Condition、Human-in-the-loop

### Phase 3: Agent 支持
- 实现 Agent DSL
- 支持工具绑定、记忆配置、知识库绑定

### Phase 4: 智能化
- 集成 LLM 实现 `dify-dev create --prompt`
- 实现 `dify-dev iterate` 迭代优化

### Phase 5: 生产化
- CI/CD 集成
- 多环境支持
- 监控和日志

---

*计划版本: v1.0*  
*最后更新: 2026-04-19*
