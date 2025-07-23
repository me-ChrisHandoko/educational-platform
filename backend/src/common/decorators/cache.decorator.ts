import { Inject } from '@nestjs/common';
import { CacheService } from '../services/cache.service';

export interface CacheOptions {
  ttl?: number;
  key?: string | ((args: any[]) => string);
  condition?: (result: any) => boolean;
}

export function Cacheable(options: CacheOptions = {}) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const methodName = `${target.constructor.name}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      // Get the cache service from the instance
      const cacheService = this.cacheService || this._cacheService;
      
      if (!cacheService) {
        // Fallback to original method if cache service is not available
        return originalMethod.apply(this, args);
      }

      // Generate cache key
      let cacheKey: string;
      if (typeof options.key === 'function') {
        cacheKey = options.key(args);
      } else if (options.key) {
        cacheKey = options.key;
      } else {
        cacheKey = `${methodName}:${JSON.stringify(args)}`;
      }

      // Try to get from cache
      const cached = await cacheService.get(cacheKey);
      if (cached !== null) {
        return cached;
      }

      // Execute the original method
      const result = await originalMethod.apply(this, args);

      // Check condition if provided
      if (options.condition && !options.condition(result)) {
        return result;
      }

      // Store in cache
      await cacheService.set(cacheKey, result, options.ttl);

      return result;
    };

    return descriptor;
  };
}

export function CacheEvict(options: { key: string | ((args: any[]) => string) }) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      // Get the cache service from the instance
      const cacheService = this.cacheService || this._cacheService;
      
      if (!cacheService) {
        // Fallback to original method if cache service is not available
        return originalMethod.apply(this, args);
      }

      // Execute the original method first
      const result = await originalMethod.apply(this, args);

      // Generate cache key to evict
      let cacheKey: string;
      if (typeof options.key === 'function') {
        cacheKey = options.key(args);
      } else {
        cacheKey = options.key;
      }

      // Evict from cache
      await cacheService.delete(cacheKey);

      return result;
    };

    return descriptor;
  };
}

export function CachePut(options: CacheOptions = {}) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const methodName = `${target.constructor.name}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      // Get the cache service from the instance
      const cacheService = this.cacheService || this._cacheService;
      
      if (!cacheService) {
        // Fallback to original method if cache service is not available
        return originalMethod.apply(this, args);
      }

      // Execute the original method
      const result = await originalMethod.apply(this, args);

      // Generate cache key
      let cacheKey: string;
      if (typeof options.key === 'function') {
        cacheKey = options.key(args);
      } else if (options.key) {
        cacheKey = options.key;
      } else {
        cacheKey = `${methodName}:${JSON.stringify(args)}`;
      }

      // Check condition if provided
      if (options.condition && !options.condition(result)) {
        return result;
      }

      // Store in cache
      await cacheService.set(cacheKey, result, options.ttl);

      return result;
    };

    return descriptor;
  };
}

// Helper decorator to inject CacheService
export function InjectCache() {
  return Inject(CacheService);
}
