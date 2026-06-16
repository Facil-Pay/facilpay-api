import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  halfOpenRequests?: number;
}

interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  halfOpenSuccesses: number;
  lastFailureAt: number | null;
  openedAt: number | null;
}

const DEFAULT_OPTS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60_000,
  halfOpenRequests: 1,
};

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits = new Map<string, CircuitStats>();

  private getOrCreate(name: string): CircuitStats {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, {
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        halfOpenSuccesses: 0,
        lastFailureAt: null,
        openedAt: null,
      });
    }
    return this.circuits.get(name)!;
  }

  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    opts: CircuitBreakerOptions = {},
  ): Promise<T> {
    const o = { ...DEFAULT_OPTS, ...opts };
    const circuit = this.getOrCreate(name);

    if (circuit.state === CircuitState.OPEN) {
      const elapsed = Date.now() - (circuit.openedAt ?? 0);
      if (elapsed >= o.timeout) {
        circuit.state = CircuitState.HALF_OPEN;
        circuit.halfOpenSuccesses = 0;
        this.logger.log(`Circuit '${name}' transitioned to HALF_OPEN`);
      } else {
        throw new ServiceUnavailableException(
          `Circuit '${name}' is OPEN — service unavailable`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess(name, circuit, o);
      return result;
    } catch (err) {
      this.onFailure(name, circuit, o);
      throw err;
    }
  }

  private onSuccess(
    name: string,
    circuit: CircuitStats,
    o: Required<CircuitBreakerOptions>,
  ) {
    circuit.failures = 0;
    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.halfOpenSuccesses += 1;
      if (circuit.halfOpenSuccesses >= o.successThreshold) {
        circuit.state = CircuitState.CLOSED;
        circuit.openedAt = null;
        this.logger.log(`Circuit '${name}' closed after recovery`);
      }
    } else {
      circuit.successes += 1;
    }
  }

  private onFailure(
    name: string,
    circuit: CircuitStats,
    o: Required<CircuitBreakerOptions>,
  ) {
    circuit.failures += 1;
    circuit.lastFailureAt = Date.now();

    if (
      circuit.state === CircuitState.HALF_OPEN ||
      circuit.failures >= o.failureThreshold
    ) {
      circuit.state = CircuitState.OPEN;
      circuit.openedAt = Date.now();
      this.logger.warn(
        `Circuit '${name}' opened after ${circuit.failures} failures`,
      );
    }
  }

  getState(name: string): CircuitStats | undefined {
    return this.circuits.get(name);
  }

  reset(name: string): void {
    this.circuits.delete(name);
    this.logger.log(`Circuit '${name}' manually reset`);
  }

  getAllStates(): Record<string, CircuitStats> {
    const result: Record<string, CircuitStats> = {};
    this.circuits.forEach((v, k) => (result[k] = v));
    return result;
  }
}
