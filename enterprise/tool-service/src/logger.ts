import winston from 'winston';

export const createLogger = () => {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service: 'enterprise-tool-service' },
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [new winston.transports.Console()],
  });
};

export const logger = createLogger();
