# Dify 代码驱动开发框架（Dify-CDD）设计文档

> **版本**: v1.0  
> **日期**: 2026-04-19  
> **状态**: 已确认，待实施

---

## 1. 背景与目标

### 1.1 问题陈述

Dify 社区版提供了强大的可视化编排能力，但在企业级使用中存在以下痛点：

1. **配置复杂**：Workflow、Agent、Knowledge 等需要通过 UI 拖拽配置，学习成本高
2. **版本控制困难**：导出的 JSON 配置难以进行代码审查和版本对比
3. **复用性差**：无法像代码一样 import、继承和复用组件
4. **团队协作难**：非技术成员依赖 UI 截图沟通，效率低下
5. **自动化程度低**：无法通过 CI/CD 流水线自动部署和测试

### 1.2 核心目标

构建一套**代码驱动开发框架**，让大模型 Agent 能够：

```
自然语言需求 → 生成代码（YAML/TypeScript）→ 自动测试 → 编译部署 → Dify 直接使用
```

**关键约束**：
- **零侵入 Dify 源码**：通过标准 API/数据库接口集成
- **声明式为主**：YAML DSL 定义组件，代码实现业务逻辑
- **全生命周期**：覆盖创建、测试、迭代、部署、监控

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        开发者界面层                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   CLI 命令    │  │   Web UI     │  │   IDE 插件（未来）    │  │
│  │ dify-dev ... │  │ 可视化配置    │  │  VSCode Extension    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼─────────────────────┼──────────────┘
          │                 │                     │
          └─────────────────┴─────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                      DevKit 核心层                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────┐ │
│  │   Parser    │  │  Compiler   │  │   Tester    │  │ Deploy │ │
│  │  DSL 解析    │  │ 编译为 Dify │  │  模拟运行    │  │ 部署   │ │
│  │   YAML→AST  │  │   内部格式   │  │  单元测试    │  │ 注册   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  Generator  │  │   LLM       │  │  Registry   │            │
│  │ 代码生成器   │  │ 大模型集成   │  │  Dify 客户端 │            │
│  │ 模板渲染     │  │ Prompt工程   │  │  API/DB    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                     组件代码层（Git 管理）                        │
│  enterprise/components/                                          │
│  ├── tools/           # 自定义工具（OpenAPI/MCP）                 │
│  ├── workflows/       # 工作流定义                               │
│  ├── agents/          # Agent 定义                               │
│  ├── chatflows/       # 聊天助手流程                             │
│  ├── knowledges/      # 知识库定义                               │
│  └── text-generations/# 文本生成应用                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                      Dify 运行时层                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Dify API   │  │  Dify DB    │  │  Dify Web   │             │
│  │   5001      │  │  PostgreSQL │  │   3000      │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
|------|------|------|------|
| **Parser** | 解析 YAML DSL 为内部 AST | `.yml` 文件 | AST 对象 |
| **Validator** | 语义验证（类型检查、引用解析） | AST | 错误列表 |
| **Compiler** | 将 AST 编译为 Dify 内部格式 | AST | Dify JSON / SQL |
| **Generator** | 根据模板生成初始代码 | 自然语言/Prompt | YAML + TS 骨架 |
| **Tester** | 本地模拟测试 | 组件代码 | 测试报告 |
| **Registry** | 与 Dify 交互（注册/更新/删除） | 编译结果 | HTTP API / SQL |
| **LLM** | 大模型集成（代码生成/审查） | Prompt | 代码建议 |

---

## 3. DSL 设计

### 3.1 设计原则

1. **声明式为主**：描述"想要什么"，而非"怎么做"
2. **混合式支持**：声明式为主，支持条件分支、循环等控制流
3. **引用友好**：通过 `ref:` 语法引用其他组件
4. **模板化**：支持 Jinja2 风格的变量插值

### 3.2 通用元数据

所有组件共享的元数据结构：

```yaml
apiVersion: dify.enterprise/v1      # API 版本
kind: Agent | Workflow | Tool | Knowledge | Chatflow | TextGeneration
metadata:
  name: content-assistant            # 唯一标识（kebab-case）
  description: "内容创作助手"         # 描述
  icon: "🤖"                         # 图标（emoji 或 URL）
  version: "1.0.0"                   # 语义化版本
  author: "enterprise"               # 作者
  labels:                            # 标签（用于分类和检索）
    - content
    - wechat
  annotations:                       # 注解（不影响运行）
    created-by: "dify-dev"
    created-at: "2026-04-19"
```

### 3.3 Tool 定义（OpenAPI）

```yaml
apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: text-summarizer
  description: "文本摘要生成工具"
  icon: "📝"

spec:
  type: api                          # api | mcp
  protocol: openapi                  # openapi | swagger
  
  server:
    url: "http://enterprise-tool-service:3000"
    timeout: 30
    
  authentication:                    # 认证配置
    type: api_key                    # none | api_key | oauth2 | basic
    in: header                       # header | query
    name: "X-API-Key"
    # 密钥值通过环境变量或 Dify UI 配置，不硬编码
    
  endpoints:
    - path: "/tools/summarize"
      method: post
      operationId: summarize
      summary: "生成文本摘要"
      description: "对输入文本生成简短摘要"
      
      inputs:                        # 输入参数定义
        - name: text
          type: string
          required: true
          description: "需要摘要的文本"
          
        - name: max_length
          type: number
          required: false
          default: 100
          description: "摘要最大长度"
          
      outputs:                       # 输出结构定义
        - name: summary
          type: string
          description: "生成的摘要"
          
        - name: original_length
          type: number
          description: "原始文本长度"
```

### 3.4 Tool 定义（MCP）

```yaml
apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: wechat-publisher
  description: "微信公众号发布工具"
  icon: "📢"

spec:
  type: mcp
  
  server:
    url: "http://mcp-wechat:3000/sse"
    transport: sse                   # sse | stdio | http
    timeout: 30
    
  tools:                             # MCP 工具列表（从 server 自动发现或手动定义）
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
          description: "文章正文（支持 HTML）"
          
        - name: thumb_media_id
          type: string
          required: false
          description: "封面图片 media_id"
          
      outputs:
        - name: media_id
          type: string
          description: "发布后的文章 media_id"
          
    - name: upload_image
      description: "上传图片到素材库"
      
      inputs:
        - name: image_url
          type: string
          required: true
          description: "图片 URL"
          
        - name: type
          type: string
          required: false
          default: "content"
          enum: ["thumb", "content"]
          description: "图片类型"
```

### 3.5 Workflow 定义

```yaml
apiVersion: dify.enterprise/v1
kind: Workflow
metadata:
  name: article-pipeline
  description: "文章创作到发布的自动化流程"
  icon: "🔄"

spec:
  # 输入定义
  inputs:
    - name: topic
      type: string
      description: "文章主题"
      required: true
      
    - name: style
      type: string
      description: "文章风格"
      required: false
      default: "professional"
      enum: ["professional", "casual", "technical"]

  # 变量定义（中间计算结果）
  variables:
    - name: max_words
      value: "{{ inputs.style == 'technical' ? 3000 : 2000 }}"

  # 步骤定义（按顺序执行）
  steps:
    # LLM 节点：生成大纲
    - id: generate-outline
      type: llm
      name: "生成大纲"
      model:
        provider: openai
        name: gpt-4
        temperature: 0.7
      prompt: |
        为主题 "{{ inputs.topic }}" 生成文章大纲。
        风格：{{ inputs.style }}
        要求：
        - 5-7 个章节
        - 每个章节有明确的小标题
        - 适合微信公众号阅读
      output: outline

    # LLM 节点：撰写文章
    - id: write-article
      type: llm
      name: "撰写文章"
      model:
        provider: openai
        name: gpt-4
        temperature: 0.8
      prompt: |
        根据大纲撰写完整文章（不超过 {{ variables.max_words }} 字）：
        {{ steps.generate-outline.output }}
      output: article

    # 工具节点：提取关键词
    - id: extract-keywords
      type: tool
      name: "提取关键词"
      tool: ref:enterprise-tool-service.extract-keywords
      inputs:
        text: "{{ steps.write-article.output }}"
        count: 5
      output: keywords

    # 条件分支：检查字数
    - id: check-length
      type: condition
      name: "检查字数"
      if: "{{ steps.write-article.output | length > variables.max_words }}"
      then:
        - id: trim-article
          type: llm
          name: "精简文章"
          model: gpt-4
          prompt: |
            将以下文章精简到 {{ variables.max_words }} 字以内：
            {{ steps.write-article.output }}
          output: article
      else:
        - id: pass-through
          type: pass
          output: article

    # 人工审核节点
    - id: human-review
      type: human-in-the-loop
      name: "人工审核"
      message: |
        文章已生成，请审核：
        
        {{ steps.check-length.output.article }}
        
        关键词：{{ steps.extract-keywords.output.keywords | join(', ') }}
      actions:
        - label: "✅ 发布"
          value: publish
        - label: "✏️ 修改"
          value: revise
        - label: "❌ 放弃"
          value: cancel
      output: decision

    # 条件分支：根据审核结果处理
    - id: process-decision
      type: condition
      name: "处理审核结果"
      switch:
        - case: "{{ steps.human-review.output == 'publish' }}"
          steps:
            - id: publish
              type: tool
              name: "发布到微信"
              tool: ref:mcp-wechat.publish_article
              inputs:
                title: "{{ inputs.topic }}"
                content: "{{ steps.check-length.output.article }}"
              output: result
              
            - id: notify-success
              type: notification
              name: "通知成功"
              channel: slack
              message: "✅ 文章已发布！链接：{{ steps.publish.output.url }}"
              
        - case: "{{ steps.human-review.output == 'revise' }}"
          steps:
            - id: notify-revision
              type: notification
              name: "通知修改"
              channel: slack
              message: "✏️ 文章需要修改，请查看对话记录"
              
        - default:
          steps:
            - id: notify-cancel
              type: notification
              name: "通知取消"
              channel: slack
              message: "❌ 文章发布已取消"

  # 输出定义
  outputs:
    - name: article
      value: "{{ steps.check-length.output.article }}"
      description: "最终文章"
      
    - name: keywords
      value: "{{ steps.extract-keywords.output.keywords }}"
      description: "关键词列表"
      
    - name: status
      value: "{{ steps.human-review.output }}"
      description: "审核结果"
```

### 3.6 Agent 定义

```yaml
apiVersion: dify.enterprise/v1
kind: Agent
metadata:
  name: content-assistant
  description: "内容创作助手，能生成文章并发布到微信公众号"
  icon: "🤖"

spec:
  # 模型配置
  model:
    provider: openai
    name: gpt-4
    temperature: 0.7
    max_tokens: 4000

  # 系统提示词
  system_prompt: |
    你是一个专业的内容创作助手，帮助用户生成高质量的微信公众号文章。
    
    你的工作流程：
    1. 理解用户的主题和需求
    2. 使用 summarize 工具生成文章大纲
    3. 使用 extract-keywords 提取 SEO 关键词
    4. 撰写完整的微信公众号文章
    5. 询问用户是否满意
    6. 如果用户同意，使用 publish_article 发布到微信
    
    注意事项：
    - 文章风格要符合微信公众号阅读习惯
    - 标题要吸引人但不做标题党
    - 内容要有深度，避免空洞

  # 工具绑定
  tools:
    - ref: enterprise-tool-service.summarize
      alias: summarize
      
    - ref: enterprise-tool-service.extract-keywords
      alias: extract-keywords
      
    - ref: mcp-wechat.publish_article
      alias: publish_article
      
    - ref: mcp-wechat.upload_image
      alias: upload_image

  # 记忆配置
  memory:
    type: conversation           # conversation | knowledge | none
    window_size: 10              # 保留最近 N 轮对话
    
  # 知识库绑定
  knowledge:
    - ref: product-docs          # 引用知识库
      top_k: 5                   # 检索 top-k 个片段
      score_threshold: 0.7       # 相似度阈值

  # 安全护栏
  guardrails:
    - type: content_filter
      config:
        blocked_categories: [violence, hate, harassment]
        
    - type: sensitive_info_filter
      config:
        patterns: ["\\d{18}", "\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}"]  # 身份证号、银行卡号
        
    - type: output_validator
      config:
        max_length: 5000
        required_fields: ["title", "content"]

  # 开场白
  opening_statement: |
    你好！我是你的内容创作助手 📝
    
    我可以帮你：
    - 根据主题生成文章大纲
    - 撰写完整的微信公众号文章
    - 提取 SEO 关键词
    - 直接发布到微信公众号
    
    请告诉我你想写什么主题？

  # 建议问题
  suggested_questions:
    - "帮我写一篇关于 AI 发展趋势的文章"
    - "生成一篇产品发布会的宣传文案"
    - "写一篇技术教程，主题是 Docker 入门"
```

### 3.7 Knowledge 定义

```yaml
apiVersion: dify.enterprise/v1
kind: Knowledge
metadata:
  name: product-docs
  description: "产品文档知识库"
  icon: "📚"

spec:
  # 数据源配置
  data_sources:
    - type: file                    # file | web | api | database
      source: "./docs/**/*.md"      # 支持 glob 模式
      parser:
        type: markdown
        chunk_size: 500
        chunk_overlap: 50
        
    - type: web
      source: "https://docs.example.com"
      crawl:
        depth: 2
        max_pages: 100
        include_patterns: ["/docs/**"]
        exclude_patterns: ["/docs/archive/**"]

  # 索引配置
  index:
    embedding_model:
      provider: openai
      name: text-embedding-3-small
      
    retrieval_mode: hybrid          # semantic | keyword | hybrid
    top_k: 5
    score_threshold: 0.5

  # 预处理规则
  preprocessing:
    - type: remove_html_tags
    - type: normalize_whitespace
    - type: remove_urls
      except: ["https://docs.example.com/**"]
```

### 3.8 Chatflow 定义

```yaml
apiVersion: dify.enterprise/v1
kind: Chatflow
metadata:
  name: customer-service
  description: "智能客服对话流程"
  icon: "💬"

spec:
  # 触发条件
  triggers:
    - type: keyword
      patterns: ["客服", "帮助", "问题"]
      
    - type: intent
      model: gpt-4
      intents: ["customer_support", "complaint", "inquiry"]

  # 对话流程
  flow:
    - id: greeting
      type: response
      condition: "{{ session.message_count == 1 }}"
      content: |
        您好！我是智能客服助手，很高兴为您服务。
        请问有什么问题我可以帮您解决？

    - id: classify-intent
      type: llm
      model: gpt-4
      prompt: |
        分析用户意图，分类为以下之一：
        - order_issue（订单问题）
        - product_inquiry（产品咨询）
        - technical_support（技术支持）
        - complaint（投诉）
        - other（其他）
        
        用户消息：{{ user.message }}
      output: intent

    - id: handle-order
      type: condition
      if: "{{ steps.classify-intent.output == 'order_issue' }}"
      then:
        - type: tool
          tool: ref:order-service.query_order
          inputs:
            order_id: "{{ user.message | extract_order_id }}"
          output: order_info
          
        - type: response
          content: |
            您的订单信息：
            订单号：{{ steps.handle-order.order_info.order_id }}
            状态：{{ steps.handle-order.order_info.status }}
            预计送达：{{ steps.handle-order.order_info.estimated_delivery }}

    - id: escalate
      type: condition
      if: "{{ steps.classify-intent.output == 'complaint' }}"
      then:
        - type: tool
          tool: ref:ticket-system.create_ticket
          inputs:
            priority: high
            content: "{{ user.message }}"
          output: ticket
          
        - type: response
          content: |
            非常抱歉给您带来不好的体验。
            我已为您创建工单，工单号：{{ steps.escalate.ticket.id }}
            客服专员将在 30 分钟内联系您。

    - id: fallback
      type: response
      condition: "{{ default }}"
      content: |
        我理解您的问题，让我为您查询相关信息...
        {{ knowledge.query(user.message) }}
```

### 3.9 TextGeneration 定义

```yaml
apiVersion: dify.enterprise/v1
kind: TextGeneration
metadata:
  name: code-reviewer
  description: "代码审查助手"
  icon: "💻"

spec:
  model:
    provider: openai
    name: gpt-4
    temperature: 0.3

  prompt_template: |
    你是一位资深代码审查专家。请审查以下代码：
    
    ```{{ inputs.language }}
    {{ inputs.code }}
    ```
    
    请从以下维度进行审查：
    1. **代码风格**：是否符合语言规范
    2. **潜在 Bug**：是否有空指针、数组越界等问题
    3. **性能优化**：是否有性能瓶颈
    4. **安全性**：是否有 SQL 注入、XSS 等风险
    5. **可维护性**：是否易于理解和维护
    
    输出格式：
    - 严重问题（必须修复）
    - 建议改进（推荐修复）
    - 良好实践（保持）

  inputs:
    - name: code
      type: string
      required: true
      description: "需要审查的代码"
      
    - name: language
      type: string
      required: true
      description: "编程语言"
      enum: [python, javascript, typescript, java, go, rust]

  outputs:
    - name: review_result
      type: string
      description: "审查结果"
      
    - name: issues
      type: array
      description: "问题列表"
```

---

## 4. CLI 设计

### 4.1 命令结构

```bash
dify-dev [全局选项] <命令> [子命令] [选项] [参数]

全局选项：
  -c, --config <path>      配置文件路径（默认：./dify-dev.yaml）
  -v, --verbose            详细输出
  -q, --quiet              静默模式
  --dry-run                模拟运行，不实际执行
```

### 4.2 核心命令

#### `create` - 创建组件

```bash
# 交互式创建（推荐）
dify-dev create

# 指定类型和名称
dify-dev create agent "content-assistant"
dify-dev create workflow "article-pipeline"
dify-dev create tool "text-summarizer" --type api
dify-dev create knowledge "product-docs"

# 通过自然语言描述创建（Agent 生成）
dify-dev create agent "content-assistant" \
  --prompt "创建一个能生成文章并发布到微信公众号的 Agent，
            要求：1. 使用 gpt-4 模型 2. 能调用微信发布工具 3. 有内容审核功能"

# 从模板创建
dify-dev create workflow "article-pipeline" \
  --template article-publishing
```

#### `test` - 本地测试

```bash
# 测试单个组件
dify-dev test content-assistant

# 测试并显示详细输出
dify-dev test content-assistant --verbose

# 测试特定输入
dify-dev test content-assistant \
  --input topic="AI 发展趋势"

# 模拟工具调用（不调用真实服务）
dify-dev test content-assistant \
  --input topic="AI 发展趋势" \
  --mock-tools

# 测试所有组件
dify-dev test --all
```

#### `deploy` - 部署到 Dify

```bash
# 部署单个组件
dify-dev deploy content-assistant

# 强制重新部署（覆盖现有）
dify-dev deploy content-assistant --force

# 部署所有组件
dify-dev deploy --all

# 部署到指定环境
dify-dev deploy content-assistant --env production
```

#### `iterate` - 迭代优化

```bash
# 根据反馈修改
dify-dev iterate content-assistant \
  --prompt "增加一个步骤：发布前检查文章字数是否超过 2000 字"

# 查看修改差异
dify-dev iterate content-assistant \
  --prompt "优化系统提示词，让 Agent 更专业" \
  --diff

# 接受或拒绝修改
dify-dev iterate content-assistant --accept
dify-dev iterate content-assistant --reject
```

#### `status` - 查看状态

```bash
# 查看所有组件状态
dify-dev status

# 输出示例：
# NAME              TYPE           STATUS    VERSION    LAST_DEPLOYED    HEALTH
# content-assistant agent          active    v3         2026-04-19 10:00 ✓
# article-pipeline  workflow       active    v2         2026-04-19 09:30 ✓
# wechat-publisher  tool           active    v1         2026-04-19 08:00 ✓
# product-docs      knowledge      syncing   v1         2026-04-19 07:00 ⟳

# 查看单个组件详情
dify-dev status content-assistant --detail
```

#### `logs` - 查看日志

```bash
# 查看组件运行日志
dify-dev logs content-assistant

# 实时跟踪
dify-dev logs content-assistant --follow

# 查看最近 100 条
dify-dev logs content-assistant --tail 100
```

#### `destroy` - 删除组件

```bash
# 从 Dify 删除（保留本地代码）
dify-dev destroy content-assistant

# 完全删除（包括本地代码）
dify-dev destroy content-assistant --purge
```

### 4.3 配置文件

`dify-dev.yaml`（项目级配置）：

```yaml
# Dify 连接配置
 dify:
  api_url: "http://localhost:5001"
  console_url: "http://localhost"
  db:
    host: "localhost"
    port: 5432
    user: "postgres"
    password: "${DIFY_DB_PASSWORD}"  # 从环境变量读取
    database: "dify"

# 开发服务器配置
dev_server:
  port: 3002
  hot_reload: true
  
# LLM 配置（用于代码生成）
llm:
  provider: openai
  model: gpt-4
  api_key: "${OPENAI_API_KEY}"
  
# 组件目录
components_dir: "./enterprise/components"

# 部署配置
deploy:
  default_env: "development"
  environments:
    development:
      dify_api_url: "http://localhost:5001"
    staging:
      dify_api_url: "https://dify-staging.example.com"
    production:
      dify_api_url: "https://dify.example.com"

# 测试配置
test:
  mock_llm: true
  mock_tools: true
  timeout: 30
```

---

## 5. 编译器设计

### 5.1 编译流程

```
YAML DSL 文件
     ↓
Parser（解析为 AST）
     ↓
Validator（语义验证）
     ↓
Resolver（引用解析）
     ↓
Optimizer（优化）
     ↓
Code Generator（生成目标代码）
     ↓
Dify JSON / SQL
```

### 5.2 编译目标

| 组件类型 | 编译目标 | 写入方式 |
|----------|----------|----------|
| Tool (API) | `tool_api_providers` 表记录 | SQL INSERT/UPDATE |
| Tool (MCP) | `tool_mcp_providers` 表记录 | SQL INSERT/UPDATE |
| Workflow | Dify Workflow JSON + `workflows` 表 | HTTP API |
| Agent | Dify App JSON + `apps` 表 | HTTP API |
| Knowledge | Dify Knowledge JSON + `datasets` 表 | HTTP API |
| Chatflow | Dify Chatflow JSON + `apps` 表 | HTTP API |
| TextGeneration | Dify App JSON + `apps` 表 | HTTP API |

### 5.3 引用解析

```yaml
# DSL 中的引用语法
tools:
  - ref: mcp-wechat.publish_article    # 格式：provider.tool_name
  - ref: enterprise-tool-service.summarize
  - ref: product-docs                  # 知识库引用

# 编译时解析为 Dify 内部 ID
tools:
  - tool_id: "feec3b07-e5ec-40d8-aea3-bf9e0e7cb235"  # MCP provider ID
    tool_name: "publish_article"
  - tool_id: "c39a8ee8-ebcf-4547-ba42-1dd77304cfae"  # API provider ID
    tool_name: "summarize"
```

---

## 6. 测试框架

### 6.1 测试类型

| 类型 | 描述 | 命令 |
|------|------|------|
| **单元测试** | 测试单个组件的逻辑 | `dify-dev test <name>` |
| **集成测试** | 测试组件间交互 | `dify-dev test --integration` |
| **端到端测试** | 模拟完整用户流程 | `dify-dev test --e2e` |
| **回归测试** | 对比输出是否符合预期 | `dify-dev test --regression` |

### 6.2 测试用例定义

```yaml
# enterprise/components/agents/content-assistant/tests/cases.yml
test_cases:
  - name: "生成技术文章"
    inputs:
      topic: "Docker 容器化部署最佳实践"
    mocks:
      tools:
        summarize:
          output:
            summary: "1. 使用多阶段构建 2. 优化镜像大小 3. 安全配置"
    assertions:
      - type: contains
        path: "response.content"
        value: "Docker"
      - type: length
        path: "response.content"
        min: 500
        max: 3000
      - type: json_schema
        path: "response"
        schema:
          type: object
          required: ["content", "title"]

  - name: "发布到微信"
    inputs:
      topic: "测试文章"
      action: "publish"
    mocks:
      tools:
        publish_article:
          output:
            status: "success"
            url: "https://mp.weixin.qq.com/s/test"
    assertions:
      - type: equals
        path: "steps.publish.output.status"
        value: "success"
```

---

## 7. 实施路径

### Phase 1：基础设施（2 周）

**目标**：搭建 DevKit 核心框架

**任务**：
1. 创建 `enterprise/dev-kit/` 目录结构
2. 实现 CLI 框架（命令解析、配置加载）
3. 实现 YAML Parser（基础解析）
4. 实现 Dify Client（API 封装）
5. 实现基础注册逻辑（Tool）

**交付物**：
- `dify-dev create tool` 可用
- `dify-dev deploy` 可用
- 支持 Tool（API 和 MCP）的完整生命周期

### Phase 2：工作流（2 周）

**目标**：支持 Workflow DSL

**任务**：
1. 设计 Workflow DSL 语法
2. 实现 Workflow Parser
3. 实现 Workflow Compiler（编译为 Dify Workflow JSON）
4. 实现 `dify-dev create workflow`
5. 支持条件分支、循环等控制流

**交付物**：
- `dify-dev create workflow` 可用
- 支持常见节点类型（LLM、Tool、Condition、Human-in-the-loop）

### Phase 3：Agent 和 Chatflow（2 周）

**目标**：支持 Agent 和 Chatflow

**任务**：
1. 设计 Agent DSL 语法
2. 实现 Agent Parser 和 Compiler
3. 实现 Chatflow DSL
4. 实现 `dify-dev create agent`
5. 实现 `dify-dev create chatflow`

**交付物**：
- `dify-dev create agent` 可用
- `dify-dev create chatflow` 可用
- 支持工具绑定、记忆配置、知识库绑定

### Phase 4：知识库和文本生成（2 周）

**目标**：支持 Knowledge 和 TextGeneration

**任务**：
1. 设计 Knowledge DSL
2. 实现数据源解析（文件、Web、API）
3. 实现 TextGeneration DSL
4. 实现 `dify-dev create knowledge`
5. 实现 `dify-dev create text-generation`

**交付物**：
- 所有组件类型支持完整生命周期

### Phase 5：智能化（2 周）

**目标**：大模型 Agent 集成

**任务**：
1. 实现 LLM Prompt Builder
2. 实现代码生成器（Generator）
3. 实现 `dify-dev create --prompt`
4. 实现 `dify-dev iterate`
5. 实现代码审查（Code Reviewer）

**交付物**：
- 自然语言生成组件代码
- 迭代优化功能

### Phase 6：生产化（2 周）

**目标**：企业级特性

**任务**：
1. 实现多环境支持（dev/staging/prod）
2. 实现 CI/CD 集成（GitHub Actions/GitLab CI）
3. 实现监控和日志
4. 实现权限管理
5. 完善文档和示例

**交付物**：
- 生产可用
- 完整文档

---

## 8. 与现有架构的关系

### 8.1 兼容性

| 现有组件 | 关系 | 说明 |
|----------|------|------|
| `enterprise/mcp-servers/` | 扩展 | 通过 `dify-dev create mcp-server` 生成 |
| `enterprise/tool-service/` | 扩展 | 通过 `dify-dev create tool` 生成 |
| `enterprise/workflows/` | 扩展 | 迁移到 `enterprise/components/workflows/` |
| `enterprise/skills/` | 扩展 | 迁移到 `enterprise/components/agents/` |
| `enterprise/scripts/` | 复用 | `register-tools.py` 作为 Registry 模块基础 |
| `Makefile` | 扩展 | 增加 `dev-kit` 相关命令 |

### 8.2 迁移策略

1. **保留现有**：当前已实现的 MCP 和 Tool 保持可用
2. **渐进迁移**：新组件使用 DevKit，旧组件逐步迁移
3. **向后兼容**：DevKit 生成的组件与手动配置的组件共存

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Dify API 变更 | 高 | 封装 Dify Client，隔离变化；关注 Dify 更新日志 |
| DSL 设计不合理 | 中 | 先实现 MVP，根据反馈迭代；参考成熟工具（如 GitHub Actions） |
| 大模型生成质量不稳定 | 中 | 提供模板和示例；人工审查环节；逐步优化 Prompt |
| 性能问题（编译慢） | 低 | 增量编译；缓存机制；并行处理 |
| 团队协作冲突 | 中 | Git 管理；代码审查；版本锁定 |

---

## 10. 成功指标

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 组件创建时间 | < 5 分钟（从需求到可用） | 计时 |
| 代码生成准确率 | > 80%（无需人工修改即可运行） | 人工评估 |
| 团队协作效率 | PR 审查替代 UI 截图审查 | 调查问卷 |
| 版本回滚时间 | < 1 分钟 | `git revert` + `dify-dev deploy` |
| 新成员上手时间 | < 30 分钟 | 文档阅读 + 创建一个组件 |

---

*文档版本：v1.0*  
*最后更新：2026-04-19*  
*状态：已确认，待实施*
