import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  resetTimeout: number;
  monitoringPeriod: number;
  name: string;
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public readonly state: CircuitState) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits = new Map<string, CircuitBreaker>();

  constructor(private eventEmitter: EventEmitter2) {}

  getCircuit(options: CircuitBreakerOptions): CircuitBreaker {
    if (!this.circuits.has(options.name)) {
      const circuit = new CircuitBreaker(options, this.eventEmitter);
      this.circuits.set(options.name, circuit);
    }
    return this.circuits.get(options.name)!;
  }

  getCircuitState(name: string): CircuitState | null {
    const circuit = this.circuits.get(name);
    return circuit ? circuit.getState() : null;
  }

  getCircuitStats(name: string): CircuitStats | null {
    const circuit = this.circuits.get(name);
    return circuit ? circuit.getStats() : null;
  }

  resetCircuit(name: string): void {
    const circuit = this.circuits.get(name);
    if (circuit) {
      circuit.reset();
      this.logger.log(`Circuit ${name} has been reset`);
    }
  }

  getAllCircuits(): Map<string, CircuitStats> {
    const stats = new Map<string, CircuitStats>();
    this.circuits.forEach((circuit, name) => {
      stats.set(name, circuit.getStats());
    });
    return stats;
  }
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  totalRequests: number;
  failureRate: number;
  nextAttempt: Date | null;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private nextAttempt: Date | null = null;
  private totalRequests = 0;
  private requestTimestamps: Date[] = [];

  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.nextAttempt && new Date() < this.nextAttempt) {
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.options.name}`,
          this.state,
        );
      }
      this.transitionToHalfOpen();
    }

    this.totalRequests++;
    this.cleanupOldRequests();

    try {
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout after ${this.options.timeout}ms`)),
          this.options.timeout,
        ),
      ),
    ]);
  }

  private onSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = new Date();
    this.requestTimestamps.push(new Date());

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.options.successThreshold) {
        this.transitionToClosed();
      }
    }

    this.emitEvent('circuit.success', {
      circuit: this.options.name,
      state: this.state,
    });
  }

  private onFailure(): void {
    this.failures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = new Date();
    this.requestTimestamps.push(new Date());

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionToOpen();
    } else if (this.state === CircuitState.CLOSED) {
      const failureRate = this.calculateFailureRate();
      if (
        this.consecutiveFailures >= this.options.failureThreshold ||
        failureRate > 0.5
      ) {
        this.transitionToOpen();
      }
    }

    this.emitEvent('circuit.failure', {
      circuit: this.options.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
    });
  }

  private transitionToOpen(): void {
    this.state = CircuitState.OPEN;
    this.nextAttempt = new Date(Date.now() + this.options.resetTimeout);
    
    this.emitEvent('circuit.open', {
      circuit: this.options.name,
      nextAttempt: this.nextAttempt,
    });
  }

  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    
    this.emitEvent('circuit.half-open', {
      circuit: this.options.name,
    });
  }

  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.nextAttempt = null;
    
    this.emitEvent('circuit.closed', {
      circuit: this.options.name,
    });
  }

  private calculateFailureRate(): number {
    if (this.requestTimestamps.length === 0) return 0;

    const recentRequests = this.requestTimestamps.filter(
      (timestamp) =>
        timestamp.getTime() > Date.now() - this.options.monitoringPeriod,
    );

    if (recentRequests.length === 0) return 0;

    const recentFailures = this.failures;
    return recentFailures / recentRequests.length;
  }

  private cleanupOldRequests(): void {
    const cutoff = Date.now() - this.options.monitoringPeriod;
    this.requestTimestamps = this.requestTimestamps.filter(
      (timestamp) => timestamp.getTime() > cutoff,
    );
  }

  private emitEvent(event: string, data: any): void {
    this.eventEmitter.emit(event, data);
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      failureRate: this.calculateFailureRate(),
      nextAttempt: this.nextAttempt,
    };
  }

  reset(): void {
    this.transitionToClosed();
  }
}
