import axios from 'axios';

const ANALYZER_URL =
  process.env.PRESIDIO_ANALYZER_URL ?? 'http://presidio-analyzer:3000';
const ANONYMIZER_URL =
  process.env.PRESIDIO_ANONYMIZER_URL ?? 'http://presidio-anonymizer:3000';

const CHINESE_PII_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  {
    name: 'CN_ID_CARD',
    regex: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    replacement: '[身份证号已脱敏]',
  },
  {
    name: 'CN_PHONE',
    regex: /(?:\+?86[-\s]?)?1[3-9]\d{9}\b/g,
    replacement: '[手机号已脱敏]',
  },
  {
    name: 'CN_BANK_CARD',
    regex: /\b(?:6\d{15,18}|4\d{15}|5[1-5]\d{14})\b/g,
    replacement: '[银行卡号已脱敏]',
  },
];

/**
 * Detects and anonymizes PII in text.
 * Fast path: Chinese-specific regex patterns applied locally.
 * Slow path: Presidio REST API for international PII (email, passport, etc.).
 * Falls back to regex-only result if Presidio is unavailable (degraded mode).
 */
export async function anonymizeText(text: string): Promise<string> {
  let sanitized = text;
  for (const { regex, replacement } of CHINESE_PII_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }

  if (process.env.PRESIDIO_ENABLED === 'false') {
    return sanitized;
  }

  try {
    const analyzeRes = await axios.post(
      `${ANALYZER_URL}/analyze`,
      { text: sanitized, language: 'zh' },
      { timeout: 3000 }
    );

    if (!analyzeRes.data || analyzeRes.data.length === 0) {
      return sanitized;
    }

    const anonymizeRes = await axios.post(
      `${ANONYMIZER_URL}/anonymize`,
      {
        text: sanitized,
        analyzer_results: analyzeRes.data,
        anonymizers: { DEFAULT: { type: 'replace', new_value: '[REDACTED]' } },
      },
      { timeout: 3000 }
    );

    return anonymizeRes.data.text as string;
  } catch {
    // Presidio unavailable — degrade gracefully to regex-only result
    return sanitized;
  }
}

export function hasPii(text: string): boolean {
  return CHINESE_PII_PATTERNS.some(({ regex }) => {
    regex.lastIndex = 0;
    return regex.test(text);
  });
}
