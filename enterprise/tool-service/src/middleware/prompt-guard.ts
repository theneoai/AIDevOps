/**
 * Multi-layer Prompt Injection Guard
 *
 * Three-tier defense strategy:
 *
 *   Tier 1 — Regex patterns (< 1ms): Known injection signatures
 *   Tier 2 — Heuristic scoring (< 5ms): Statistical signals (entropy,
 *             control character density, suspicious token ratios)
 *   Tier 3 — LLM classifier (< 200ms): External classifier API (Lakera Guard
 *             or compatible endpoint) when PROMPT_GUARD_CLASSIFIER_URL is set.
 *             Tier 3 is opt-in; without the env var only Tier 1+2 run.
 *
 * Enforcement modes (PROMPT_GUARD_MODE env var):
 *   strict   — block on any tier detection
 *   balanced — block on Tier 1 or combined Tier 2+3 score ≥ 0.8
 *   permissive — block only on Tier 1 (regex match)
 */

import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { logger } from '../logger';

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_INPUT_LENGTH = 4000;
type GuardMode = 'strict' | 'balanced' | 'permissive';
const GUARD_MODE: GuardMode = (process.env.PROMPT_GUARD_MODE as GuardMode) ?? 'balanced';
const CLASSIFIER_URL = process.env.PROMPT_GUARD_CLASSIFIER_URL;

// ── Tier 1: Regex Patterns ───────────────────────────────────────────────────

const TIER1_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /system\s*:\s*you\s+are/i,
  /\bact\s+as\s+(a\s+)?(?:different|new|another)\b/i,
  /\bjailbreak\b/i,
  /\bdan\s+mode\b/i,
  /<\s*system\s*>/i,
  /\[\s*system\s*\]/i,
  /#{3,}\s*system/i,
  /disregard\s+(all\s+)?prior\s+(instructions?|context)/i,
  /you\s+are\s+now\s+(?:a\s+)?(?:different|new|an?\s+AI)/i,
  // Additional 2025 patterns
  /pretend\s+(you\s+are|to\s+be)\s+(?:a\s+)?(?:different|unrestricted|evil|unaligned)/i,
  /override\s+(safety|content|ethical)\s+(policy|filter|guardrail)/i,
  /\bdo\s+anything\s+now\b/i,
  /\bdeveloper\s+mode\b/i,
  /\bgrandma\s+(exploit|trick|bypass)\b/i,
];

// ── Tier 2: Heuristic Scoring ────────────────────────────────────────────────

function tier2Score(text: string): number {
  let score = 0;

  // Control characters (non-printable, zero-width) — common in encoded injections
  const controlChars = (text.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f​-‏  ]/g) ?? []).length;
  score += Math.min(0.4, controlChars * 0.05);

  // Instruction-like imperative verbs near "you" or "model"
  const imperativeMatches = (text.match(/\b(you\s+must|you\s+should|you\s+will|always\s+respond|never\s+say|stop\s+being)\b/gi) ?? []).length;
  score += Math.min(0.3, imperativeMatches * 0.1);

  // Excessive quote nesting or code fencing — prompt wrapping technique
  const codeFences = (text.match(/```/g) ?? []).length;
  score += Math.min(0.2, Math.floor(codeFences / 2) * 0.1);

  // Base64-like density — encoded payload
  const base64Like = (text.match(/[A-Za-z0-9+/]{40,}={0,2}/g) ?? []).length;
  score += Math.min(0.3, base64Like * 0.15);

  // Role confusion keywords
  const roleConfusion = (text.match(/\b(assistant|ai|model|gpt|claude|llm)\b/gi) ?? []).length;
  if (roleConfusion >= 3) score += 0.2;

  return Math.min(1.0, score);
}

// ── Tier 3: LLM Classifier ───────────────────────────────────────────────────

interface ClassifierResponse {
  flagged: boolean;
  score: number;
  categories?: string[];
}

async function tier3Classify(text: string): Promise<{ flagged: boolean; score: number }> {
  if (!CLASSIFIER_URL) return { flagged: false, score: 0 };

  try {
    const resp = await axios.post<ClassifierResponse>(
      CLASSIFIER_URL,
      { input: text },
      { timeout: 2000, headers: { 'Content-Type': 'application/json' } },
    );
    return { flagged: resp.data.flagged, score: resp.data.score ?? 0 };
  } catch (err) {
    // Classifier unavailable — degrade gracefully (don't block)
    logger.warn('Prompt classifier unavailable', { error: String(err) });
    return { flagged: false, score: 0 };
  }
}

// ── Field Extractor ───────────────────────────────────────────────────────────

function extractTextFields(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  const results: [string, string][] = [];
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'string') {
      results.push([path, val]);
    } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      results.push(...extractTextFields(val as Record<string, unknown>, path));
    } else if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (typeof item === 'string') results.push([`${path}[${i}]`, item]);
        else if (item && typeof item === 'object')
          results.push(...extractTextFields(item as Record<string, unknown>, `${path}[${i}]`));
      });
    }
  }
  return results;
}

// ── Main Middleware ───────────────────────────────────────────────────────────

export async function promptGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== 'object') {
    next();
    return;
  }

  const textFields = extractTextFields(body);

  for (const [field, value] of textFields) {
    // Length check (all modes)
    if (value.length > MAX_INPUT_LENGTH) {
      res.status(400).json({ error: 'Input too long', field, max_length: MAX_INPUT_LENGTH });
      return;
    }

    // Tier 1: regex (all modes)
    for (const pattern of TIER1_PATTERNS) {
      if (pattern.test(value)) {
        logger.warn('Prompt injection: Tier 1 pattern matched', {
          field,
          ip: req.ip,
          pattern: pattern.source,
          mode: GUARD_MODE,
        });
        res.status(400).json({ error: 'Input contains disallowed content', tier: 1 });
        return;
      }
    }

    if (GUARD_MODE === 'permissive') continue;

    // Tier 2: heuristics
    const t2Score = tier2Score(value);

    if (GUARD_MODE === 'strict' && t2Score > 0.3) {
      logger.warn('Prompt injection: Tier 2 heuristic', { field, score: t2Score });
      res.status(400).json({ error: 'Input contains disallowed content', tier: 2 });
      return;
    }

    // Tier 3: classifier (if configured)
    let t3Score = 0;
    let t3Flagged = false;
    if (CLASSIFIER_URL && t2Score > 0.2) {
      const result = await tier3Classify(value);
      t3Score = result.score;
      t3Flagged = result.flagged;
    }

    const combinedScore = (t2Score + t3Score) / 2;

    if (GUARD_MODE === 'strict' && (t3Flagged || combinedScore > 0.5)) {
      logger.warn('Prompt injection: Tier 3 classifier', { field, combinedScore, t3Flagged });
      res.status(400).json({ error: 'Input contains disallowed content', tier: 3 });
      return;
    }

    if (GUARD_MODE === 'balanced' && (t3Flagged || combinedScore >= 0.8)) {
      logger.warn('Prompt injection: combined score exceeded threshold', { field, combinedScore });
      res.status(400).json({ error: 'Input contains disallowed content', tier: 3 });
      return;
    }
  }

  next();
}
