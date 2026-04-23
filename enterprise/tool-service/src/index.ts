import './tracer'; // must be first import — initializes OTel SDK before Express
import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { createLogger } from './logger';
import healthRouter from './routes/health';
import toolsRouter from './routes/tools';
import { rateLimiter } from './middleware/rate-limit';
import { tokenBlacklist } from './middleware/token-blacklist';
import { requireRole, revokeToken, JwtClaims } from './middleware/rbac';
import { tenantIsolation } from './middleware/tenant-isolation';

const logger = createLogger();
const app = express();

// Initialize token blacklist (connects to Redis if REDIS_URL is set)
tokenBlacklist.init().catch((err) => logger.error('Token blacklist init failed', { error: String(err) }));

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    service: 'enterprise-tool-service',
    version: '1.0.0',
    status: 'running',
  });
});

app.use('/', healthRouter);

// POST /auth/logout — revoke the caller's token immediately
app.post('/auth/logout', requireRole('viewer'), async (req, res) => {
  try {
    await revokeToken(req.user as JwtClaims);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout failed', { error: String(err) });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Rate limiter and tenant isolation run after auth (rbac sets req.user).
app.use(tenantIsolation);
app.use(rateLimiter);
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
