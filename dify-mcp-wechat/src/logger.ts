import winston from 'winston';

const { combine, timestamp, json, errors } = winston.format;

export function createLogger(logLevel: string) {
  return winston.createLogger({
    level: logLevel,
    defaultMeta: { service: 'dify-mcp-wechat' },
    format: combine(
      timestamp(),
      errors({ stack: true }),
      json()
    ),
    transports: [
      new winston.transports.Console({
        format: logLevel === 'debug'
          ? winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            )
          : undefined,
      }),
    ],
  });
}

// 脱敏函数：递归地从日志中移除敏感信息（大小写不敏感）
export function sanitizeLog(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitivePatterns = [/access[_-]?token/i, /app[_-]?secret/i, /secret/i];

  function sanitizeValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    }

    if (typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const isSensitive = sensitivePatterns.some((pattern) => pattern.test(key));
        sanitized[key] = isSensitive ? '***REDACTED***' : sanitizeValue(val);
      }
      return sanitized;
    }

    return value;
  }

  return sanitizeValue(obj) as Record<string, unknown>;
}
