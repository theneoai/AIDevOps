# P1 可观测性建设计划

> 执行周期：4周（Week 1-4，与P0并行启动）
> 当前问题：系统完全黑盒运行，无任何LLM调用追踪、成本分析、性能基线
> 目标：100%的LLM调用有追踪，建立成本告警与性能基线

## 总体架构

```
Dify (LLM calls)
    ↓ OTLP
MCP Server (tool calls) → OpenTelemetry Collector → Langfuse (LLM traces)
    ↓ OTLP                                        → Prometheus (metrics)
Tool Service (API calls)                          → Grafana (dashboards)
                                                  → Alertmanager (alerts)
```

为什么选 Langfuse（而非 LangSmith）：

| 对比维度 | Langfuse | LangSmith |
|---------|---------|-----------|
| 自托管 | ✅ | ❌（需付费） |
| 开源 | ✅ | ❌ |
| 与LangChain绑定 | ❌ | ✅（我们用Dify，不需要） |
| 成本追踪 | ✅ | ✅ |
| 适配本项目 | 完美匹配 | — |

---

## P1-1：Langfuse 自托管部署

### docker-compose 扩展配置

将以下内容追加至 `docker-compose.yml` 的 `services` 块：

```yaml
  langfuse-server:
    image: langfuse/langfuse:2
    depends_on:
      - langfuse-db
    ports:
      - "3001:3000"
    environment:
      - DATABASE_URL=postgresql://langfuse:langfuse@langfuse-db:5432/langfuse
      - NEXTAUTH_SECRET=${LANGFUSE_SECRET:-changeme}
      - SALT=${LANGFUSE_SALT:-changeme}
      - NEXTAUTH_URL=http://localhost:3001
      - TELEMETRY_ENABLED=false
    networks:
      - dify-network

  langfuse-db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=langfuse
      - POSTGRES_PASSWORD=langfuse
      - POSTGRES_DB=langfuse
    volumes:
      - langfuse_db_data:/var/lib/postgresql/data
    networks:
      - dify-network

volumes:
  langfuse_db_data:
```

### Makefile 命令新增

```makefile
langfuse-up:
	docker compose up langfuse-server langfuse-db -d
	@echo "Langfuse UI: http://localhost:3001"
```

### .env.example 新增变量

```
LANGFUSE_SECRET=your-secret-key
LANGFUSE_SALT=your-salt
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=http://langfuse-server:3000
```

### 工作量：2天

---

## P1-2：MCP Server OpenTelemetry 埋点

### 安装依赖

```bash
cd enterprise/mcp-servers/mcp-wechat
npm install @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-otlp-http langfuse
```

### 追踪初始化（enterprise/mcp-servers/mcp-wechat/src/tracer.ts）

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';

export const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://langfuse-server:3000/api/public/otel/v1/traces',
    headers: {
      Authorization: `Bearer ${process.env.LANGFUSE_SECRET_KEY}`,
    },
  }),
});
sdk.start();
```

### 工具调用追踪（index.ts 修改）

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';
const tracer = trace.getTracer('mcp-wechat');

// Wrap each tool handler:
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return tracer.startActiveSpan(`tool.${request.params.name}`, async (span) => {
    span.setAttributes({
      'tool.name': request.params.name,
      'mcp.transport': 'sse',
      'tenant.id': process.env.TENANT_ID ?? 'default',
    });
    try {
      const result = await handleTool(request);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
});
```

### 工作量：2天

---

## P1-3：Tool Service 埋点

### 依赖安装

```bash
cd enterprise/tool-service
npm install @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/instrumentation-express @opentelemetry/instrumentation-http
```

### Express 自动埋点（enterprise/tool-service/src/tracer.ts）

```typescript
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

export const sdk = new NodeSDK({
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
  ],
  // ... same OTLP exporter as above
});
```

在 `src/index.ts` 最顶部 import tracer（必须在 Express 之前）：

```typescript
import './tracer'; // must be first import
import express from 'express';
```

### 工作量：1天

---

## P1-4：关键 LLM 指标定义与告警

### 5个必须监控的指标

| 指标 | 采集方式 | 告警阈值 |
|------|---------|---------|
| Token日成本 | Langfuse cost tracking | > $10/天触发告警 |
| 工具调用P99延迟 | OTel span duration | > 5秒触发告警 |
| 工具调用成功率 | span error rate | < 95%触发告警 |
| 微信发布成功率 | custom span attribute | < 90%触发告警 |
| MCP连接数 | custom counter metric | > 100并发触发告警 |

### Langfuse 告警配置（UI操作步骤）

1. 进入 Langfuse UI → Settings → Alerts
2. 创建告警：Cost > $10/day → Webhook → Slack
3. 创建告警：Error rate > 5% (rolling 1h) → Webhook → Slack

### Prometheus + Alertmanager 配置

```yaml
# prometheus/rules/llm-alerts.yml
groups:
  - name: llm_alerts
    rules:
      - alert: HighToolLatency
        expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 5
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Tool service P99 latency > 5s"
```

### 工作量：2天

---

## P1-5：CI/CD 质量门禁集成

### .github/workflows/agent-ci.yml 新增步骤

```yaml
  llm-quality-gate:
    name: LLM Quality Gate
    runs-on: ubuntu-latest
    needs: [test]
    steps:
      - name: Check LLM cost regression
        run: |
          # Compare this PR's estimated token usage against baseline
          node enterprise/dev-kit/dist/cli.js cost-estimate --compare-baseline

      - name: Validate prompt templates
        run: |
          node enterprise/dev-kit/dist/cli.js validate --type prompts --all

      - name: Check observability coverage
        run: |
          # Ensure all new tool endpoints have OTel instrumentation
          node enterprise/dev-kit/dist/cli.js lint --check-tracing
```

### 工作量：1天

---

## 验收标准

| 指标 | 当前状态 | 目标（Week 4） |
|------|---------|--------------|
| LLM调用追踪覆盖率 | 0% | 100% |
| 可见性延迟（调用→追踪可查） | N/A | < 5秒 |
| 成本告警配置 | 无 | 已配置，测试通过 |
| Grafana Dashboard | 无 | 5个核心面板上线 |
| 告警响应时间 | 无感知 | Slack通知 < 1分钟 |
