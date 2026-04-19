import { compileApiTool, compileMCPTool, DifyParameter } from '../src/core/compiler';
import { ToolDSL } from '../src/types/dsl';

describe('compiler', () => {
  const apiDSL: ToolDSL = {
    apiVersion: 'dify.enterprise/v1',
    kind: 'Tool',
    metadata: {
      name: 'text-summarizer',
      description: '文本摘要生成工具',
      icon: '📝',
      version: '1.0.0',
      author: 'enterprise',
    },
    spec: {
      type: 'api',
      protocol: 'openapi',
      server: {
        url: 'http://enterprise-tool-service:3000',
        timeout: 30,
      },
      authentication: {
        type: 'none',
      },
      endpoints: [
        {
          path: '/tools/summarize',
          method: 'POST',
          operationId: 'summarize',
          summary: '生成文本摘要',
          inputs: [
            {
              name: 'text',
              type: 'string',
              required: true,
              description: '需要摘要的文本',
            },
            {
              name: 'max_length',
              type: 'integer',
              required: false,
              default: 100,
              description: '最大长度',
            },
          ],
          outputs: [
            {
              name: 'summary',
              type: 'string',
              description: '生成的摘要',
            },
          ],
        },
      ],
    },
  };

  const mcpDSL: ToolDSL = {
    apiVersion: 'dify.enterprise/v1',
    kind: 'Tool',
    metadata: {
      name: 'mcp-search',
      description: 'MCP search tool',
      icon: '🔍',
    },
    spec: {
      type: 'mcp',
      server: 'http://mcp-server:8080',
      tools: [
        {
          name: 'search',
          description: 'Search documents',
          inputs: [
            {
              name: 'query',
              type: 'string',
              required: true,
              description: 'Search query',
            },
          ],
          outputs: [
            {
              name: 'results',
              type: 'array',
              description: 'Search results',
            },
          ],
        },
      ],
    },
  };

  describe('compileApiTool', () => {
    it('compiles API tool to DifyApiToolProvider', () => {
      const result = compileApiTool(apiDSL, 'tenant-1', 'user-1');

      expect(result.tenant_id).toBe('tenant-1');
      expect(result.name).toBe('text-summarizer');
      expect(result.schema_type).toBe('openapi');
      expect(result.schema).toBeDefined();

      const schema = JSON.parse(result.schema!);
      expect(schema.openapi).toBe('3.0.0');
      expect(schema.info.title).toBe('text-summarizer');
      expect(schema.paths['/tools/summarize']).toBeDefined();

      const post = schema.paths['/tools/summarize'].post;
      expect(post.operationId).toBe('summarize');
      expect(post.requestBody).toBeDefined();
    });

    it('maps integer type to number', () => {
      const result = compileApiTool(apiDSL, 'tenant-1', 'user-1');
      const schema = JSON.parse(result.schema!);
      const props = schema.paths['/tools/summarize'].post.requestBody.content['application/json'].schema.properties;
      expect(props.max_length.type).toBe('integer');
    });

    it('sets credentials when authentication is provided', () => {
      const dslWithAuth: ToolDSL = {
        ...apiDSL,
        spec: {
          ...apiDSL.spec,
          authentication: {
            type: 'api_key',
            keyName: 'X-API-Key',
            keyLocation: 'header',
          },
        },
      };
      const result = compileApiTool(dslWithAuth, 'tenant-1', 'user-1');
      const creds = JSON.parse(result.credentials!);
      expect(creds.auth_type).toBe('api_key');
      expect(creds.key).toBe('X-API-Key');
    });
  });

  describe('compileMCPTool', () => {
    it('compiles MCP tool to DifyMCPToolProvider', () => {
      const result = compileMCPTool(mcpDSL, 'tenant-1', 'user-1');

      expect(result.tenant_id).toBe('tenant-1');
      expect(result.name).toBe('mcp-search');
      expect(result.config).toBeDefined();

      const config = JSON.parse(result.config!);
      expect(config.server_url).toBe('http://mcp-server:8080');
      expect(config.tools).toHaveLength(1);
      expect(config.tools[0].name).toBe('search');
    });

    it('generates SHA-256 hash for id', () => {
      const result = compileMCPTool(mcpDSL, 'tenant-1', 'user-1');
      expect(result.id).toHaveLength(64);
    });
  });
});
