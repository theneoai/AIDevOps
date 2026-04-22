/** Shared circuit breaker for Feishu MCP server — identical logic to mcp-wechat. */

import { createLogger } from '../../mcp-template/src/logger';

const logger = createLogger('circuit-breaker');

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  callTimeoutMs?: number;
}

export class CircuitBreaker {
  private state: State = 'CLOSED';
  private failures = 0;
  private lastFailureAt = 0;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly callTimeoutMs: number;

  constructor(name: string, opts: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.callTimeoutMs = opts.callTimeoutMs ?? 5_000;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Circuit breaker timeout (${this.callTimeoutMs}ms)`)), this.callTimeoutMs),
    );
    try {
      const result = await Promise.race([fn(), timeout]);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  get currentState(): State { return this.state; }

  private checkState(): void {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureAt;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`Circuit breaker OPEN for '${this.name}'`);
      }
    }
  }

  private onSuccess(): void {
    if (this.state !== 'CLOSED') logger.info('Circuit breaker closed', { name: this.name });
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(reason: string): void {
    this.failures += 1;
    this.lastFailureAt = Date.now();
    if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.error('Circuit breaker opened', { name: this.name, failures: this.failures, reason });
    }
  }
}
