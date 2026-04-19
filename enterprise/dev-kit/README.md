# Dify DevKit

Dify DevKit 是一个 CLI 工具，支持通过**代码驱动开发（Code-Driven Development）**创建和管理 Dify 组件（Tool、MCP、Workflow 等）。

## 核心特性

- **零侵入 Dify 源码**：通过标准数据库接口扩展企业自研能力
- **声明式 YAML DSL**：用 YAML 定义组件，代码实现业务逻辑
- **自动注册**：组件一键部署到 Dify，无需手动 UI 配置
- **混合加密**：完整复现 Dify 的 RSA+AES 加密方案，保护敏感配置

## 快速开始

### 1. 安装依赖

```bash
cd enterprise/dev-kit
npm install
```

### 2. 构建

```bash
npm run build
```

### 3. 配置

创建 `dify-dev.yaml` 配置文件：

```yaml
dify:
  apiUrl: "http://localhost:5001"
  consoleUrl: "http://localhost"
  db:
    host: "${DIFY_DB_HOST:-localhost}"
    port: ${DIFY_DB_PORT:-5432}
    user: "${DIFY_DB_USER:-postgres}"
    password: "${DIFY_DB_PASSWORD:-difyai123456}"
    database: "${DIFY_DB_NAME:-dify}"

componentsDir: "./components"
```

### 4. 使用 CLI

```bash
# 创建一个新的 API Tool
npx dify-dev create tool my-api-tool --type api

# 创建一个新的 MCP Tool
npx dify-dev create tool my-mcp-tool --type mcp

# 部署组件到 Dify
npx dify-dev deploy my-api-tool

# 查看所有已注册组件
npx dify-dev status
```

## CLI 命令

### `create <kind> <name>`

从模板创建新组件。

**参数：**
- `kind`: 组件类型，目前仅支持 `tool`
- `name`: 组件名称

**选项：**
- `-t, --type <type>`: Tool 类型，`api` 或 `mcp`（默认：`api`）

**示例：**
```bash
dify-dev create tool weather-api --type api
dify-dev create tool wechat-mcp --type mcp
```

### `deploy <name>`

部署组件到 Dify。

**参数：**
- `name`: 组件名称（对应 `components/` 目录下的 YAML 文件）

**示例：**
```bash
dify-dev deploy weather-api
```

### `status`

显示所有已注册组件的状态。

**示例：**
```bash
dify-dev status
```

## YAML DSL 格式

### API Tool 示例

```yaml
apiVersion: v1
kind: Tool
metadata:
  name: weather-api
  description: "天气查询 API"
  icon: "🌤️"
  version: "1.0.0"
  author: "enterprise"
  labels:
    - "api"
    - "weather"
spec:
  type: api
  server: http://weather-service:3000
  authentication:
    type: api_key
    keyName: X-API-Key
    keyLocation: header
  endpoints:
    - path: /v1/current
      method: GET
      operationId: getCurrentWeather
      summary: "获取当前天气"
      inputs:
        - name: city
          type: string
          required: true
          description: "城市名称"
      outputs:
        - name: temperature
          type: number
          description: "温度"
        - name: condition
          type: string
          description: "天气状况"
```

### MCP Tool 示例

```yaml
apiVersion: v1
kind: Tool
metadata:
  name: wechat-publisher
  description: "微信公众号发布"
  icon: "📰"
  version: "1.0.0"
  author: "enterprise"
  labels:
    - "mcp"
    - "wechat"
spec:
  type: mcp
  server: http://mcp-wechat:3000/sse
  tools:
    - name: publish_article
      description: "发布微信公众号文章"
      inputs:
        - name: title
          type: string
          required: true
          description: "文章标题"
        - name: content
          type: string
          required: true
          description: "文章内容"
      outputs:
        - name: article_id
          type: string
          description: "文章 ID"
```

## 项目结构

```
enterprise/dev-kit/
├── src/
│   ├── cli.ts                 # CLI 入口
│   ├── types/
│   │   ├── dsl.ts             # DSL 类型定义
│   │   └── dify.ts            # Dify 内部类型
│   ├── core/
│   │   ├── config.ts          # 配置管理
│   │   ├── parser.ts          # YAML 解析器
│   │   └── compiler.ts        # DSL 编译器
│   ├── registry/
│   │   ├── crypto.ts          # 加密工具
│   │   ├── db-client.ts       # 数据库客户端
│   │   └── dify-client.ts     # Dify 注册客户端
│   └── commands/
│       ├── create.ts          # create 命令
│       ├── deploy.ts          # deploy 命令
│       └── status.ts          # status 命令
├── tests/                     # 测试文件
├── scripts/
│   └── encrypt_helper.py      # Python 加密辅助脚本
├── components/                # 用户生成的组件目录
├── Dockerfile                 # DevKit Docker 镜像
├── dify-dev.yaml              # 示例配置
└── package.json
```

## 开发

### 运行测试

```bash
npm test
```

### 类型检查

```bash
npm run typecheck
```

### 本地开发

```bash
npm run dev -- create tool test-tool --type api
```

## 架构说明

### 注册流程

1. **Parse**: YAML DSL → 验证后的 TypeScript 对象
2. **Compile**: DSL → Dify 内部数据库格式
3. **Register**: INSERT/UPDATE PostgreSQL 数据库表

### 加密方案

Dify 使用 RSA+AES 混合加密保护敏感配置（如 MCP server_url）：

1. 生成随机 16-byte AES 密钥
2. 使用 AES-128-EAX 加密数据
3. 使用 RSA-OAEP (SHA-1) 加密 AES 密钥
4. 拼接: `HYBRID:` + rsa_encrypted_key + nonce + tag + ciphertext
5. Base64 编码

由于 Node.js 原生 crypto 不支持 AES-EAX，DevKit 通过 Python 辅助脚本 (`scripts/encrypt_helper.py`) 实现加密。

## 许可证

MIT
