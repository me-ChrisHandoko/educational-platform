import { Injectable, Logger } from '@nestjs/common';
import { SecurityConfigService } from '../../common/services/security-config.service';
import { RedisService } from '../../redis/redis.service';
import { AccountLockoutService } from './account-lockout.service';

export interface SecurityDecision {
  allowed: boolean;
  action: 'allow' | 'delay' | 'lockout' | 'rate-limit' | 'block';
  layer: string;
  delay?: number;
  message?: string;
  metadata?: {
    currentAttempts: number;
    thresholds: any;
    nextAction?: string;
  };
}

export interface AuthAttemptContext {
  email?: string;
  ip: string;
  userAgent: string;
  route: string;
  method: string;
  timestamp: Date;
  failureReason?: string;
}

@Injectable()
export class CoordinatedAuthService {
  private readonly logger = new Logger(CoordinatedAuthService.name);

  constructor(
    private securityConfig: SecurityConfigService,
    private redisService: RedisService,
    private accountLockoutService: AccountLockoutService,
  ) {}

  /**
   * Main coordination point for authentication security checks
   */
  async evaluateSecurityDecision(
    context: AuthAttemptContext,
  ): Promise<SecurityDecision> {
    const thresholds = this.securityConfig.getCoordinatedThresholds();

    // If not in coordinated mode, use legacy behavior
    if (!thresholds.coordinatedMode) {
      return this.legacySecurityCheck(context);
    }

    try {
      // Get current attempt counts from all security layers
      const attemptData = await this.aggregateAttemptData(context);

      // Get security action from coordinated policy
      const securityAction = this.securityConfig.getSecurityLayerAction(
        attemptData.totalAttempts,
        {
          email: context.email || 'anonymous',
          ip: context.ip,
          withinWindow: attemptData.withinWindow,
        },
      );

      // Apply progressive delay if needed
      const delay = securityAction.delay || 0;

      const decision: SecurityDecision = {
        allowed:
          securityAction.action === 'allow' ||
          securityAction.action === 'delay',
        action: securityAction.action,
        layer: securityAction.layer,
        delay,
        message: securityAction.message,
        metadata: {
          currentAttempts: attemptData.totalAttempts,
          thresholds,
          nextAction: this.predictNextAction(attemptData.totalAttempts + 1),
        },
      };

      // Log security decision for monitoring
      this.logSecurityDecision(context, decision, attemptData);

      return decision;
    } catch (error) {
      this.logger.error('Error in security evaluation, failing open:', error);

      // Fail open with basic logging
      return {
        allowed: true,
        action: 'allow',
        layer: 'error-fallback',
        message: 'Security check failed, allowing request',
      };
    }
  }

  /**
   * Record a failed authentication attempt across all security layers
   */
  async recordFailedAttempt(context: AuthAttemptContext): Promise<void> {
    const coordination = this.securityConfig.getCoordinationPolicy();

    try {
      const promises: Promise<any>[] = [];

      // Record in account lockout system (if email available)
      if (
        context.email &&
        coordination.layerPriority.includes('account-lockout')
      ) {
        promises.push(
          this.accountLockoutService.recordFailedAttempt(
            context.email,
            context.ip,
            context.userAgent,
            context.failureReason,
          ),
        );
      }

      // Record in rate limiting system
      if (coordination.layerPriority.includes('rate-limit')) {
        const rateLimitKey = this.generateRateLimitKey(context);
        const rateLimitConfig = this.securityConfig.getRateLimitPolicy().login;
        promises.push(
          this.redisService.incrementRateLimit(
            rateLimitKey,
            rateLimitConfig.windowMs,
            rateLimitConfig.maxAttempts,
          ),
        );
      }

      // Record in security monitoring
      promises.push(this.recordSecurityEvent(context, 'failed_attempt'));

      await Promise.allSettled(promises);
    } catch (error) {
      this.logger.error('Error recording failed attempt:', error);
    }
  }

  /**
   * Record a successful authentication attempt
   */
  async recordSuccessfulAttempt(context: AuthAttemptContext): Promise<void> {
    try {
      const promises: Promise<any>[] = [];

      // Clear account lockout (if email available)
      if (context.email) {
        promises.push(
          this.accountLockoutService.recordSuccessfulAttempt(
            context.email,
            context.ip,
            context.userAgent,
          ),
        );
      }

      // Record success in monitoring
      promises.push(this.recordSecurityEvent(context, 'successful_attempt'));

      await Promise.allSettled(promises);
    } catch (error) {
      this.logger.error('Error recording successful attempt:', error);
    }
  }

  /**
   * Check if an account/IP is currently under any security restrictions
   */
  async checkSecurityStatus(
    context: Pick<AuthAttemptContext, 'email' | 'ip'>,
  ): Promise<{
    isRestricted: boolean;
    restrictions: string[];
    canRetryAt?: Date;
  }> {
    const restrictions: string[] = [];
    let earliestRetryTime: Date | undefined;

    try {
      // Check account lockout
      if (context.email) {
        const lockoutResult =
          await this.accountLockoutService.checkAccountLockout(context.email);
        if (lockoutResult.isLocked) {
          restrictions.push('account-locked');
          if (lockoutResult.canRetryAt) {
            earliestRetryTime = lockoutResult.canRetryAt;
          }
        }
      }

      // Check rate limiting
      const rateLimitKey = `rate_limit:ip:${context.ip}:auth:login`;
      const rateLimitData = await this.redisService.getRateLimit(rateLimitKey);
      if (
        rateLimitData &&
        rateLimitData.count >=
          this.securityConfig.getRateLimitPolicy().login.maxAttempts
      ) {
        restrictions.push('rate-limited');
        const resetTime = new Date(rateLimitData.resetTime);
        if (!earliestRetryTime || resetTime < earliestRetryTime) {
          earliestRetryTime = resetTime;
        }
      }

      return {
        isRestricted: restrictions.length > 0,
        restrictions,
        canRetryAt: earliestRetryTime,
      };
    } catch (error) {
      this.logger.error('Error checking security status:', error);
      return { isRestricted: false, restrictions: [] };
    }
  }

  private async aggregateAttemptData(context: AuthAttemptContext): Promise<{
    totalAttempts: number;
    accountAttempts: number;
    rateLimitAttempts: number;
    withinWindow: boolean;
  }> {
    let accountAttempts = 0;
    let rateLimitAttempts = 0;
    let withinWindow = true;

    // Get account-specific attempts
    if (context.email) {
      try {
        const lockoutResult =
          await this.accountLockoutService.checkAccountLockout(context.email);
        const accountPolicy = this.securityConfig.getAccountPolicy();
        accountAttempts = lockoutResult.remainingAttempts
          ? accountPolicy.maxLoginAttempts - lockoutResult.remainingAttempts
          : 0;
      } catch (error) {
        this.logger.warn('Error getting account attempts:', error);
      }
    }

    // Get rate limit attempts
    try {
      const rateLimitKey = this.generateRateLimitKey(context);
      const rateLimitData = await this.redisService.getRateLimit(rateLimitKey);
      if (rateLimitData) {
        rateLimitAttempts = rateLimitData.count;
        withinWindow = Date.now() < rateLimitData.resetTime;
      }
    } catch (error) {
      this.logger.warn('Error getting rate limit attempts:', error);
    }

    // Use the higher count for coordinated decision making
    const totalAttempts = Math.max(accountAttempts, rateLimitAttempts);

    return {
      totalAttempts,
      accountAttempts,
      rateLimitAttempts,
      withinWindow,
    };
  }

  private generateRateLimitKey(context: AuthAttemptContext): string {
    // Create a composite key for rate limiting
    const baseKey = `rate_limit:ip:${context.ip}`;
    const routeKey = `${context.route}`;
    return `${baseKey}:${routeKey}`;
  }

  private predictNextAction(nextAttemptCount: number): string {
    const securityAction = this.securityConfig.getSecurityLayerAction(
      nextAttemptCount,
      { email: 'test', ip: '127.0.0.1', withinWindow: true },
    );
    return securityAction.action;
  }

  private async recordSecurityEvent(
    context: AuthAttemptContext,
    eventType: 'failed_attempt' | 'successful_attempt',
  ): Promise<void> {
    const monitoring = this.securityConfig.getMonitoringPolicy();

    if (!monitoring.enabled) {
      return;
    }

    const eventKey = `security_event:${eventType}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    const eventData = {
      type: eventType,
      email: context.email || 'anonymous',
      ip: context.ip,
      userAgent: context.userAgent,
      route: context.route,
      method: context.method,
      timestamp: context.timestamp.toISOString(),
    };

    try {
      await this.redisService.set(eventKey, eventData, 3600); // 1 hour TTL
    } catch (error) {
      this.logger.warn('Failed to record security event:', error);
    }
  }

  private logSecurityDecision(
    context: AuthAttemptContext,
    decision: SecurityDecision,
    attemptData: any,
  ): void {
    const logLevel = decision.allowed ? 'log' : 'warn';
    const message = `Security Decision: ${decision.action} (${decision.layer})`;

    this.logger[logLevel](message, {
      email: context.email || 'anonymous',
      ip: context.ip,
      route: context.route,
      attempts: attemptData.totalAttempts,
      decision: decision.action,
      layer: decision.layer,
      delay: decision.delay,
      message: decision.message,
    });
  }

  private async legacySecurityCheck(
    context: AuthAttemptContext,
  ): Promise<SecurityDecision> {
    // Fallback to individual security checks when coordination is disabled
    this.logger.warn('Using legacy security mode - coordination disabled');

    return {
      allowed: true,
      action: 'allow',
      layer: 'legacy',
      message: 'Legacy security mode - individual guards will handle security',
    };
  }
}
