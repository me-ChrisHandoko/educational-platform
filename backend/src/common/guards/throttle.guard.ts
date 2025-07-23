import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';

export interface ThrottleConfig {
  ttl: number; // Time window in seconds
  limit: number; // Max requests per window
}

// In-memory storage for rate limiting (use Redis in production)
const requestCounts = new Map<string, { count: number; resetTime: number }>();

@Injectable()
export class ThrottleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const throttleConfig = this.getThrottleConfig(context);
    if (!throttleConfig) {
      return true; // No throttling configured
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const key = this.generateKey(request);
    const now = Date.now();
    const windowMs = throttleConfig.ttl * 1000;

    const record = requestCounts.get(key);

    if (!record || now > record.resetTime) {
      // New window or expired window
      requestCounts.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      return true;
    }

    if (record.count >= throttleConfig.limit) {
      // Rate limit exceeded
      return false;
    }

    // Increment counter
    record.count++;
    requestCounts.set(key, record);

    return true;
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

    // Default throttle config from environment
    const ttl = parseInt(process.env.RATE_LIMIT_TTL || '60');
    const limit = parseInt(process.env.RATE_LIMIT_LIMIT || '100');

    return { ttl, limit };
  }

  private generateKey(request: FastifyRequest): string {
    // Use IP address as the key (consider user ID for authenticated requests)
    const ip = this.getClientIp(request);
    const userAgent = request.headers['user-agent'] || '';

    // Include user agent hash to prevent abuse from same IP with different clients
    const uaHash = this.simpleHash(userAgent);

    return `throttle:${ip}:${uaHash}`;
  }

  private getClientIp(request: FastifyRequest): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (request.headers['x-real-ip'] as string) ||
      request.ip ||
      'unknown'
    );
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

// Decorator for setting throttle configuration
export const Throttle = (ttl: number, limit: number) => {
  return (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ) => {
    Reflect.defineMetadata(
      'throttle',
      { ttl, limit },
      descriptor ? descriptor.value : target,
    );
  };
};
