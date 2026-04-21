import winston from 'winston';

export function createLogger(service?: string): winston.Logger {
  return winston.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    defaultMeta: { service: service ?? 'analytics' },
    transports: [new winston.transports.Console()],
  });
}
