# P3 架构演进计划

> 执行周期：8周（Week 5-12，与P4并行）
> 目标：从单机Docker Compose演进为生产级高可用部署

## 演进路径总览

```
当前：单机 Docker Compose
  ↓ Week 5-6
Phase A：Docker Swarm（3节点HA，低迁移成本）
  ↓ Week 9-12  
Phase B：Kubernetes（Helm + ArgoCD GitOps，生产标准）
```

## P3-1：Docker Swarm 过渡（Week 5-6）

### 为什么先Swarm再K8s
- Compose文件改动极小（`deploy:` 块）
- 3节点HA，满足基本高可用需求
- 团队学习曲线低，2天可上线
- 为K8s迁移积累运维经验

### docker-compose.yml 改造（新增deploy块）
```yaml
services:
  enterprise-tool-service:
    image: ghcr.io/theneoai/tool-service:${VERSION:-latest}
    deploy:
      replicas: 2
      restart_policy:
        condition: on-failure
        max_attempts: 3
      update_config:
        parallelism: 1
        delay: 10s
        failure_action: rollback
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  mcp-wechat:
    image: ghcr.io/theneoai/mcp-wechat:${VERSION:-latest}
    deploy:
      replicas: 1  # SSE connections need session affinity - single replica for now
      restart_policy:
        condition: on-failure
    # Note: MCP SSE requires sticky sessions - see P3-4 for solution
```

### Swarm 初始化命令（新增到Makefile）
```makefile
swarm-init:
	docker swarm init
	docker stack deploy -c docker-compose.yml aidevops
	@echo "Stack deployed. Check: docker stack services aidevops"

swarm-update:
	docker stack deploy -c docker-compose.yml aidevops --with-registry-auth
```

### 工作量：3人天

## P3-2：Kubernetes 迁移（Week 9-12）

### Helm Chart 目录结构
```
helm/
├── aidevops/
│   ├── Chart.yaml
│   ├── values.yaml
│   ├── values-staging.yaml
│   ├── values-prod.yaml
│   └── templates/
│       ├── tool-service/
│       │   ├── deployment.yaml
│       │   ├── service.yaml
│       │   ├── hpa.yaml
│       │   └── configmap.yaml
│       ├── mcp-wechat/
│       │   ├── deployment.yaml
│       │   ├── service.yaml
│       │   └── configmap.yaml
│       ├── ingress.yaml
│       └── networkpolicy.yaml
```

### tool-service Deployment 关键配置
```yaml
# helm/aidevops/templates/tool-service/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tool-service
spec:
  replicas: {{ .Values.toolService.replicas }}
  selector:
    matchLabels:
      app: tool-service
  template:
    spec:
      containers:
        - name: tool-service
          image: "{{ .Values.image.registry }}/tool-service:{{ .Values.image.tag }}"
          ports:
            - containerPort: 3000
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
          env:
            - name: LOG_LEVEL
              valueFrom:
                configMapKeyRef:
                  name: tool-service-config
                  key: LOG_LEVEL
```

### HPA（水平自动扩缩容）
```yaml
# helm/aidevops/templates/tool-service/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: tool-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: tool-service
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### values.yaml 核心配置
```yaml
image:
  registry: ghcr.io/theneoai
  tag: latest

toolService:
  replicas: 2
  port: 3000

mcpWechat:
  replicas: 1  # see P3-4 for scaling strategy

ingress:
  enabled: true
  className: nginx
  host: aidevops.example.com
```

### 工作量：10人天

## P3-3：ArgoCD GitOps 集成

### ApplicationSet 配置（多环境）
```yaml
# argocd/applicationset.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: aidevops
spec:
  generators:
    - list:
        elements:
          - env: staging
            valuesFile: values-staging.yaml
          - env: production
            valuesFile: values-prod.yaml
  template:
    spec:
      project: default
      source:
        repoURL: https://github.com/theneoai/AIDevOps
        targetRevision: HEAD
        path: helm/aidevops
        helm:
          valueFiles:
            - "{{valuesFile}}"
      destination:
        server: https://kubernetes.default.svc
        namespace: "aidevops-{{env}}"
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
```

### GitHub Actions → ArgoCD 触发
```yaml
# .github/workflows/agent-ci.yml 新增deploy步骤
- name: Trigger ArgoCD Sync (Staging)
  run: |
    argocd app sync aidevops-staging \
      --auth-token ${{ secrets.ARGOCD_TOKEN }} \
      --server ${{ secrets.ARGOCD_SERVER }}
```

### 工作量：4人天

## P3-4：MCP Server 生产加固

### 核心问题：SSE 与负载均衡不兼容

SSE（Server-Sent Events）是长连接协议，标准HTTP负载均衡会导致：
- 连接被随机路由到不同Pod，Session丢失
- 负载均衡器超时切断长连接
- 多副本场景下客户端重连风暴

### 方案A（短期）：单副本 + 节点亲和性
```yaml
# mcp-wechat deployment
spec:
  replicas: 1
  template:
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: aidevops/mcp-node
                    operator: In
                    values: ["true"]
```

### 方案B（中期）：迁移到 Streamable HTTP Transport

MCP 规范新增 `streamable-http` 传输，天然支持负载均衡：
```typescript
// 替换 enterprise/mcp-servers/mcp-wechat/src/index.ts 中的传输层
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});
// 每次请求独立，无状态，可任意水平扩展
```

### 工作量：4人天

## P3-5：多租户架构（Week 10-12）

### K8s Namespace 隔离模型
```
aidevops-system      # 控制面（DevKit, Registry, Langfuse）
aidevops-tenant-a    # 租户A的Tool Service + MCP Servers
aidevops-tenant-b    # 租户B的Tool Service + MCP Servers
```

### 租户数据模型（PostgreSQL）
```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  namespace VARCHAR(63) NOT NULL UNIQUE,  -- K8s namespace
  created_at TIMESTAMPTZ DEFAULT NOW(),
  settings JSONB DEFAULT '{}'
);

CREATE TABLE components (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  kind VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  spec JSONB NOT NULL,
  UNIQUE(tenant_id, kind, name)
);
```

### DevKit CLI 多租户支持
```typescript
// enterprise/dev-kit/src/core/config.ts 新增
export interface DevKitConfig {
  tenant?: string;  // --tenant flag
  backend: 'dify' | 'langflow';
  // ...
}

// 所有命令支持 --tenant 参数
// dify-dev deploy my-tool --tenant tenant-a
```

### NetworkPolicy（租户间隔离）
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: tenant-isolation
  namespace: aidevops-tenant-a
spec:
  podSelector: {}
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: aidevops-tenant-a
        - namespaceSelector:
            matchLabels:
              name: aidevops-system
  policyTypes:
    - Ingress
```

### 工作量：10人天

## 阶段验收标准

| 里程碑 | 时间 | 验收标准 |
|--------|------|---------|
| Swarm上线 | Week 6 | tool-service 2副本运行，健康检查通过 |
| K8s staging就绪 | Week 8 | Helm chart部署成功，ArgoCD同步正常 |
| K8s prod上线 | Week 10 | 服务可用性>99%，HPA测试通过 |
| MCP加固完成 | Week 11 | SSE连接稳定，无超时断连 |
| 多租户上线 | Week 12 | 2个租户隔离运行，NetworkPolicy验证通过 |

## 总工作量：31人天
