import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';

const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';

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

  sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: 'mcp-wechat',
      [SEMRESATTRS_SERVICE_VERSION]: '1.0.0',
    }),
    spanProcessor: new BatchSpanProcessor(exporter),
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk?.shutdown().catch(console.error);
  });
}

export { sdk };
