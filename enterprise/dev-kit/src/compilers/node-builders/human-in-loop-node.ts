import { HITLStepConfig } from '../../types/dsl';

export interface DifyHITLNode {
  id: string;
  type: 'human-input';
  data: {
    title: string;
    instruction: string;
    timeout: number;
    on_timeout: 'approve' | 'reject' | 'error';
    notification: {
      channel: string;
      target?: string;
      webhook_url?: string;
    };
  };
  position: { x: number; y: number };
}

export function buildHITLNode(
  id: string,
  name: string,
  config: HITLStepConfig,
  position: { x: number; y: number },
): DifyHITLNode {
  return {
    id,
    type: 'human-input',
    data: {
      title: name,
      instruction: config.message,
      timeout: config.timeoutSeconds ?? 86400,
      on_timeout: config.onTimeout ?? 'reject',
      notification: {
        channel: config.channel,
        target:
          config.channel === 'slack'
            ? config.slackChannel
            : config.channel === 'email'
            ? config.emailRecipients?.join(',')
            : undefined,
        webhook_url: config.webhookUrl,
      },
    },
    position,
  };
}
