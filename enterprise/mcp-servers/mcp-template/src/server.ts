import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

const tools: Tool[] = [
  {
    name: 'example_tool',
    description: 'An example tool that echoes a message back',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to echo',
        },
      },
      required: ['message'],
    },
  },
];

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'dify-mcp-template',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'example_tool': {
        const message = (args as { message: string }).message;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ result: `Echo: ${message}` }),
            },
          ],
        };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}

export { SSEServerTransport };
