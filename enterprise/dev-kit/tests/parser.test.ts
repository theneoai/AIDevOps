import { parseToolDSL, parseToolDSLFromFile, parseDSL, ParseError, ToolDSLSchema } from '../src/core/parser';
import * as fs from 'fs';
import * as path from 'path';

describe('parser', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'sample-tool.yml');

  describe('parseToolDSL', () => {
    it('parses valid API tool YAML', () => {
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const result = parseToolDSL(content);

      expect(result.apiVersion).toBe('dify.enterprise/v1');
      expect(result.kind).toBe('Tool');
      expect(result.metadata.name).toBe('text-summarizer');
      expect(result.spec.type).toBe('api');
      expect(result.spec.protocol).toBe('openapi');
      expect(result.spec.endpoints).toHaveLength(1);
      expect(result.spec.endpoints![0].operationId).toBe('summarize');
      expect(result.spec.endpoints![0].inputs).toHaveLength(2);
    });

    it('throws ParseError on invalid YAML', () => {
      expect(() => parseToolDSL('not: [ valid yaml')).toThrow(ParseError);
    });

    it('throws ParseError on validation failure', () => {
      const bad = `
apiVersion: dify.enterprise/v1
kind: Tool
metadata:
  name: test
spec:
  type: unknown-type
`;
      expect(() => parseToolDSL(bad)).toThrow(ParseError);
    });
  });

  describe('parseToolDSLFromFile', () => {
    it('reads and parses a file', () => {
      const result = parseToolDSLFromFile(fixturePath);
      expect(result.metadata.name).toBe('text-summarizer');
    });

    it('throws when file does not exist', () => {
      expect(() => parseToolDSLFromFile('/nonexistent/file.yml')).toThrow();
    });
  });

  describe('parseDSL', () => {
    it('parses with a custom schema', () => {
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const result = parseDSL(content, ToolDSLSchema);
      expect(result.kind).toBe('Tool');
    });
  });
});
