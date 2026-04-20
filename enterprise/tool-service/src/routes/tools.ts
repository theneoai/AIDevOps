import { Router } from 'express';
import { requireRole } from '../middleware/rbac';
import { promptGuard } from '../middleware/prompt-guard';
import { anonymizeText } from '../pii/presidio-client';

const router = Router();

/**
 * 示例工具: 文本摘要生成
 * POST /tools/summarize
 * 
 * Request Body:
 *   - text: string (required) - 需要摘要的文本
 *   - max_length: number (optional) - 摘要最大长度，默认 100
 * 
 * Response:
 *   - summary: string - 生成的摘要
 *   - original_length: number - 原始文本长度
 *   - summary_length: number - 摘要长度
 */
router.post('/tools/summarize', requireRole('developer'), promptGuard, async (req, res) => {
  const rawText: string = req.body.text;
  const max_length = req.body.max_length ?? 100;
  const text = await anonymizeText(rawText);

  if (!rawText || typeof rawText !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      message: 'text is required and must be a string',
    });
    return;
  }

  // 简单的摘要逻辑（实际项目中可以调用 LLM）
  const sentences = text.split(/[。！？.!?]/).filter(s => s.trim());
  let summary = sentences.slice(0, 2).join('。');
  
  if (summary.length > max_length) {
    summary = summary.substring(0, max_length) + '...';
  }

  res.json({
    summary,
    original_length: text.length,
    summary_length: summary.length,
  });
});

/**
 * 示例工具: 关键词提取
 * POST /tools/extract-keywords
 * 
 * Request Body:
 *   - text: string (required) - 需要提取关键词的文本
 *   - count: number (optional) - 关键词数量，默认 5
 * 
 * Response:
 *   - keywords: string[] - 提取的关键词列表
 */
router.post('/tools/extract-keywords', requireRole('developer'), promptGuard, async (req, res) => {
  const rawText: string = req.body.text;
  const count = req.body.count ?? 5;
  const text = await anonymizeText(rawText);

  if (!rawText || typeof rawText !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      message: 'text is required and must be a string',
    });
    return;
  }

  // 简单的关键词提取（实际项目中可以使用 NLP 库）
  const words = text.split(/\s+/);
  const wordFreq: Record<string, number> = {};
  
  words.forEach(word => {
    const clean = word.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();
    if (clean.length > 1) {
      wordFreq[clean] = (wordFreq[clean] || 0) + 1;
    }
  });

  const keywords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word);

  res.json({ keywords });
});

/**
 * OpenAPI Schema 端点
 * GET /openapi.json
 * 
 * 返回 OpenAPI 3.0 schema，用于 Dify 自动注册
 */
router.get('/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'Enterprise Tool Service',
      version: '1.0.0',
      description: '企业自研通用工具服务',
    },
    servers: [
      {
        url: 'http://enterprise-tool-service:3000',
        description: '内部网络',
      },
    ],
    paths: {
      '/tools/summarize': {
        post: {
          operationId: 'summarize',
          summary: '文本摘要生成',
          description: '对输入文本生成简短摘要',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    text: {
                      type: 'string',
                      description: '需要摘要的文本',
                    },
                    max_length: {
                      type: 'integer',
                      description: '摘要最大长度',
                      default: 100,
                    },
                  },
                  required: ['text'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: '成功',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      summary: {
                        type: 'string',
                        description: '生成的摘要',
                      },
                      original_length: {
                        type: 'integer',
                      },
                      summary_length: {
                        type: 'integer',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/tools/extract-keywords': {
        post: {
          operationId: 'extract_keywords',
          summary: '关键词提取',
          description: '从文本中提取关键词',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    text: {
                      type: 'string',
                      description: '需要提取关键词的文本',
                    },
                    count: {
                      type: 'integer',
                      description: '关键词数量',
                      default: 5,
                    },
                  },
                  required: ['text'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: '成功',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      keywords: {
                        type: 'array',
                        items: {
                          type: 'string',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
});

export default router;
