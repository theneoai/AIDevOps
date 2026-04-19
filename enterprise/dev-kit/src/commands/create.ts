/**
 * Create Command
 *
 * Generates a new component YAML file from a template.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadConfig } from '../core/config';

export interface CreateOptions {
  type: 'api' | 'mcp';
  configPath?: string;
  verbose?: boolean;
}

function generateApiToolTemplate(name: string): string {
  return `apiVersion: v1
kind: Tool
metadata:
  name: ${name}
  description: "${name} tool description"
  icon: "🔧"
  version: "1.0.0"
  author: "enterprise"
  labels:
    - "api"
    - "enterprise"
spec:
  type: api
  server: http://localhost:3000
  authentication:
    type: none
  endpoints:
    - path: /v1/example
      method: POST
      operationId: exampleOperation
      summary: "Example operation"
      description: "An example API endpoint"
      inputs:
        - name: text
          type: string
          required: true
          description: "Input text"
      outputs:
        - name: result
          type: string
          description: "Operation result"
`;
}

function generateMcpToolTemplate(name: string): string {
  return `apiVersion: v1
kind: Tool
metadata:
  name: ${name}
  description: "${name} MCP tool description"
  icon: "🔌"
  version: "1.0.0"
  author: "enterprise"
  labels:
    - "mcp"
    - "enterprise"
spec:
  type: mcp
  server: http://localhost:3000/sse
  tools:
    - name: exampleTool
      description: "An example MCP tool"
      inputs:
        - name: param1
          type: string
          required: true
          description: "First parameter"
      outputs:
        - name: result
          type: string
          description: "Tool result"
`;
}

export async function createCommand(name: string, options: CreateOptions): Promise<void> {
  const config = loadConfig();
  const componentsDir = config.componentsDir;

  // Ensure components directory exists
  if (!fs.existsSync(componentsDir)) {
    fs.mkdirSync(componentsDir, { recursive: true });
  }

  const fileName = `${name}.yml`;
  const filePath = path.join(componentsDir, fileName);

  if (fs.existsSync(filePath)) {
    console.error(chalk.red(`Error: Component file already exists: ${filePath}`));
    process.exit(1);
  }

  const template = options.type === 'api'
    ? generateApiToolTemplate(name)
    : generateMcpToolTemplate(name);

  fs.writeFileSync(filePath, template, 'utf-8');

  console.log(chalk.green(`✓ Created ${options.type} tool: ${filePath}`));
  console.log(chalk.gray(`  Edit the file and run: dify-dev deploy ${name}`));
}
