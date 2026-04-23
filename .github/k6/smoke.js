import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const errorRate = new Rate('errors');

export const options = {
  vus: 50,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(99)<500'],
    errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const TARGET = __ENV.TARGET_URL || 'http://localhost:3100';

export default function () {
  // Health check
  const healthRes = http.get(`${TARGET}/health`);
  check(healthRes, { 'health 200': (r) => r.status === 200 });
  errorRate.add(healthRes.status !== 200);

  sleep(0.5);

  // Tool endpoint (unauthenticated → expect 401, not 5xx)
  const toolRes = http.post(
    `${TARGET}/tools/summarize`,
    JSON.stringify({ text: 'Load test input text for summarization endpoint' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  // 401 is expected without auth — we just verify it's not a 5xx
  check(toolRes, { 'not 5xx': (r) => r.status < 500 });
  errorRate.add(toolRes.status >= 500);

  sleep(0.5);
}
