# P4 开发体验提升计划

> 执行周期：6周（Week 6-12，与P3并行）
> 目标：让团队成员能在30分钟内从零到第一个组件上线，CI成本降低80%

## 当前开发体验痛点

| 痛点 | 影响 | 频率 |
|------|------|------|
| YAML变更需手动重部署 | feedback loop 5-10分钟 | 每次开发迭代 |
| CI调用真实OpenAI API | 每次运行 $0.5-2，成本难控 | 每次PR/push |
| 无IDE语法支持 | YAML错误在运行时才发现 | 每次新建组件 |
| Prompt调试需完整部署流程 | 迭代效率极低 | 每次Prompt优化 |
| 无本地组件模拟环境 | 无法离线开发和测试 | 网络受限时 |

---

## P4-1：本地 LLM 测试（Ollama 集成）

### 问题背景

当前CI流水线直接调用真实OpenAI API，存在以下问题：
- 成本高昂：每次CI运行消耗 $0.5-2
- 速度慢：网络延迟导致测试时间增加3-5倍
- 强依赖网络：网络故障时CI完全不可用
- 结果不确定：LLM输出非确定性，影响测试稳定性

```
Jest Test Suite
     │
     ▼
MockLLMAdapter (USE_LOCAL_LLM=true)
     │                    │
     ▼                    ▼
Ollama (local)      OpenAI (production)
localhost:11434     api.openai.com
```

### docker-compose 集成

在 `docker-compose.dev.yml` 中添加 Ollama 服务：

```yaml
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    networks:
      - dify-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434/api/tags"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### TypeScript Mock Adapter

文件路径：`enterprise/dev-kit/src/utils/llm-adapter.ts`

```typescript
import axios from 'axios';

export interface LLMAdapter {
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
}

export class LocalLLMAdapter implements LLMAdapter {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const response = await axios.post(`${this.baseUrl}/api/generate`, {
      model: this.model,
      prompt,
      stream: false,
      options: { temperature: options?.temperature ?? 0 },
    });
    return response.data.response;
  }
}

export function createLLMAdapter(): LLMAdapter {
  if (process.env.USE_LOCAL_LLM === 'true') {
    return new LocalLLMAdapter();
  }
  // 返回真实OpenAI adapter（生产环境）
  return new OpenAIAdapter();
}
```

### GitHub Actions 集成

在 `.github/workflows/agent-ci.yml` 中添加 Ollama 步骤：

```yaml
    - name: Start Ollama
      run: |
        docker run -d --name ollama -p 11434:11434 ollama/ollama:latest
        sleep 10
        docker exec ollama ollama pull llama3.2:3b

    - name: Run tests with local LLM
      env:
        USE_LOCAL_LLM: "true"
        OLLAMA_BASE_URL: "http://localhost:11434"
        OLLAMA_MODEL: "llama3.2:3b"
      run: npm test
```

**收益：每次CI运行LLM成本从 $1 → $0，测试速度提升3x**

**工作量：4人天**

---

## P4-2：DevKit 热重载（`dify-dev watch` 命令）

### 需求

开发者修改 YAML 组件定义后，无需手动执行部署命令，系统自动检测变更并热更新到 Dify UI。

### 实现

```typescript
// enterprise/dev-kit/src/commands/watch.ts
import chokidar from 'chokidar';
import { validateDSL } from '../validators/dsl-validator';
import { deployComponent } from '../deployer';

export interface WatchOptions {
  pattern?: string;
  debounce?: number;
  verbose?: boolean;
}

export async function watchCommand(options: WatchOptions): Promise<void> {
  const pattern = options.pattern ?? 'enterprise/components/**/*.yml';

  console.log(`Watching: ${pattern}`);

  const watcher = chokidar.watch(pattern, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: options.debounce ?? 500 },
  });

  watcher.on('change', async (filePath: string) => {
    console.log(`[watch] Changed: ${filePath}`);
    const validation = await validateDSL(filePath);
    if (!validation.success) {
      console.error(`[watch] Validation failed:\n${validation.errors.join('\n')}`);
      return;
    }
    await deployComponent(filePath);
    console.log(`[watch] Deployed: ${filePath}`);
  });

  process.on('SIGINT', () => {
    watcher.close();
    process.exit(0);
  });
}
```

**工作量：3人天**

---

## P4-3：Prompt Playground（`dify-dev playground`）

### 方案：Langfuse Prompt Management 集成

利用 Langfuse 的 Prompt 版本管理 API，实现本地快速迭代与 Dify DSL 的双向同步。

```typescript
// enterprise/dev-kit/src/commands/sync-prompts.ts
import { Langfuse } from 'langfuse';
import { loadYAML, saveYAML } from '../utils/yaml-utils';

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_HOST ?? 'http://localhost:3000',
});

// dify-dev sync-prompts command
// 从 Langfuse 拉取 Prompt 版本 → 更新 YAML DSL
export async function syncPromptsCommand(componentPath: string): Promise<void> {
  const dsl = await loadYAML(componentPath);

  for (const node of dsl.nodes ?? []) {
    if (node.type === 'llm' && node.data.promptRef) {
      const prompt = await langfuse.getPrompt(node.data.promptRef);
      node.data.prompt = prompt.getLangchainPrompt();
      console.log(`Synced prompt: ${node.data.promptRef} (v${prompt.version})`);
    }
  }

  await saveYAML(componentPath, dsl);
}
```

**工作量：5人天**

---

## P4-4：VS Code 扩展（MVP）

### 功能范围

1. YAML DSL 语法高亮（TextMate grammar）
2. Schema 自动补全（JSON Schema from Zod）
3. 错误行内标注
4. 一键部署（Ctrl+Shift+D）
5. 状态栏部署状态

### 关键文件结构

```
vscode-dify-dev/
├── package.json              # Extension manifest
├── src/
│   ├── extension.ts         # Entry point，注册所有命令和providers
│   ├── validator.ts         # YAML validation via DevKit
│   └── deployer.ts          # Deploy command（调用dify-dev CLI）
└── syntaxes/
    └── dify-dsl.tmGrammar.json
```

### JSON Schema 生成（from Zod）

```typescript
// scripts/generate-schema.ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import { writeFileSync } from 'fs';
import { ToolDSLSchema } from '../dev-kit/src/types/dsl';

const schema = zodToJsonSchema(ToolDSLSchema, {
  name: 'DifyToolDSL',
  $refStrategy: 'none',
});

// 输出到 VS Code 扩展 schemas 目录，供 yaml.schemas 配置使用
writeFileSync(
  'vscode-dify-dev/schemas/tool.schema.json',
  JSON.stringify(schema, null, 2)
);

console.log('Schema generated: vscode-dify-dev/schemas/tool.schema.json');
```

**工作量：8人天**

---

## P4-5：组件模板库扩展

### 新增10个标准模板

| 模板名 | 类型 | 用途 |
|--------|------|------|
| rag-qa-chatflow | Chatflow | RAG知识库问答 |
| content-review-workflow | Workflow | 内容合规审核 |
| data-etl-pipeline | Workflow | 数据处理管道 |
| customer-service-agent | Agent | 智能客服 |
| code-review-agent | Agent | 代码审查助手 |
| email-drafting-agent | Agent | 邮件起草助手 |
| sql-query-tool | Tool/API | 数据库查询工具 |
| pdf-parser-tool | Tool/API | PDF文档解析 |
| notification-router | Tool/MCP | 多渠道通知 |
| search-aggregator | Tool/API | 搜索聚合工具 |

### 模板质量标准

每个模板必须包含以下文件，否则不允许合入主分支：

```
enterprise/components/templates/<template-name>/
├── component.yml        # Dify DSL 主定义文件
├── tests/
│   └── cases.yml        # 测试用例（至少3个 happy path + 1个 edge case）
├── README.md            # 使用说明、参数说明、示例输出
└── .env.example         # 所需环境变量示例（不含真实密钥）
```

**工作量：6人天**

---

## 验收标准

| 指标 | 当前值 | 目标（Week 12） |
|------|--------|----------------|
| 首次组件上线时间 | ~2小时 | < 30分钟 |
| CI每次运行LLM成本 | $1-2 | $0 |
| YAML错误发现时机 | 运行时 | 编辑时（IDE） |
| 组件模板数量 | 3 | 13 |
| Prompt迭代周期 | 5-10分钟 | < 1分钟 |
| 新成员上手时间 | 1-2天 | < 4小时 |
