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
import { SecurityConfigService } from '../services/security-config.service';
import { AccountLockoutService } from '../../auth/services/account-lockout.service';

export interface SecurityEvent {
  type: 'warning' | 'critical' | 'lockout' | 'rate-limit' | 'block';
  email?: string;
  ip: string;
  userAgent: string;
  attemptCount: number;
  layer: string;
  timestamp: Date;
  action: string;
  metadata?: Record<string, any>;
}

export interface CoordinatedSecurityConfig {
  enabled: boolean;
  skipIf?: (context: ExecutionContext) => boolean;
  customKey?: (context: ExecutionContext) => string;
  enableMonitoring?: boolean;
}

@Injectable()
export class CoordinatedSecurityGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private redisService: RedisService,
    private securityConfig: SecurityConfigService,
    private accountLockoutService: AccountLockoutService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if security should be skipped
    const skipSecurity = this.reflector.getAllAndOverride<boolean>(
      'skipSecurity',
      [context.getHandler(), context.getClass()],
    );

    if (skipSecurity) {
      return true;
    }

    const securityConfig = this.getSecurityConfig(context);
    if (!securityConfig?.enabled) {
      return true; // Security not configured
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const securityContext = this.buildSecurityContext(request, context);

    try {
      // Get current attempt count from multiple sources
      const attemptData = await this.getAttemptData(securityContext);

      // Determine security action based on coordinated policy
      const securityAction = this.securityConfig.getSecurityLayerAction(
        attemptData.count,
        {
          email: securityContext.email || 'anonymous',
          ip: securityContext.ip,
          withinWindow: attemptData.withinWindow,
        },
      );

      // Log security event
      await this.logSecurityEvent({
        type: this.mapActionToEventType(securityAction.action),
        email: securityContext.email,
        ip: securityContext.ip,
        userAgent: securityContext.userAgent,
        attemptCount: attemptData.count,
        layer: securityAction.layer,
        timestamp: new Date(),
        action: securityAction.action,
        metadata: {
          route: securityContext.route,
          method: request.method,
          threshold: this.securityConfig.getCoordinatedThresholds(),
        },
      });

      // Handle security action
      switch (securityAction.action) {
        case 'allow':
          return true;

        case 'delay':
          if (securityAction.delay && securityAction.delay > 0) {
            await this.applyProgressiveDelay(securityAction.delay);
          }
          return true;

        case 'lockout':
          throw new HttpException(
            {
              statusCode: HttpStatus.FORBIDDEN,
              message: 'Account is locked due to too many failed attempts',
              error: 'Account Locked',
              layer: 'account-lockout',
              retryAfter:
                this.securityConfig.getAccountPolicy().lockoutDuration * 60,
              details: securityAction.message,
            },
            HttpStatus.FORBIDDEN,
          );

        case 'rate-limit':
          throw new HttpException(
            {
              statusCode: HttpStatus.TOO_MANY_REQUESTS,
              message: 'Rate limit exceeded',
              error: 'Too Many Requests',
              layer: 'rate-limit',
              retryAfter:
                this.securityConfig.getRateLimitPolicy().login.blockDuration *
                60,
              details: securityAction.message,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );

        case 'block':
          throw new HttpException(
            {
              statusCode: HttpStatus.FORBIDDEN,
              message: 'Access blocked due to suspicious activity',
              error: 'Blocked',
              layer: 'ip-blocking',
              details: securityAction.message,
            },
            HttpStatus.FORBIDDEN,
          );

        default:
          return true;
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      // Log error and fail open for system resilience
      console.error('Coordinated security guard error:', error);
      return true;
    }
  }

  private getSecurityConfig(
    context: ExecutionContext,
  ): CoordinatedSecurityConfig | null {
    // Check for method-level security config
    const methodConfig = this.reflector.get<CoordinatedSecurityConfig>(
      'coordinatedSecurity',
      context.getHandler(),
    );
    if (methodConfig) return methodConfig;

    // Check for class-level security config
    const classConfig = this.reflector.get<CoordinatedSecurityConfig>(
      'coordinatedSecurity',
      context.getClass(),
    );
    if (classConfig) return classConfig;

    // Default to enabled if no config found
    return { enabled: true, enableMonitoring: true };
  }

  private buildSecurityContext(
    request: FastifyRequest,
    context: ExecutionContext,
  ) {
    const ip = this.getClientIp(request);
    const userAgent = request.headers['user-agent'] || 'unknown';
    const route = this.getRoutePattern(context);

    // Extract email from request body if it's a login attempt
    let email: string | undefined;
    const body = (request as any).body;
    if (body && typeof body === 'object' && body.email) {
      email = body.email;
    }

    return {
      ip,
      userAgent,
      route,
      email,
      method: request.method,
    };
  }

  private async getAttemptData(context: {
    email?: string;
    ip: string;
    route: string;
  }): Promise<{ count: number; withinWindow: boolean }> {
    const coordination = this.securityConfig.getCoordinationPolicy();
    const accountPolicy = this.securityConfig.getAccountPolicy();
    const rateLimitPolicy = this.securityConfig.getRateLimitPolicy().login;

    let maxCount = 0;
    let withinWindow = true;

    // Check account-specific failed attempts (if email available)
    if (
      context.email &&
      coordination.layerPriority.includes('account-lockout')
    ) {
      try {
        const lockoutResult =
          await this.accountLockoutService.checkAccountLockout(context.email);
        if (lockoutResult.isLocked) {
          return { count: accountPolicy.maxLoginAttempts, withinWindow: true };
        }

        // Count recent failed attempts for this email
        const windowStart = new Date(
          Date.now() - accountPolicy.lockoutDuration * 60 * 1000,
        );
        // Note: This would require updating AccountLockoutService to expose attempt counting
        // For now, we'll use a simplified approach
        maxCount = Math.max(
          maxCount,
          lockoutResult.remainingAttempts
            ? accountPolicy.maxLoginAttempts - lockoutResult.remainingAttempts
            : 0,
        );
      } catch (error) {
        console.warn('Error checking account lockout:', error);
      }
    }

    // Check rate limiting data (IP-based)
    if (coordination.layerPriority.includes('rate-limit')) {
      try {
        const rateLimitKey = `throttle:ip:${context.ip}:${context.route}`;
        const rateLimitData =
          await this.redisService.getRateLimit(rateLimitKey);
        if (rateLimitData) {
          const rateLimitCount = rateLimitData.count;
          maxCount = Math.max(maxCount, rateLimitCount);

          // Check if within rate limit window
          const now = Date.now();
          withinWindow = withinWindow && now < rateLimitData.resetTime;
        }
      } catch (error) {
        console.warn('Error checking rate limit:', error);
      }
    }

    return { count: maxCount, withinWindow };
  }

  private async logSecurityEvent(event: SecurityEvent): Promise<void> {
    const monitoring = this.securityConfig.getMonitoringPolicy();

    if (!monitoring.enabled) {
      return;
    }

    try {
      // Store security event in Redis for monitoring
      const eventKey = `security_event:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
      await this.redisService.set(eventKey, event, 3600); // 1 hour TTL

      // Log to console for development
      if (monitoring.securityEventLogging) {
        console.log(`🔒 Security Event [${event.type.toUpperCase()}]:`, {
          layer: event.layer,
          action: event.action,
          email: event.email || 'anonymous',
          ip: event.ip,
          attempts: event.attemptCount,
          timestamp: event.timestamp.toISOString(),
          details: event.metadata,
        });
      }

      // Check for alert thresholds
      if (monitoring.realTimeAlerting) {
        await this.checkAlertThresholds(event);
      }
    } catch (error) {
      console.error('Failed to log security event:', error);
    }
  }

  private async checkAlertThresholds(event: SecurityEvent): Promise<void> {
    const thresholds = this.securityConfig.getMonitoringPolicy().thresholds;

    // Check for suspicious activity patterns
    // This is a simplified implementation - in production, you'd want more sophisticated analysis
    if (
      event.type === 'critical' &&
      event.attemptCount >= thresholds.suspiciousActivityPerMinute
    ) {
      console.warn(
        `🚨 SECURITY ALERT: Suspicious activity detected from ${event.ip} - ${event.attemptCount} attempts`,
      );
    }

    if (event.type === 'lockout') {
      console.warn(
        `🔒 SECURITY ALERT: Account lockout triggered for ${event.email || 'anonymous'} from ${event.ip}`,
      );
    }
  }

  private async applyProgressiveDelay(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private mapActionToEventType(action: string): SecurityEvent['type'] {
    switch (action) {
      case 'lockout':
        return 'lockout';
      case 'rate-limit':
        return 'rate-limit';
      case 'block':
        return 'block';
      case 'delay':
        return 'critical';
      case 'allow':
        return 'warning';
      default:
        return 'warning';
    }
  }

  private getClientIp(request: FastifyRequest): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (request.headers['x-real-ip'] as string) ||
      (request.headers['cf-connecting-ip'] as string) ||
      request.ip ||
      'unknown'
    );
  }

  private getRoutePattern(context: ExecutionContext): string {
    const handler = context.getHandler();
    const controller = context.getClass();

    const controllerName = controller.name
      .replace('Controller', '')
      .toLowerCase();
    const methodName = handler.name;

    return `${controllerName}:${methodName}`;
  }
}

// Decorator for coordinated security configuration
export const CoordinatedSecurity = (
  options: CoordinatedSecurityConfig = { enabled: true },
) => {
  return (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ) => {
    Reflect.defineMetadata(
      'coordinatedSecurity',
      options,
      descriptor ? descriptor.value : target,
    );
  };
};

// Skip security decorator
export const SkipSecurity = () => {
  return (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ) => {
    Reflect.defineMetadata(
      'skipSecurity',
      true,
      descriptor ? descriptor.value : target,
    );
  };
};
