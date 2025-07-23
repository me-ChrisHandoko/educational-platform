import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { RedisService } from '../../redis/redis.service';

export interface ThrottleConfig {
  ttl: number; // Time window in milliseconds
  limit: number; // Max requests per window
  skipIf?: (context: ExecutionContext) => boolean;
  generateKey?: (context: ExecutionContext) => string;
}

@Injectable()
export class RedisThrottleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if throttling should be skipped
    const skipThrottle = this.reflector.getAllAndOverride<boolean>(
      'skipThrottle',
      [context.getHandler(), context.getClass()],
    );

    if (skipThrottle) {
      return true;
    }

    const throttleConfig = this.getThrottleConfig(context);
    if (!throttleConfig) {
      return true; // No throttling configured
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const key = this.generateThrottleKey(request, context);

    try {
      const result = await this.redisService.incrementRateLimit(
        key,
        throttleConfig.ttl,
        throttleConfig.limit,
      );

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Rate limit exceeded',
            error: 'Too Many Requests',
            retryAfter,
            limit: throttleConfig.limit,
            remaining: Math.max(0, throttleConfig.limit - result.count),
            resetTime: new Date(result.resetTime).toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
          {
            cause: 'Rate limit exceeded',
          },
        );
      }

      // Add rate limit headers to response
      const response = context.switchToHttp().getResponse();
      if (response && typeof response.header === 'function') {
        response.header('X-RateLimit-Limit', throttleConfig.limit.toString());
        response.header(
          'X-RateLimit-Remaining',
          Math.max(0, throttleConfig.limit - result.count).toString(),
        );
        response.header('X-RateLimit-Reset', result.resetTime.toString());
      }

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      // If Redis fails, log error and allow request (fail open)
      console.error('Redis throttle error:', error);
      return true;
    }
  }

  private getThrottleConfig(context: ExecutionContext): ThrottleConfig | null {
    // Check for method-level throttle config
    const methodConfig = this.reflector.get<ThrottleConfig>(
      'throttle',
      context.getHandler(),
    );
    if (methodConfig) return methodConfig;

    // Check for class-level throttle config
    const classConfig = this.reflector.get<ThrottleConfig>(
      'throttle',
      context.getClass(),
    );
    if (classConfig) return classConfig;

    // Check for Throttle decorator with multiple named throttles
    const namedThrottles = this.reflector.get<
      Record<string, { limit: number; ttl: number }>
    >('throttle-options', context.getHandler());

    if (namedThrottles) {
      // Use the most restrictive throttle
      let mostRestrictive: ThrottleConfig | null = null;

      for (const [name, config] of Object.entries(namedThrottles)) {
        const throttleConfig: ThrottleConfig = {
          ttl: config.ttl,
          limit: config.limit,
        };

        if (
          !mostRestrictive ||
          config.limit / (config.ttl / 1000) <
            mostRestrictive.limit / (mostRestrictive.ttl / 1000)
        ) {
          mostRestrictive = throttleConfig;
        }
      }

      return mostRestrictive;
    }

    // Default throttle config from environment
    const ttl = parseInt(process.env.RATE_LIMIT_TTL || '60') * 1000; // Convert to ms
    const limit = parseInt(process.env.RATE_LIMIT_LIMIT || '100');

    return { ttl, limit };
  }

  private generateThrottleKey(
    request: FastifyRequest,
    context: ExecutionContext,
  ): string {
    // Get client IP
    const ip = this.getClientIp(request);

    // Get user ID if available (for authenticated requests)
    const user = (request as any).user;
    const userId = user?.userId || user?.sub || 'anonymous';

    // Get route pattern
    const route = this.getRoutePattern(context);

    // Get user agent hash for additional uniqueness
    const userAgent = request.headers['user-agent'] || '';
    const uaHash = this.simpleHash(userAgent).substring(0, 8);

    // Create composite key
    if (userId !== 'anonymous') {
      // For authenticated users, use user ID as primary key
      return `throttle:user:${userId}:${route}`;
    } else {
      // For anonymous users, use IP + user agent
      return `throttle:ip:${ip}:${uaHash}:${route}`;
    }
  }

  private getClientIp(request: FastifyRequest): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (request.headers['x-real-ip'] as string) ||
      (request.headers['cf-connecting-ip'] as string) || // Cloudflare
      request.ip ||
      'unknown'
    );
  }

  private getRoutePattern(context: ExecutionContext): string {
    const handler = context.getHandler();
    const controller = context.getClass();

    // Create a pattern based on controller and method name
    const controllerName = controller.name
      .replace('Controller', '')
      .toLowerCase();
    const methodName = handler.name;

    return `${controllerName}:${methodName}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

// Enhanced Throttle decorator that supports Redis-based throttling
export const RedisThrottle = (options: {
  limit: number;
  ttl: number;
  skipIf?: (context: ExecutionContext) => boolean;
}) => {
  return (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ) => {
    const throttleConfig: ThrottleConfig = {
      ttl: options.ttl,
      limit: options.limit,
      skipIf: options.skipIf,
    };

    Reflect.defineMetadata(
      'throttle',
      throttleConfig,
      descriptor ? descriptor.value : target,
    );
  };
};

// Skip throttle decorator
export const SkipThrottle = () => {
  return (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ) => {
    Reflect.defineMetadata(
      'skipThrottle',
      true,
      descriptor ? descriptor.value : target,
    );
  };
};
