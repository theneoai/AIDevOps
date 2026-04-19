import winston from 'winston';

export function createLogger(service: string, level?: string): winston.Logger {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return winston.createLogger({
    level: level || 'info',
    format: isProduction
      ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      : winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.simple()
        ),
    defaultMeta: { service },
    transports: [
      new winston.transports.Console(),
    ],
  });
}
