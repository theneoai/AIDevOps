/**
 * Component Registry
 *
 * Centralized registry for all deployed Dify components (Tools, Agents, Workflows).
 * Solves the #1 missing feature: cross-component reference resolution.
 *
 * Reference syntax in DSL:  "ref:<provider>.<operationId>"
 *   Examples:
 *     tool:  ref:mcp-wechat.publish_article
 *     agent: ref:content-writer-agent
 *     workflow: ref:marketing-pipeline
 *
 * The registry is loaded from the Dify PostgreSQL database at startup and kept
 * in memory. It can also be hydrated from a lock file (registry.lock.json) for
 * CI/CD environments where the database is not available during linting/testing.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────
// Registry Entry Types
// ─────────────────────────────────────────────────────────────

export type ComponentType = 'tool_api' | 'tool_mcp' | 'agent' | 'workflow' | 'chatflow' | 'knowledge';

export interface RegistryEntry {
  /** Logical name used in DSL references */
  ref: string;
  /** Dify internal component type */
  type: ComponentType;
  /** UUID in Dify's database */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Semantic version */
  version?: string;
  /** Tenant ID this component belongs to */
  tenantId: string;
  /** ISO timestamp of last registration */
  registeredAt: string;
  /** Optional: specific operation IDs / tool names for tool providers */
  operations?: string[];
}

export interface ResolvedRef {
  entry: RegistryEntry;
  /** Specific operation (for tool refs like "ref:provider.operation") */
  operation?: string;
}

// ─────────────────────────────────────────────────────────────
// Lock File Format
// ─────────────────────────────────────────────────────────────

export interface RegistryLockFile {
  generatedAt: string;
  schemaVersion: '1';
  entries: RegistryEntry[];
}

// ─────────────────────────────────────────────────────────────
// Component Registry
// ─────────────────────────────────────────────────────────────

export class ComponentRegistry {
  private entries: Map<string, RegistryEntry> = new Map();
  private lockFilePath: string;

  constructor(lockFilePath = 'registry.lock.json') {
    this.lockFilePath = lockFilePath;
  }

  // ── Loading ───────────────────────────────────────────────

  /** Load registry from a lock file (for offline/CI use) */
  loadFromLockFile(filePath?: string): void {
    const fp = filePath ?? this.lockFilePath;
    if (!fs.existsSync(fp)) return;

    let raw: RegistryLockFile;
    try {
      raw = JSON.parse(fs.readFileSync(fp, 'utf-8')) as RegistryLockFile;
    } catch (err) {
      throw new Error(`Failed to parse registry lock file at ${fp}: ${(err as Error).message}`);
    }

    if (!raw || !Array.isArray(raw.entries)) {
      throw new Error(`Registry lock file at ${fp} is malformed: missing 'entries' array`);
    }

    for (const entry of raw.entries) {
      this.entries.set(entry.ref, entry);
    }
  }

  /** Hydrate the registry from a list of entries (e.g. from DB query results) */
  hydrate(entries: RegistryEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.ref, entry);
    }
  }

  /** Register or update a single entry */
  register(entry: RegistryEntry): void {
    this.entries.set(entry.ref, entry);
  }

  // ── Lookup ────────────────────────────────────────────────

  /**
   * Resolve a DSL reference string to a registry entry.
   *
   * Handles:
   *   "ref:mcp-wechat.publish_article"  → { entry: <mcp-wechat>, operation: "publish_article" }
   *   "ref:content-writer-agent"        → { entry: <content-writer-agent> }
   *   "builtin:web-search"              → null (builtins are not in registry)
   */
  resolve(refStr: string): ResolvedRef | null {
    if (refStr.startsWith('builtin:')) return null;

    const refPart = refStr.replace(/^ref:/, '');
    const dotIdx = refPart.indexOf('.');

    if (dotIdx === -1) {
      // Simple ref with no operation: "ref:my-agent"
      const entry = this.entries.get(refPart);
      return entry ? { entry } : null;
    }

    // Compound ref: "ref:provider.operation"
    const providerRef = refPart.slice(0, dotIdx);
    const operation = refPart.slice(dotIdx + 1);
    const entry = this.entries.get(providerRef);

    if (!entry) return null;

    if (entry.operations && !entry.operations.includes(operation)) {
      return null; // Operation not found in provider
    }

    return { entry, operation };
  }

  /** Check whether a ref exists in the registry */
  has(refStr: string): boolean {
    return this.resolve(refStr) !== null;
  }

  /** List all registered components */
  list(type?: ComponentType): RegistryEntry[] {
    const all = Array.from(this.entries.values());
    return type ? all.filter(e => e.type === type) : all;
  }

  /** Get a single entry by ref */
  get(refStr: string): RegistryEntry | undefined {
    return this.entries.get(refStr.replace(/^ref:/, ''));
  }

  // ── Persistence ───────────────────────────────────────────

  /** Save current registry to lock file for CI/CD offline use */
  saveLockFile(filePath?: string): void {
    const fp = filePath ?? this.lockFilePath;
    const lock: RegistryLockFile = {
      generatedAt: new Date().toISOString(),
      schemaVersion: '1',
      entries: Array.from(this.entries.values()),
    };
    fs.writeFileSync(fp, JSON.stringify(lock, null, 2), 'utf-8');
  }

  // ── Validation ────────────────────────────────────────────

  /**
   * Validate all DSL references in a list of ref strings.
   * Returns unresolved refs.
   */
  validateRefs(refs: string[]): string[] {
    return refs
      .filter(r => !r.startsWith('builtin:'))
      .filter(r => !this.has(r));
  }

  /** Summary stats */
  stats(): Record<ComponentType | 'total', number> {
    const counts: Record<string, number> = { total: this.entries.size };
    for (const entry of this.entries.values()) {
      counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    }
    return counts as Record<ComponentType | 'total', number>;
  }
}

// ─────────────────────────────────────────────────────────────
// Reference Extractor
// ─────────────────────────────────────────────────────────────

import { WorkflowDSL, AgentDSL, OrchestrationDSL } from '../types/dsl';

/** Extract all "ref:..." strings from a WorkflowDSL */
export function extractWorkflowRefs(dsl: WorkflowDSL): string[] {
  const refs: string[] = [];

  function scanSteps(steps: WorkflowDSL['spec']['steps']) {
    for (const step of steps) {
      const cfg = step.config as unknown as Record<string, unknown>;

      if (step.kind === 'tool' && typeof cfg.tool === 'string') {
        refs.push(cfg.tool);
      }
      if (step.kind === 'agent' && typeof cfg.agent === 'string') {
        refs.push(cfg.agent);
      }
      if (step.kind === 'knowledge' && typeof cfg.knowledgeBase === 'string') {
        refs.push(cfg.knowledgeBase as string);
      }
      if (step.kind === 'condition') {
        const c = cfg as { branches: Array<{ steps: WorkflowDSL['spec']['steps'] }>; default?: WorkflowDSL['spec']['steps'] };
        c.branches.forEach(b => scanSteps(b.steps));
        if (c.default) scanSteps(c.default);
      }
      if (step.kind === 'iteration') {
        const it = cfg as { steps: WorkflowDSL['spec']['steps'] };
        scanSteps(it.steps);
      }
    }
  }

  scanSteps(dsl.spec.steps);
  return [...new Set(refs)];
}

/** Extract all "ref:..." strings from an AgentDSL */
export function extractAgentRefs(dsl: AgentDSL): string[] {
  return [...new Set((dsl.spec.tools || []).map(t => t.ref))];
}

/** Extract all "ref:..." strings from an OrchestrationDSL */
export function extractOrchestrationRefs(dsl: OrchestrationDSL): string[] {
  return [...new Set(dsl.spec.agents.map(a => a.ref))];
}

// ─────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────

let _globalRegistry: ComponentRegistry | null = null;

export function getGlobalRegistry(lockFilePath?: string): ComponentRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new ComponentRegistry(lockFilePath);
    _globalRegistry.loadFromLockFile();
  }
  return _globalRegistry;
}

export function resetGlobalRegistry(): void {
  _globalRegistry = null;
}
