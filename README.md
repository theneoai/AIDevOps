# 企业 Agent 应用框架

基于开源社区版 Dify 的企业级 Agent 应用框架，支持 Workflow、Tool、MCP、Skill 等基础设施的自主开发和维护。

## 架构设计

参见：[架构设计文档](docs/superpowers/specs/2026-04-19-enterprise-agent-framework-design.md)

## 快速开始

### 1. 环境准备

- Docker & Docker Compose
- Node.js 18+（开发时）
- Make（可选，用于简化命令）

### 2. 初始化

```bash
make init
# 或
./enterprise/scripts/init.sh
```

### 3. 配置环境变量

```bash
# 编辑 .env 文件，填写必要的配置
cp .env.example .env
vim .env
```

### 4. 构建并启动

```bash
make build
make up
```

### 5. 验证服务状态

```bash
make health
# 或
./enterprise/scripts/health-check.sh
```

## 项目结构

```
.
├── docker-compose.yml          # 统一编排文件
├── Makefile                    # 常用命令
├── .env                        # 环境变量
│
├── enterprise/                 # 企业自研基础设施层
│   ├── tool-service/           # 通用 Tool 服务
│   ├── mcp-servers/            # MCP Server 集群
│   │   ├── mcp-wechat/         # 微信公众号 MCP
│   │   └── mcp-template/       # MCP 脚手架模板
│   ├── workflows/              # Workflow 模板库
│   ├── skills/                 # Skill 配置文件库
│   └── scripts/                # 运维脚本
│
└── docs/                       # 文档
```

## 开发指南

### 新增 MCP Server

```bash
cp -r enterprise/mcp-servers/mcp-template enterprise/mcp-servers/mcp-your-service
# 修改 package.json、实现工具逻辑、添加 docker-compose 配置
```

### 新增 Tool

在 `enterprise/tool-service/src/routes/` 下添加新的路由文件。

### 新增 Workflow 模板

在 Dify Studio 中设计 Workflow，导出到 `enterprise/workflows/对应业务域/` 目录。

### 新增 Skill

参考 `enterprise/skills/marketing/wechat-publisher.yml` 创建新的 Skill 配置文件。

## 常用命令

| 命令 | 说明 |
|------|------|
| `make init` | 初始化项目 |
| `make build` | 构建企业自研服务 |
| `make up` | 启动企业自研服务 |
| `make down` | 停止企业自研服务 |
| `make dify-up` | 启动 Dify 官方服务 |
| `make dify-down` | 停止 Dify 官方服务 |
| `make up-all` | 启动全部服务（Dify + 企业自研） |
| `make down-all` | 停止全部服务 |
| `make logs` | 查看企业自研服务日志 |
| `make status` | 查看企业自研服务状态 |
| `make health` | 健康检查 |
| `make restart` | 重启企业自研服务 |
| `make clean` | 清理容器和镜像 |

## 与 Dify 集成

Dify 作为 Git 子模块引入，位于 `dify/` 目录。

### 首次克隆

```bash
# 克隆主仓库（包含子模块）
git clone --recursive <your-repo-url>

# 如果已克隆但未初始化子模块
git submodule update --init --recursive
```

### 启动全部服务

```bash
# 启动 Dify + 企业自研服务
make up-all

# 仅启动企业自研服务
make up

# 仅启动 Dify
make dify-up
```

### 停止服务

```bash
# 停止全部服务
make down-all

# 仅停止企业自研服务
make down

# 仅停止 Dify
make dify-down
```

### Dify 中配置企业自研服务

1. **配置 MCP Server**
   - 进入 Dify → Tools → MCP
   - 添加 MCP Server (HTTP)
   - Server URL: `http://mcp-wechat:3000/sse`
   - Name: `微信公众号发布`

2. **配置 HTTP Tool**
   - 进入 Dify → Tools → Custom
   - 添加 HTTP API
   - URL: `http://enterprise-tool-service:3000/...`

### 服务访问地址

| 服务 | 地址 |
|------|------|
| Dify 控制台 | http://localhost/install |
| Dify API | http://localhost:5001 |
| 企业 Tool Service | http://localhost:3100 |
| 微信 MCP | http://localhost:3001/sse |

## 许可证

MIT
