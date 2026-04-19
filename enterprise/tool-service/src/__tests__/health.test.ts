import request from 'supertest';
import app from '../index';

describe('GET /health', () => {
  it('should return 200 and health info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('enterprise-tool-service');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
    expect(typeof res.body.timestamp).toBe('string');
    expect(typeof res.body.uptime).toBe('number');
  });
});
