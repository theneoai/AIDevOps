# P5 生态系统建设计划

> 执行周期：14周（Week 10-24，长期战略）
> 目标：从Dify单一扩展演进为独立的AI组件工程化平台

## P5-1：DevKit 多后端支持（脱离Dify锁定）

### 战略意义
[Current lock-in risk: if Dify fails/pivots, entire project is stranded]
[Goal: support Dify + Langflow + LangChain as backends]

### Backend Adapter 接口设计
```typescript
// enterprise/dev-kit/src/registry/backend.ts
export interface ComponentBackend {
  registerTool(spec: ToolSpec): Promise<string>;
  updateTool(id: string, spec: ToolSpec): Promise<void>;
  deleteTool(id: string): Promise<void>;
  deployWorkflow(spec: WorkflowSpec): Promise<string>;
  getStatus(id: string): Promise<ComponentStatus>;
  healthCheck(): Promise<boolean>;
}

export class DifyAdapter implements ComponentBackend { ... }    // existing
export class LangflowAdapter implements ComponentBackend { ... } // new
```

### 配置切换
```yaml
# dify-dev.yaml
backend: dify  # options: dify | langflow | langchain
```

### 优先级：先 LangflowAdapter（Node.js同技术栈）
[Langflow API endpoints: POST /api/v1/flows/, PUT /api/v1/flows/{id}]

### 工作量：15人天

## P5-2：组件注册表（Component Registry）

### 概念
[Like Terraform Registry but for AI components - discover, share, reuse]

### Phase 1：GitHub-based Registry（轻量起步）
```
registry/
├── index.json          # Component catalog
├── tools/
│   ├── wechat-publisher/
│   │   ├── v1.0.0/spec.yml
│   │   └── README.md
│   └── text-summarizer/
└── workflows/
    └── article-pipeline/
```

### CLI 集成命令
```bash
dify-dev search "wechat"          # Search registry
dify-dev install wechat-publisher@1.0.0  # Install component
dify-dev publish ./my-tool        # Publish to registry
```

### TypeScript implementation skeleton
```typescript
// enterprise/dev-kit/src/commands/registry.ts
export async function searchCommand(query: string) {
  const index = await fetchRegistryIndex();
  return index.filter(c => c.tags.includes(query) || c.name.includes(query));
}
```

### 组件质量门禁
[Required fields before publish: tests, README, schema valid, security scan pass]

### 工作量：10人天

## P5-3：Phase 2-4 核心 DSL 开发

### Phase 2：Workflow DSL 编译器（10人天）

**Dify Workflow JSON 结构解析**：
```json
{
  "nodes": [
    {"id": "start", "type": "start", "data": {...}},
    {"id": "llm_1", "type": "llm", "data": {"model": "gpt-4", "prompt": "..."}},
    {"id": "tool_1", "type": "tool", "data": {"provider_id": "...", "tool_name": "..."}}
  ],
  "edges": [
    {"source": "start", "target": "llm_1"},
    {"source": "llm_1", "target": "tool_1"}
  ]
}
```

**新增编译器文件**：
```
enterprise/dev-kit/src/compilers/
├── workflow-compiler.ts    # YAML steps → Dify node graph
├── agent-compiler.ts       # Agent DSL → Dify App JSON
├── knowledge-compiler.ts   # Knowledge DSL → Dify Dataset
└── node-builders/
    ├── llm-node.ts
    ├── tool-node.ts
    ├── condition-node.ts
    └── human-in-loop-node.ts
```

**关键挑战**：工具引用解析（`ref: mcp-wechat.publish_article` → Dify tool_id UUID）
```typescript
async function resolveToolRef(ref: string): Promise<string> {
  const [provider, toolName] = ref.split('.');
  const provider = await db.query(
    'SELECT id FROM tool_mcp_providers WHERE name = $1', [provider]
  );
  return provider.rows[0].id;
}
```

### Phase 3：Agent DSL 编译器（12人天）

**与LangGraph的差距弥补策略**：
- Dify Agent 本身不支持 graph-based 状态机
- 方案：提供 `type: react` 和 `type: plan-and-execute` 两种 Agent 策略
- Multi-agent：通过 Workflow 嵌套 Agent 节点实现协调

### Phase 4：Knowledge DSL（8人天）

**数据源优先级**：
1. `type: file` - glob pattern支持（`./docs/**/*.md`）
2. `type: web` - sitemap crawling
3. `type: api` - REST data source polling

## P5-4：MCP 生态扩展

### 新增 MCP Server 路线图
| Server | 集成目标 | 优先级 | 工作量 |
|--------|---------|--------|--------|
| mcp-feishu | 飞书文档/消息 | 高 | 5人天 |
| mcp-dingtalk | 钉钉工作通知 | 高 | 4人天 |
| mcp-database | 结构化数据查询 | 中 | 6人天 |
| mcp-file-ops | PDF/文档处理 | 中 | 4人天 |
| mcp-notification | 多渠道通知路由 | 低 | 3人天 |

### MCP Server 标准化模板升级
[Improvements to enterprise/mcp-servers/mcp-template/]
Must include: /health endpoint, Prometheus /metrics, graceful shutdown, retry with exponential backoff

## P5-5：开源发布准备

### 开源前提 Checklist
- [ ] 无内部业务逻辑（微信AppSecret等已在.env.example中脱敏）
- [ ] LICENSE 文件（Apache 2.0推荐）
- [ ] CONTRIBUTING.md（开发环境搭建、PR规范）
- [ ] SECURITY.md（漏洞报告流程）
- [ ] CI/CD完全公开可用（无内部secret硬编码）
- [ ] 完整README（EN+ZH双语）
- [ ] 示例项目（standalone example without Dify submodule）
- [ ] GitHub Issue/PR模板
- [ ] Discussions启用
- [ ] Topics标签: dify, llm, agent, mcp, devops, yaml, gitops

### 目标社区定位
[Fill a niche: "GitOps for LLM components" - not another Dify fork]
[Target audience: DevOps engineers who want to manage AI components like infrastructure]

### 工作量：5人天（准备工作）

## 总工作量汇总

| 改进项 | 优先级 | 工作量 | 关键产出 |
|--------|--------|--------|---------|
| 多后端适配器 | P5-1 | 15人天 | DifyAdapter + LangflowAdapter |
| 组件注册表 | P5-2 | 10人天 | CLI search/install/publish |
| Workflow DSL | P5-3a | 10人天 | Phase 2完成 |
| Agent DSL | P5-3b | 12人天 | Phase 3完成 |
| Knowledge DSL | P5-3c | 8人天 | Phase 4完成 |
| MCP扩展(5个) | P5-4 | 22人天 | 飞书/钉钉/DB/文件/通知 |
| 开源准备 | P5-5 | 5人天 | GitHub开源就绪 |
| **合计** | | **82人天** | |

## 验收标准

| 指标 | 目标（Week 24） |
|------|----------------|
| 支持后端数 | 2（Dify + Langflow） |
| 注册表组件数 | > 15 |
| DSL覆盖组件类型 | 5（Tool/Workflow/Agent/Knowledge/Chatflow） |
| MCP Server数 | 6（+5新增） |
| GitHub Stars（开源后30天） | > 50 |
