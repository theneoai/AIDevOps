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
| `make build` | 构建全部服务 |
| `make up` | 启动全部服务 |
| `make down` | 停止全部服务 |
| `make logs` | 查看日志 |
| `make status` | 查看服务状态 |
| `make health` | 健康检查 |
| `make restart` | 重启服务 |
| `make clean` | 清理容器和镜像 |

## 与 Dify 集成

### 方式一：统一编排（推荐）

将 Dify 官方编排与企业自研编排合并启动：

```bash
# 1. 克隆 Dify 官方仓库
git clone https://github.com/langgenius/dify.git

# 2. 启动全部服务（Dify + 企业自研）
make up
# 或
docker-compose up -d
```

### 方式二：独立部署

如果 Dify 已独立部署，只需确保：
1. Dify 和企业自研服务在同一个 Docker 网络 `dify-network`
2. 在 Dify 中配置 MCP Server 和 HTTP Tool
3. 创建 Agent 应用，启用对应的 Tool 和 MCP

### Dify 服务访问

| 服务 | 地址 |
|------|------|
| Dify 控制台 | http://localhost/install |
| Dify API | http://localhost:5001 |
| 企业 Tool Service | http://localhost:3100 |
| 微信 MCP | http://localhost:3001/sse |

## 许可证

MIT
