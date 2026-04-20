/**
 * P5-3c: Knowledge DSL Compiler
 *
 * Translates a knowledge base DSL spec into a Dify Dataset creation payload.
 * Supports file globs, web sitemaps, and REST API polling data sources.
 */

import * as path from 'path';
import * as fs from 'fs-extra';

// ─────────────────────────────────────────────────────────────
// Knowledge DSL Types (extending dsl.ts)
// ─────────────────────────────────────────────────────────────

export type KnowledgeSourceType = 'file' | 'web' | 'api';

export interface FileKnowledgeSource {
  type: 'file';
  pattern: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface WebKnowledgeSource {
  type: 'web';
  sitemapUrl: string;
  maxPages?: number;
  crawlDepth?: number;
}

export interface ApiKnowledgeSource {
  type: 'api';
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  jsonPath?: string;
  pollIntervalSeconds?: number;
}

export type KnowledgeSource = FileKnowledgeSource | WebKnowledgeSource | ApiKnowledgeSource;

export interface KnowledgeDSL {
  apiVersion: string;
  kind: 'Knowledge';
  metadata: {
    name: string;
    description?: string;
  };
  spec: {
    sources: KnowledgeSource[];
    embedding?: {
      provider?: string;
      model?: string;
    };
    retrieval?: {
      topK?: number;
      scoreThreshold?: number;
      mode?: 'semantic' | 'keyword' | 'hybrid';
    };
  };
}

// ─────────────────────────────────────────────────────────────
// Dify Dataset Payload
// ─────────────────────────────────────────────────────────────

export interface DifyDatasetPayload {
  name: string;
  description: string;
  indexing_technique: 'high_quality' | 'economy';
  permission: 'only_me' | 'all_team_members';
  retrieval_model?: {
    search_method: 'semantic_search' | 'keyword_search' | 'hybrid_search';
    reranking_enable: boolean;
    top_k: number;
    score_threshold_enabled: boolean;
    score_threshold: number;
  };
}

export interface DifyDocumentPayload {
  name: string;
  text?: string;
  url?: string;
  indexing_technique: 'high_quality';
  process_rule: {
    mode: 'automatic' | 'custom';
    rules?: {
      pre_processing_rules: Array<{ id: string; enabled: boolean }>;
      segmentation: { separator: string; max_tokens: number };
    };
  };
}

// ─────────────────────────────────────────────────────────────
// Compiler
// ─────────────────────────────────────────────────────────────

export class KnowledgeCompiler {
  compile(dsl: KnowledgeDSL): DifyDatasetPayload {
    const retrieval = dsl.spec.retrieval;
    return {
      name: dsl.metadata.name,
      description: dsl.metadata.description ?? '',
      indexing_technique: 'high_quality',
      permission: 'all_team_members',
      retrieval_model: {
        search_method: modeToSearchMethod(retrieval?.mode ?? 'semantic'),
        reranking_enable: false,
        top_k: retrieval?.topK ?? 5,
        score_threshold_enabled: retrieval?.scoreThreshold !== undefined,
        score_threshold: retrieval?.scoreThreshold ?? 0.5,
      },
    };
  }

  async resolveDocuments(
    source: FileKnowledgeSource,
    basePath: string,
  ): Promise<DifyDocumentPayload[]> {
    const fullPattern = path.resolve(basePath, source.pattern);
    const matches: string[] = [];

    // Scan directory matching the pattern prefix
    const dir = path.dirname(fullPattern);
    if (await fs.pathExists(dir)) {
      const files = await fs.readdir(dir);
      for (const f of files) {
        matches.push(path.join(dir, f));
      }
    }

    const docs: DifyDocumentPayload[] = [];
    for (const filePath of matches) {
      const content = await fs.readFile(filePath, 'utf-8');
      docs.push({
        name: path.basename(filePath),
        text: content,
        indexing_technique: 'high_quality',
        process_rule: {
          mode: 'custom',
          rules: {
            pre_processing_rules: [
              { id: 'remove_extra_spaces', enabled: true },
              { id: 'remove_urls_emails', enabled: false },
            ],
            segmentation: {
              separator: '\n\n',
              max_tokens: source.chunkSize ?? 1000,
            },
          },
        },
      });
    }

    return docs;
  }

  buildWebDocument(source: WebKnowledgeSource): DifyDocumentPayload {
    return {
      name: `web:${source.sitemapUrl}`,
      url: source.sitemapUrl,
      indexing_technique: 'high_quality',
      process_rule: { mode: 'automatic' },
    };
  }

  buildApiDocument(source: ApiKnowledgeSource): DifyDocumentPayload {
    return {
      name: `api:${source.url}`,
      url: source.url,
      indexing_technique: 'high_quality',
      process_rule: { mode: 'automatic' },
    };
  }
}

function modeToSearchMethod(
  mode: 'semantic' | 'keyword' | 'hybrid',
): 'semantic_search' | 'keyword_search' | 'hybrid_search' {
  const map = {
    semantic: 'semantic_search' as const,
    keyword: 'keyword_search' as const,
    hybrid: 'hybrid_search' as const,
  };
  return map[mode];
}

export function compileKnowledge(dsl: KnowledgeDSL): DifyDatasetPayload {
  return new KnowledgeCompiler().compile(dsl);
}
