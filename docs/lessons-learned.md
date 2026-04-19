# 企业 Agent 框架建设复盘

## 项目背景

基于开源社区版 Dify 构建企业级 Agent 应用框架，支持 Workflow、Tool、MCP、Skill 等基础设施的自主开发和维护。核心约束：**零侵入 Dify 源码**。

---

## 一、架构设计回顾

### 1.1 分层架构

```
dify/              ← Dify 官方代码（git submodule，零侵入）
enterprise/        ← 企业自研层（独立演进）
  ├── tool-service/         # 通用 REST API Tool 服务
  ├── mcp-servers/          # MCP Server 集合
  │   ├── mcp-wechat/       # 微信公众号 MCP
  │   └── mcp-template/     # MCP 脚手架模板
  ├── workflows/            # Workflow 模板库
  ├── skills/               # Skill 配置库
  └── scripts/              # 运维脚本（自动注册等）
docker-compose.yml # 企业自研服务编排
Makefile           # 统一命令入口
```

**关键决策**：将 Dify 作为 git submodule 引入，而非 fork 修改。

**收益**：
- 可平滑跟随 Dify 版本升级
- 企业代码与开源代码物理隔离
- 符合"零侵入"设计原则

---

## 二、技术方案选型

### 2.1 双协议支持策略

| 协议 | 适用场景 | 复杂度 | 代表服务 |
|------|----------|--------|----------|
| **MCP** (Model Context Protocol) | 实时交互、流式响应、工具发现 | 高 | 微信公众号发布 |
| **OpenAPI** | 简单 REST API、原子操作 | 低 | 文本摘要、关键词提取 |

**选型原则**：
- 需要双向通信或工具动态发现 → MCP
- 简单 CRUD 或计算型操作 → OpenAPI

---

## 三、踩坑记录与解决方案

### 坑 1：MCP SSE Body Parsing 冲突

**现象**：MCP Server 启动正常，但客户端连接时报错 `stream is not readable`。

**根因分析**：
```
Express 的 express.json() 中间件会消费 req 的 readable stream
         ↓
MCP SDK 的 handlePostMessage() 需要读取原始 body
         ↓
stream 已被消费，无法再次读取
```

**解决方案**：
```typescript
// 对 /messages 路由跳过 express.json()
app.use(express.json({ 
  type: (req) => {
    if (req.url?.startsWith('/messages')) {
      return false;
    }
    return req.headers['content-type']?.includes('application/json') || false;
  }
}));
```

**经验教训**：集成第三方 SDK 时，务必注意中间件对 request stream 的消费问题。MCP SDK 的 `handlePostMessage` 使用 `raw-body` 库读取原始 body，与 Express 的 body parser 冲突。

---

### 坑 2：Dify 加密算法不匹配

**现象**：注册 MCP Provider 后，Dify API 读取时报错 `incorrect padding`。

**根因分析**：
Dify 使用 **RSA+AES 混合加密**，不是简单的 RSA 加密：

```
1. 生成随机 16-byte AES 密钥
2. 使用 AES-128-EAX 加密 server_url
3. 使用 RSA-OAEP (SHA-1) 加密 AES 密钥
4. 拼接: b"HYBRID:" + rsa_encrypted_aes_key(256B) + nonce(16B) + tag(16B) + ciphertext
5. Base64 编码存储
```

**解决方案**：在注册脚本中完整复现 Dify 的加密逻辑：

```python
def encrypt_server_url(server_url: str, public_key_pem: str) -> str:
    from Crypto.Cipher import AES, PKCS1_OAEP
    from Crypto.PublicKey import RSA
    from Crypto.Random import get_random_bytes
    from Crypto.Hash import SHA1
    
    # AES 加密
    aes_key = get_random_bytes(16)
    cipher_aes = AES.new(aes_key, AES.MODE_EAX)
    ciphertext, tag = cipher_aes.encrypt_and_digest(server_url.encode())
    
    # RSA 加密 AES 密钥
    rsa_key = RSA.import_key(public_key_pem)
    cipher_rsa = PKCS1_OAEP.new(rsa_key, hashAlgo=SHA1)
    enc_aes_key = cipher_rsa.encrypt(aes_key)
    
    # 构建混合载荷
    prefix = b"HYBRID:"
    payload = prefix + enc_aes_key + cipher_aes.nonce + tag + ciphertext
    
    # Base64 编码
    return base64.b64encode(payload).decode()
```

**经验教训**：
- 不要假设加密方式，必须阅读源码确认算法细节
- Dify 的 `encrypter.encrypt_token()` 是最佳参考实现
- `server_url_hash` 必须是**明文 URL** 的 SHA-256，不是加密后的值

---

### 坑 3：ApiToolBundle 参数格式（27 个 Validation Error）

**现象**：API Tool Provider 注册后，Dify 加载时报大量 Pydantic validation error：
```
parameters.0.label   Field required
parameters.0.form    Field required
parameters.1.type    Input should be 'string', 'number', 'boolean'...
author               Field required
openapi              Field required
```

**根因分析**：Dify 的 `ToolParameter` Pydantic 模型要求严格的字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 参数名 |
| `label` | I18nObject | **必须**，多语言标签 `{"en_US": "...", "zh_Hans": "..."}` |
| `type` | enum | **必须**，值为 `string`/`number`/`boolean`/...，**不是 `integer`** |
| `form` | enum | **必须**，值为 `llm`/`schema`/`form` |
| `llm_description` | string | LLM 看到的参数描述 |
| `required` | boolean | 是否必填 |
| `placeholder` | I18nObject | 可选，占位符提示 |

`ApiToolBundle` 还需要：
- `author`: string（**必须**）
- `openapi`: dict（**必须**，OpenAPI 操作定义）

**解决方案**：严格遵循 Dify 的数据模型：

```python
tools_str = json.dumps([{
    'server_url': '...',
    'method': 'post',
    'summary': '文本摘要生成',
    'operation_id': 'summarize',
    'author': 'enterprise',  # 必须！
    'parameters': [{
        'name': 'text',
        'label': {'en_US': 'Text', 'zh_Hans': '文本'},  # 必须！
        'type': 'string',  # 必须是枚举值，不能是 'integer'
        'form': 'llm',     # 必须！
        'llm_description': '需要摘要的文本内容',
        'required': True,
    }],
    'openapi': {  # 必须！
        'operationId': 'summarize',
        'summary': '文本摘要生成',
        'requestBody': {...}
    }
}])
```

**经验教训**：
- 与外部系统集成时，必须精确匹配其数据模型，不能凭直觉
- Pydantic v2 的 validation error 信息很详细，要逐条修复
- `integer` 不是有效的 `ToolParameterType`，必须用 `number`

---

### 坑 4：Docker 网络隔离

**现象**：Dify 容器无法访问企业自研服务，注册脚本报错 `Name or service not known`。

**根因分析**：
```
Dify 官方服务          企业自研服务
  docker-compose up     docker-compose up
         ↓                      ↓
   docker_default 网络    dify-network 网络
         ↓                      ↓
    互相隔离，无法通信
```

**解决方案**：将企业自研服务连接到 Dify 的 `docker_default` 网络：

```bash
# Makefile 中自动执行
docker network connect docker_default mcp-wechat
docker network connect docker_default enterprise-tool-service
```

**验证方法**：
```bash
# 从 Dify API 容器内部测试连通性
docker exec docker-api-1 python3 -c "
import urllib.request
req = urllib.request.Request('http://enterprise-tool-service:3000/health')
response = urllib.request.urlopen(req, timeout=5)
print(response.read().decode())
"
```

**经验教训**：
- 跨 Docker Compose 项目的服务默认网络隔离
- 生产环境建议使用外部网络（`external: true`）或统一编排
- 网络问题往往比代码问题更难调试，要尽早验证

---

## 四、最佳实践

### 4.1 自动注册机制

**设计**：在 Dify API 容器内运行注册脚本，直接操作数据库。

**优势**：
- 免手动配置，一键启动
- 使用 Dify 原生加密，确保加解密一致
- 启动时自动完成，无需人工干预

**关键代码**：
```python
# 在 Dify API 容器内运行
with dify_app.app_context():
    # 获取 tenant 的加密公钥
    tenant = db.session.get(Tenant, tenant_id)
    public_key = tenant.encrypt_public_key
    
    # 使用 Dify 相同的加密算法
    encrypted_url = encrypt_server_url(url, public_key)
    
    # 写入数据库
    db.session.add(MCPToolProvider(...))
    db.session.commit()
```

### 4.2 健康检查链

```
make up-all
  ├── 启动 Dify 官方服务
  ├── 启动企业自研服务
  ├── 连接 Docker 网络
  ├── 等待 10s（数据库初始化）
  ├── 运行注册脚本
  │   ├── 注册 MCP Provider
  │   ├── 注册 API Provider
  │   └── 健康检查每个服务
  └── 输出服务状态
```

### 4.3 配置即代码

所有企业工具定义在 `ENTERPRISE_SERVICES` 字典中：
- **版本可控**：纳入 Git 管理
- **环境无关**：敏感信息通过环境变量注入
- **一键注册**：修改配置后重新运行脚本即可

---

## 五、核心认知

### 5.1 Dify 1.0+ 的插件化趋势

Dify 1.0+ 移除了直接在 UI 中配置自定义 MCP/Tool 的功能，改为：
- **MCP**：通过 `tool_mcp_providers` 表管理
- **API Tool**：通过 `tool_api_providers` 表管理
- **Builtin**：通过 `tool_builtin_providers` 表管理
- **Workflow**：通过 `tool_workflow_providers` 表管理

所有 provider 都需要通过数据库注册，不再是简单的配置文件。

### 5.2 加密是强约束

Dify 强制要求敏感字段加密：
- `server_url` → RSA+AES 混合加密
- `credentials` → `create_tool_provider_encrypter(tenant_id).encrypt()`
- `headers` → 同样需要加密

**不能绕过**，否则 Dify 在读取时会直接报错。

### 5.3 网络是隐形成本

微服务架构中，网络连通性往往比代码更难调试：
- Docker 网络隔离
- DNS 解析
- 防火墙规则
- 跨主机通信

**建议**：在架构设计阶段就明确网络拓扑，而不是事后补救。

### 5.4 Pydantic 是契约

Dify 大量使用 Pydantic v2 模型，任何字段不匹配都会直接报错：
- 字段名必须完全一致
- 类型必须匹配枚举值
- 必填字段不能省略
- 嵌套对象结构必须完整

---

## 六、待改进项

| 问题 | 当前状态 | 影响 | 建议方案 |
|------|----------|------|----------|
| **硬编码工具定义** | `ENTERPRISE_SERVICES` 字典写死 | 新增工具需修改脚本 | 从服务自动发现：`/openapi.json` 或 MCP `listTools` |
| **明文凭证存储** | `credentials_str` 使用 `"{"auth_type": "none"}"` | 安全风险 | 使用 Dify 的 `create_tool_provider_encrypter().encrypt()` |
| **单租户假设** | 只注册到第一个 tenant | 不支持多团队 | 遍历所有 tenant 注册 |
| **无幂等性保证** | 先 SELECT 再 INSERT/UPDATE | 并发时可能重复 | 使用 PostgreSQL UPSERT (`ON CONFLICT`) |
| **缺少监控告警** | 只有日志，无 metrics | 服务故障无感知 | 添加 Prometheus /health 端点 |
| **工具定义重复** | MCP tools 在代码和脚本中各一份 | 维护成本高 | 从 MCP Server 自动获取 tool list |
| **缺少端到端测试** | 只有单元测试 | 无法验证完整流程 | 添加集成测试：创建 Agent → 调用工具 |

---

## 七、下一步建议

### 短期（1-2 周）

1. **端到端测试**
   - 在 Dify UI 中创建 Agent
   - 实际调用企业自研工具
   - 验证返回结果正确

2. **凭证管理**
   - 实现 API Key 自动配置
   - 支持 OAuth2 凭证类型
   - 凭证加密存储

3. **自动发现**
   - MCP：从 `ListToolsRequestSchema` 自动获取工具列表
   - API：从 `/openapi.json` 自动解析工具定义

### 中期（1 个月）

4. **监控集成**
   - 添加 Prometheus metrics 端点
   - 工具调用次数、延迟、错误率
   - 服务健康状态 dashboard

5. **多租户支持**
   - 遍历所有 tenant 注册
   - 租户隔离验证

6. **文档完善**
   - 每个工具的使用示例
   - 故障排查指南
   - 开发新工具的教程

### 长期（3 个月）

7. **Workflow 模板**
   - 将常用流程模板化
   - 支持一键导入 Dify

8. **Skill 市场**
   - 内部 Skill 版本管理
   - 审批流程
   - 使用统计

---

## 八、关键文件索引

| 文件 | 用途 |
|------|------|
| `enterprise/scripts/register-tools.py` | 自动注册脚本（核心） |
| `enterprise/mcp-servers/mcp-wechat/src/index.ts` | MCP Server 实现 |
| `enterprise/tool-service/src/routes/tools.ts` | Tool Service API 端点 |
| `docker-compose.yml` | 企业自研服务编排 |
| `Makefile` | 统一命令入口 |
| `.env.example` | 环境变量模板 |

---

*复盘日期：2026-04-19*
*版本：v1.0*
