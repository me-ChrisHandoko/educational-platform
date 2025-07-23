import { Injectable, NestMiddleware, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { AuditTrailService } from '../services/audit-trail.service';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  onLimitReached?: (req: Request, key: string) => Promise<void>;
}

export interface RateLimitInfo {
  totalRequests: number;
  remainingRequests: number;
  resetTime: number;
  isLimited: boolean;
}

@Injectable()
export class EnterpriseRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(EnterpriseRateLimitMiddleware.name);
  
  // Different rate limits for different operations
  private readonly rateLimitConfigs: Record<string, RateLimitConfig> = {
    // Login attempts - very strict
    'login': {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 5,
      keyGenerator: (req) => `login:${this.getClientIP(req)}`,
      onLimitReached: async (req, key) => {
        await this.handleLoginRateLimit(req, key);
      }
    },
    
    // Password reset attempts
    'password-reset': {
      windowMs: 60 * 60 * 1000, // 1 hour
      maxRequests: 3,
      keyGenerator: (req) => `reset:${this.getClientIP(req)}:${req.body?.email || 'unknown'}`
    },

    // General API requests per user
    'api-user': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100,
      keyGenerator: (req) => `api:user:${(req as any).user?.userId || this.getClientIP(req)}`
    },

    // Admin operations - more restrictive
    'admin': {
      windowMs: 60 * 1000, // 1 minute  
      maxRequests: 30,
      keyGenerator: (req) => `admin:${(req as any).user?.userId || this.getClientIP(req)}`
    },

    // Security-sensitive operations
    'security': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 10,
      keyGenerator: (req) => `security:${(req as any).user?.userId || this.getClientIP(req)}`
    },

    // Global IP-based rate limiting
    'global-ip': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 200,
      keyGenerator: (req) => `global:${this.getClientIP(req)}`
    }
  };

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
    private auditTrailService: AuditTrailService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      // Determine which rate limiting rules to apply
      const applicableConfigs = this.getApplicableConfigs(req);
      
      // Apply each rate limit
      for (const [configName, config] of applicableConfigs) {
        const rateLimitInfo = await this.checkRateLimit(req, config, configName);
        
        // Add rate limit headers
        this.addRateLimitHeaders(res, rateLimitInfo, configName);
        
        // If any rate limit is exceeded, reject the request
        if (rateLimitInfo.isLimited) {
          await this.logRateLimitViolation(req, configName, rateLimitInfo);
          
          throw new HttpException({
            message: 'Too many requests',
            retryAfter: Math.ceil((rateLimitInfo.resetTime - Date.now()) / 1000),
            rateLimitType: configName
          }, HttpStatus.TOO_MANY_REQUESTS);
        }
      }
      
      next();
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        throw error;
      }
      
      this.logger.error('Rate limit middleware error:', error);
      next(); // Continue on error to avoid breaking the application
    }
  }

  /**
   * Check rate limit for a specific configuration
   */
  private async checkRateLimit(
    req: Request,
    config: RateLimitConfig,
    configName: string
  ): Promise<RateLimitInfo> {
    const key = config.keyGenerator ? config.keyGenerator(req) : this.getDefaultKey(req, configName);
    const now = Date.now();
    const windowStart = now - config.windowMs;
    
    // Use Redis sorted set to track requests in the time window
    const redisKey = `rate_limit:${key}`;
    
    // Use existing rate limiting methods
    const rateLimitResult = await this.redisService.incrementRateLimit(
      key,
      config.windowMs,
      config.maxRequests
    );
    
    const totalRequests = rateLimitResult.count;
    const remainingRequests = Math.max(0, config.maxRequests - totalRequests);
    const resetTime = rateLimitResult.resetTime;
    const isLimited = !rateLimitResult.allowed;
    
    // Call onLimitReached if defined and limit exceeded
    if (isLimited && config.onLimitReached) {
      await config.onLimitReached(req, key);
    }
    
    return {
      totalRequests,
      remainingRequests,
      resetTime,
      isLimited
    };
  }

  /**
   * Determine which rate limit configurations apply to the request
   */
  private getApplicableConfigs(req: Request): [string, RateLimitConfig][] {
    const configs: [string, RateLimitConfig][] = [];
    
    // Always apply global IP rate limit
    configs.push(['global-ip', this.rateLimitConfigs['global-ip']]);
    
    // Apply specific rate limits based on path and method
    if (this.isLoginRequest(req)) {
      configs.push(['login', this.rateLimitConfigs['login']]);
    }
    
    if (this.isPasswordResetRequest(req)) {
      configs.push(['password-reset', this.rateLimitConfigs['password-reset']]);
    }
    
    if (this.isAdminRequest(req)) {
      configs.push(['admin', this.rateLimitConfigs['admin']]);
    }
    
    if (this.isSecurityRequest(req)) {
      configs.push(['security', this.rateLimitConfigs['security']]);
    }
    
    // Apply general API rate limit for authenticated users
    if ((req as any).user) {
      configs.push(['api-user', this.rateLimitConfigs['api-user']]);
    }
    
    return configs;
  }

  /**
   * Add rate limit headers to response
   */
  private addRateLimitHeaders(res: Response, info: RateLimitInfo, configName: string): void {
    res.setHeader(`X-RateLimit-Limit-${configName}`, info.totalRequests + info.remainingRequests);
    res.setHeader(`X-RateLimit-Remaining-${configName}`, info.remainingRequests);
    res.setHeader(`X-RateLimit-Reset-${configName}`, Math.ceil(info.resetTime / 1000));
  }

  /**
   * Log rate limit violation for security monitoring
   */
  private async logRateLimitViolation(
    req: Request,
    configName: string,
    info: RateLimitInfo
  ): Promise<void> {
    const ipAddress = this.getClientIP(req);
    const userId = (req as any).user?.userId;
    
    try {
      await this.auditTrailService.logSecurityEvent({
        userId,
        action: 'SUSPICIOUS_ACTIVITY',
        description: `Rate limit exceeded for ${configName}`,
        ipAddress,
        userAgent: req.headers['user-agent'],
        severity: 'WARNING',
        metadata: {
          rateLimitType: configName,
          totalRequests: info.totalRequests,
          maxRequests: info.totalRequests + info.remainingRequests,
          path: req.path,
          method: req.method
        }
      });

      // Create security alert for repeated violations
      if (info.totalRequests > (info.totalRequests + info.remainingRequests) * 2) {
        await this.auditTrailService.createSecurityAlert({
          userId: userId || 'anonymous',
          alertType: 'SUSPICIOUS_ACTIVITY',
          severity: 'HIGH',
          title: 'Repeated Rate Limit Violations',
          description: `IP ${ipAddress} has exceeded rate limits multiple times`,
          metadata: {
            ipAddress,
            rateLimitType: configName,
            violationCount: info.totalRequests
          }
        });
      }
    } catch (error) {
      this.logger.error('Failed to log rate limit violation:', error);
    }
  }

  /**
   * Handle login-specific rate limit violations
   */
  private async handleLoginRateLimit(req: Request, key: string): Promise<void> {
    const ipAddress = this.getClientIP(req);
    
    // Temporarily block the IP for more severe violations
    const blockKey = `blocked_ip:${ipAddress}`;
    const blockDuration = 30 * 60; // 30 minutes
    
    await this.redisService.set(blockKey, 'login_rate_limit', blockDuration);
    
    await this.auditTrailService.createSecurityAlert({
      userId: 'system',
      alertType: 'SUSPICIOUS_ACTIVITY',
      severity: 'CRITICAL',
      title: 'Potential Brute Force Attack',
      description: `IP ${ipAddress} has exceeded login rate limits and has been temporarily blocked`,
      metadata: {
        ipAddress,
        blockDuration: blockDuration,
        rateLimitKey: key
      }
    });
  }

  /**
   * Helper methods to identify request types
   */
  private isLoginRequest(req: Request): boolean {
    return req.path.includes('/login') && req.method === 'POST';
  }

  private isPasswordResetRequest(req: Request): boolean {
    return (req.path.includes('/password/reset') || req.path.includes('/forgot-password')) 
           && req.method === 'POST';
  }

  private isAdminRequest(req: Request): boolean {
    return req.path.startsWith('/admin') || req.path.includes('/admin/');
  }

  private isSecurityRequest(req: Request): boolean {
    return req.path.includes('/security') || 
           req.path.includes('/audit') ||
           req.path.includes('/sessions') ||
           req.path.includes('/permissions');
  }

  private getClientIP(req: Request): string {
    return (
      req.headers['x-forwarded-for'] as string ||
      req.headers['x-real-ip'] as string ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      'unknown'
    );
  }

  private getDefaultKey(req: Request, configName: string): string {
    const userId = (req as any).user?.userId;
    const ipAddress = this.getClientIP(req);
    return userId ? `${configName}:user:${userId}` : `${configName}:ip:${ipAddress}`;
  }
}