/**
 * Lightweight circuit breaker — no external dependency.
 *
 * States:
 *   CLOSED  — normal operation, calls pass through
 *   OPEN    — too many failures, calls rejected immediately
 *   HALF    — cooldown elapsed, one probe call allowed
 *
 * Configurable thresholds; metrics emitted to logger so Prometheus scraping
 * can pick them up via structured logs or a custom middleware.
 */

import { createLogger } from './logger';
import { config } from './config';

const logger = createLogger(config.LOG_LEVEL);

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Consecutive failures before opening. Default: 5 */
  failureThreshold?: number;
  /** Ms to wait in OPEN state before probing. Default: 30_000 */
  resetTimeoutMs?: number;
  /** Ms to wait for a single call. Default: 5_000 */
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

  get currentState(): State {
    return this.state;
  }

  private checkState(): void {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureAt;
      if (elapsed >= this.resetTimeoutMs) {
        logger.info('Circuit breaker probing', { name: this.name, elapsed });
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(
          `Circuit breaker OPEN for '${this.name}' — retry in ${Math.ceil((this.resetTimeoutMs - elapsed) / 1000)}s`,
        );
      }
    }
  }

  private onSuccess(): void {
    if (this.state !== 'CLOSED') {
      logger.info('Circuit breaker closed (recovered)', { name: this.name });
    }
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(reason: string): void {
    this.failures += 1;
    this.lastFailureAt = Date.now();

    if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.error('Circuit breaker opened', {
        name: this.name,
        failures: this.failures,
        reason,
      });
    }
  }
}
