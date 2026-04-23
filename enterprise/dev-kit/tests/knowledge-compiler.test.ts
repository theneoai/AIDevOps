/**
 * Knowledge DSL Compiler Tests
 */

import { KnowledgeCompiler, KnowledgeDSL } from '../src/compilers/knowledge-compiler';

function makeKnowledgeDSL(overrides: Partial<KnowledgeDSL['spec']> = {}): KnowledgeDSL {
  return {
    apiVersion: 'dify.dev/v1',
    kind: 'Knowledge',
    metadata: { name: 'test-kb', description: 'Test knowledge base' },
    spec: {
      sources: [{ type: 'file', pattern: 'docs/**/*.md' }],
      ...overrides,
    },
  };
}

describe('KnowledgeCompiler', () => {
  const compiler = new KnowledgeCompiler();

  it('compiles with default retrieval settings', () => {
    const payload = compiler.compile(makeKnowledgeDSL());
    expect(payload.name).toBe('test-kb');
    expect(payload.indexing_technique).toBe('high_quality');
    expect(payload.retrieval_model?.search_method).toBe('semantic_search');
    expect(payload.retrieval_model?.top_k).toBe(5);
    expect(payload.retrieval_model?.score_threshold).toBe(0.5);
    expect(payload.retrieval_model?.score_threshold_enabled).toBe(false);
  });

  it('respects custom retrieval mode: hybrid', () => {
    const payload = compiler.compile(
      makeKnowledgeDSL({ retrieval: { mode: 'hybrid', topK: 10, scoreThreshold: 0.7 } }),
    );
    expect(payload.retrieval_model?.search_method).toBe('hybrid_search');
    expect(payload.retrieval_model?.top_k).toBe(10);
    expect(payload.retrieval_model?.score_threshold_enabled).toBe(true);
    expect(payload.retrieval_model?.score_threshold).toBe(0.7);
  });

  it('builds web document payload', () => {
    const doc = compiler.buildWebDocument({ type: 'web', sitemapUrl: 'https://example.com/sitemap.xml', maxPages: 100 });
    expect(doc.url).toBe('https://example.com/sitemap.xml');
    expect(doc.indexing_technique).toBe('high_quality');
    expect(doc.process_rule.mode).toBe('automatic');
  });

  it('builds api document payload', () => {
    const doc = compiler.buildApiDocument({ type: 'api', url: 'https://api.example.com/docs' });
    expect(doc.url).toBe('https://api.example.com/docs');
    expect(doc.name).toContain('api:');
  });

  it('sets permission to all_team_members by default', () => {
    const payload = compiler.compile(makeKnowledgeDSL());
    expect(payload.permission).toBe('all_team_members');
  });
});
