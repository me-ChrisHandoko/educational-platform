import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CacheService } from '../services/cache.service';
import {
  CACHE_KEY,
  CacheDecoratorOptions,
  CacheKeyGenerator,
} from '../decorators/cache.decorator';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInterceptor.name);

  constructor(
    private cacheService: CacheService,
    private reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    // Get cache options from decorator
    const cacheOptions = this.reflector.get<CacheDecoratorOptions>(
      CACHE_KEY,
      context.getHandler(),
    );

    // If no cache decorator, proceed without caching
    if (!cacheOptions) {
      return this.handleCacheEviction(context, next);
    }

    const className = context.getClass().name;
    const methodName = context.getHandler().name;
    const args = context.getArgs().slice(2); // Remove request and response from args

    // Check caching condition
    if (!CacheKeyGenerator.shouldCache(args, cacheOptions)) {
      this.logger.debug(
        `Cache condition not met for ${className}.${methodName}`,
      );
      return next.handle();
    }

    // Generate cache key
    const cacheKey = CacheKeyGenerator.generateKey(
      className,
      methodName,
      args,
      cacheOptions,
    );

    try {
      // Try to get from cache first
      const cachedResult = await this.cacheService.get(cacheKey);

      if (cachedResult !== null) {
        this.logger.debug(`Cache hit for ${className}.${methodName}`, {
          key: cacheKey,
        });
        return of(cachedResult);
      }

      this.logger.debug(`Cache miss for ${className}.${methodName}`, {
        key: cacheKey,
      });

      // Execute the method and cache the result
      return next.handle().pipe(
        tap(async (result) => {
          try {
            await this.cacheService.set(cacheKey, result, {
              ttl: cacheOptions.ttl,
              tags: cacheOptions.tags,
              compress: cacheOptions.compress,
            });

            this.logger.debug(`Cached result for ${className}.${methodName}`, {
              key: cacheKey,
              ttl: cacheOptions.ttl,
              tags: cacheOptions.tags,
            });
          } catch (error) {
            this.logger.error(
              `Failed to cache result for ${className}.${methodName}`,
              error.message,
            );
          }
        }),
      );
    } catch (error) {
      this.logger.error(
        `Cache error for ${className}.${methodName}`,
        error.message,
      );
      // If cache fails, continue with normal execution
      return next.handle();
    }
  }

  /**
   * Handle cache eviction decorators
   */
  private handleCacheEviction(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    const evictTags = this.reflector.get<string[]>(
      'cache_evict',
      context.getHandler(),
    );
    const clearPattern = this.reflector.get<
      string | ((...args: any[]) => string[])
    >('cache_clear', context.getHandler());

    if (!evictTags && !clearPattern) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async () => {
        try {
          // Handle cache eviction by tags
          if (evictTags && evictTags.length > 0) {
            const evictedCount =
              await this.cacheService.deleteByTags(evictTags);
            this.logger.debug(
              `Evicted ${evictedCount} cache entries by tags: ${evictTags.join(', ')}`,
            );
          }

          // Handle cache clearing by pattern
          if (clearPattern) {
            const args = context.getArgs().slice(2);
            let keysToDelete: string[] = [];

            if (typeof clearPattern === 'string') {
              // For string patterns, we'd need a pattern matching implementation
              // This is a simplified version
              keysToDelete = this.findKeysByPattern(clearPattern);
            } else if (typeof clearPattern === 'function') {
              keysToDelete = clearPattern(...args);
            }

            for (const key of keysToDelete) {
              await this.cacheService.delete(key);
            }

            this.logger.debug(`Cleared ${keysToDelete.length} cache entries`);
          }
        } catch (error) {
          this.logger.error('Cache eviction error', error.message);
        }
      }),
    );
  }

  /**
   * Find cache keys by pattern (simplified implementation)
   */
  private findKeysByPattern(pattern: string): string[] {
    const allKeys = this.cacheService.getKeys();

    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return allKeys.filter((key) => key.startsWith(prefix));
    }

    if (pattern.startsWith('*')) {
      const suffix = pattern.slice(1);
      return allKeys.filter((key) => key.endsWith(suffix));
    }

    // Exact match
    return allKeys.filter((key) => key === pattern);
  }
}
