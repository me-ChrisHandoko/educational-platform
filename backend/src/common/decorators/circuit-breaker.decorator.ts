import { Inject } from '@nestjs/common';
import { CircuitBreakerService, CircuitBreakerOptions } from '../services/circuit-breaker.service';

export function CircuitBreaker(options: Partial<CircuitBreakerOptions> = {}) {
  const defaultOptions: CircuitBreakerOptions = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 3000,
    resetTimeout: 30000,
    monitoringPeriod: 60000,
    name: 'default',
    ...options,
  };

  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const methodName = `${target.constructor.name}.${propertyName}`;
    
    // Override the name if not provided
    if (!options.name) {
      defaultOptions.name = methodName;
    }

    descriptor.value = async function (...args: any[]) {
      // Get the circuit breaker service from the instance
      const circuitBreakerService = this.circuitBreakerService || this._circuitBreakerService;
      
      if (!circuitBreakerService) {
        // Fallback to original method if circuit breaker service is not available
        return originalMethod.apply(this, args);
      }

      const circuit = circuitBreakerService.getCircuit(defaultOptions);
      
      return circuit.execute(() => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

// Helper decorator to inject CircuitBreakerService
export function InjectCircuitBreaker() {
  return Inject(CircuitBreakerService);
}
