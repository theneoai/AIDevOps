import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'enterprise-tool-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
