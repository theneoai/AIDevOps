// Must be imported before express and any other instrumented library
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';

const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';

// Configurable sampling ratio — default 10% to avoid overwhelming the backend.
// Force 100% in debug mode, 0% to disable while keeping instrumentation.
const SAMPLE_RATIO = parseFloat(process.env.OTEL_SAMPLE_RATIO ?? '0.1');

let sdk: NodeSDK | null = null;

if (OTEL_ENABLED) {
  const exporter = new OTLPTraceExporter({
    url:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      'http://langfuse-server:3000/api/public/otel/v1/traces',
    headers: {
      Authorization: `Bearer ${process.env.LANGFUSE_SECRET_KEY ?? ''}`,
    },
  });

  // ParentBasedSampler: respect upstream sampling decision;
  // for root spans apply the configured ratio.
  const sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(Math.min(1, Math.max(0, SAMPLE_RATIO))),
  });

  sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'enterprise-tool-service',
      [SEMRESATTRS_SERVICE_VERSION]: '1.0.0',
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    sampler,
    spanProcessor: new BatchSpanProcessor(exporter, {
      maxQueueSize: 2048,
      scheduledDelayMillis: 5000,
    }),
    instrumentations: [
      new HttpInstrumentation({
        // Drop health-check spans to reduce noise
        ignoreIncomingRequestHook: (req) =>
          req.url === '/health' || req.url === '/metrics',
      }),
      new ExpressInstrumentation(),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk?.shutdown().catch(console.error);
  });
}

export { sdk };
