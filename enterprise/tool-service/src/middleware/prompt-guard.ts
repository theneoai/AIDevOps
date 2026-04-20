import { Request, Response, NextFunction } from 'express';

const INJECTION_PATTERNS: RegExp[] = [
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
];

const MAX_INPUT_LENGTH = 4000;

export function promptGuard(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== 'object') {
    next();
    return;
  }

  const textFields = extractTextFields(body);

  for (const [field, value] of textFields) {
    if (value.length > MAX_INPUT_LENGTH) {
      res.status(400).json({
        error: 'Input too long',
        field,
        max_length: MAX_INPUT_LENGTH,
      });
      return;
    }
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        console.warn(`[PromptGuard] Injection pattern detected in field '${field}' from ${req.ip}`);
        res.status(400).json({ error: 'Input contains disallowed content' });
        return;
      }
    }
  }

  next();
}

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
