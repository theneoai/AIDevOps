import './tracer'; // must be first import — initializes OTel SDK before Express
import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { createLogger } from './logger';
import healthRouter from './routes/health';
import toolsRouter from './routes/tools';

const logger = createLogger();
const app = express();

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    service: 'enterprise-tool-service',
    version: '1.0.0',
    status: 'running',
  });
});

app.use('/', healthRouter);
app.use('/', toolsRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
});

if (require.main === module) {
  app.listen(config.SERVICE_PORT, () => {
    logger.info('Server started', {
      port: config.SERVICE_PORT,
      env: config.NODE_ENV,
    });
  });
}

export default app;
