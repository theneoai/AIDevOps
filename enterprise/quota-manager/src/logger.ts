import winston from 'winston';
import { config } from './config';

export function createLogger(service?: string): winston.Logger {
  return winston.createLogger({
    level: config.LOG_LEVEL,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
    ),
    defaultMeta: { service: service ?? 'quota-manager' },
    transports: [new winston.transports.Console()],
  });
}
