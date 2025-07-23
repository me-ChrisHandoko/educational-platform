import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

export interface SecurityCoordination {
  layerPriority: (
    | 'account-lockout'
    | 'rate-limit'
    | 'brute-force'
    | 'ip-blocking'
  )[];
  coordinatedThresholds: {
    warningLevel: number; // % of max attempts before enhanced monitoring
    criticalLevel: number; // % of max attempts before progressive delays
    lockoutLevel: number; // % of max attempts before account lockout
    blockLevel: number; // % of max attempts before rate blocking
  };
  escalationRules: {
    enableProgressiveDelay: boolean;
    enableCrossLayerCommunication: boolean;
    enableSecurityEventChaining: boolean;
  };
}

export interface SecurityPolicy {
  password: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    maxAge: number; // days
    preventReuse: number; // number of previous passwords to prevent reuse
  };
  session: {
    accessTokenExpiry: string;
    refreshTokenExpiry: string;
    maxConcurrentSessions: number;
    idleTimeout: number; // minutes
  };
  rateLimit: {
    login: {
      windowMs: number;
      maxAttempts: number;
      blockDuration: number; // minutes
      // Enhanced coordination settings
      coordinatedMode: boolean;
      allowAccountLockoutFirst: boolean;
      progressiveDelayEnabled: boolean;
    };
    api: {
      windowMs: number;
      maxRequests: number;
    };
    passwordReset: {
      windowMs: number;
      maxAttempts: number;
    };
  };
  account: {
    maxLoginAttempts: number;
    lockoutDuration: number; // minutes
    enableMfa: boolean;
    enableEmailVerification: boolean;
    // Enhanced coordination settings
    coordinatedMode: boolean;
    triggerBeforeRateLimit: boolean;
    enableProgressiveBackoff: boolean;
  };
  data: {
    encryptionAtRest: boolean;
    encryptionInTransit: boolean;
    dataRetentionPeriod: number; // days
    enableAuditLog: boolean;
  };
  // New coordination layer
  coordination: SecurityCoordination;
  // New security monitoring
  monitoring: {
    enabled: boolean;
    realTimeAlerting: boolean;
    securityEventLogging: boolean;
    anomalyDetection: boolean;
    thresholds: {
      suspiciousActivityPerMinute: number;
      failedAttemptsPerHour: number;
      lockoutEventsPerHour: number;
      rateLimitHitsPerHour: number;
    };
  };
}

@Injectable()
export class SecurityConfigService {
  private readonly securityPolicy: SecurityPolicy;

  constructor(private configService: ConfigService<AppConfig>) {
    this.securityPolicy = this.loadSecurityPolicy();
  }

  private loadSecurityPolicy(): SecurityPolicy {
    const env = this.configService.get('app.environment', { infer: true });
    const isProduction = env === 'production';

    // Calculate coordinated thresholds for production safety
    const baseLoginAttempts = isProduction ? 8 : 15; // Higher base for coordination
    const accountLockoutThreshold = Math.floor(baseLoginAttempts * 0.6); // 60% of rate limit
    const rateLimitThreshold = baseLoginAttempts; // 100% triggers rate limit

    return {
      password: {
        minLength: isProduction ? 12 : 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: isProduction,
        maxAge: isProduction ? 90 : 365,
        preventReuse: isProduction ? 12 : 3,
      },
      session: {
        accessTokenExpiry:
          this.configService.get('jwt.accessExpiresIn', { infer: true }) ||
          '15m',
        refreshTokenExpiry:
          this.configService.get('jwt.refreshExpiresIn', { infer: true }) ||
          '7d',
        maxConcurrentSessions: isProduction ? 3 : 10,
        idleTimeout: isProduction ? 30 : 60,
      },
      rateLimit: {
        login: {
          windowMs: 15 * 60 * 1000, // 15 minutes
          maxAttempts: rateLimitThreshold,
          blockDuration: isProduction ? 30 : 15,
          // Enhanced coordination settings
          coordinatedMode: true,
          allowAccountLockoutFirst: true,
          progressiveDelayEnabled: isProduction,
        },
        api: {
          windowMs:
            (this.configService.get('security.rateLimit.ttl', {
              infer: true,
            }) || 60) * 1000,
          maxRequests:
            this.configService.get('security.rateLimit.limit', {
              infer: true,
            }) || 100,
        },
        passwordReset: {
          windowMs: 60 * 60 * 1000, // 1 hour
          maxAttempts: 3,
        },
      },
      account: {
        maxLoginAttempts: accountLockoutThreshold,
        lockoutDuration: isProduction ? 30 : 15,
        enableMfa: isProduction,
        enableEmailVerification: true,
        // Enhanced coordination settings
        coordinatedMode: true,
        triggerBeforeRateLimit: true,
        enableProgressiveBackoff: isProduction,
      },
      data: {
        encryptionAtRest: isProduction,
        encryptionInTransit: true,
        dataRetentionPeriod: isProduction ? 2555 : 365, // 7 years in production
        enableAuditLog: true,
      },
      // Security layer coordination
      coordination: {
        layerPriority: [
          'account-lockout',
          'brute-force',
          'rate-limit',
          'ip-blocking',
        ],
        coordinatedThresholds: {
          warningLevel: 40, // 40% of max attempts
          criticalLevel: 60, // 60% of max attempts
          lockoutLevel: 75, // 75% of max attempts (account lockout)
          blockLevel: 100, // 100% of max attempts (rate limit block)
        },
        escalationRules: {
          enableProgressiveDelay: isProduction,
          enableCrossLayerCommunication: true,
          enableSecurityEventChaining: true,
        },
      },
      // Security monitoring and alerting
      monitoring: {
        enabled: true,
        realTimeAlerting: isProduction,
        securityEventLogging: true,
        anomalyDetection: isProduction,
        thresholds: {
          suspiciousActivityPerMinute: isProduction ? 20 : 50,
          failedAttemptsPerHour: isProduction ? 100 : 200,
          lockoutEventsPerHour: isProduction ? 5 : 10,
          rateLimitHitsPerHour: isProduction ? 50 : 100,
        },
      },
    };
  }

  getSecurityPolicy(): SecurityPolicy {
    return this.securityPolicy;
  }

  getPasswordPolicy() {
    return this.securityPolicy.password;
  }

  getSessionPolicy() {
    return this.securityPolicy.session;
  }

  getRateLimitPolicy() {
    return this.securityPolicy.rateLimit;
  }

  getAccountPolicy() {
    return this.securityPolicy.account;
  }

  getDataPolicy() {
    return this.securityPolicy.data;
  }

  getCoordinationPolicy() {
    return this.securityPolicy.coordination;
  }

  getMonitoringPolicy() {
    return this.securityPolicy.monitoring;
  }

  /**
   * Get coordinated security thresholds based on current configuration
   */
  getCoordinatedThresholds() {
    const coordination = this.securityPolicy.coordination;
    const accountPolicy = this.securityPolicy.account;
    const rateLimitPolicy = this.securityPolicy.rateLimit.login;

    const baseThreshold = Math.max(
      accountPolicy.maxLoginAttempts,
      rateLimitPolicy.maxAttempts,
    );

    return {
      warningThreshold: Math.floor(
        baseThreshold * (coordination.coordinatedThresholds.warningLevel / 100),
      ),
      criticalThreshold: Math.floor(
        baseThreshold *
          (coordination.coordinatedThresholds.criticalLevel / 100),
      ),
      lockoutThreshold: accountPolicy.maxLoginAttempts,
      rateLimitThreshold: rateLimitPolicy.maxAttempts,
      isCoordinated:
        accountPolicy.maxLoginAttempts < rateLimitPolicy.maxAttempts,
      coordinatedMode:
        accountPolicy.coordinatedMode && rateLimitPolicy.coordinatedMode,
    };
  }

  /**
   * Calculate progressive delay based on attempt count
   */
  calculateProgressiveDelay(attemptCount: number): number {
    if (
      !this.securityPolicy.coordination.escalationRules.enableProgressiveDelay
    ) {
      return 0;
    }

    const thresholds = this.getCoordinatedThresholds();

    // No delay before warning threshold
    if (attemptCount < thresholds.warningThreshold) {
      return 0;
    }

    // Progressive delay: 1s, 2s, 4s, 8s, up to 30s
    const delayMultiplier = Math.min(
      attemptCount - thresholds.warningThreshold + 1,
      10,
    );
    return Math.min(Math.pow(2, delayMultiplier - 1) * 1000, 30000);
  }

  /**
   * Determine which security layer should handle the request
   */
  getSecurityLayerAction(
    attemptCount: number,
    context: {
      email: string;
      ip: string;
      withinWindow: boolean;
    },
  ): {
    action: 'allow' | 'delay' | 'lockout' | 'rate-limit' | 'block';
    layer: string;
    delay?: number;
    message?: string;
  } {
    const thresholds = this.getCoordinatedThresholds();
    const coordination = this.securityPolicy.coordination;

    // Check coordination mode
    if (!thresholds.coordinatedMode) {
      // Legacy mode - each layer works independently
      if (attemptCount >= thresholds.rateLimitThreshold) {
        return { action: 'rate-limit', layer: 'rate-limit' };
      }
      if (attemptCount >= thresholds.lockoutThreshold) {
        return { action: 'lockout', layer: 'account-lockout' };
      }
      return { action: 'allow', layer: 'none' };
    }

    // Coordinated mode - follow layer priority
    for (const layer of coordination.layerPriority) {
      switch (layer) {
        case 'account-lockout':
          if (attemptCount >= thresholds.lockoutThreshold) {
            return {
              action: 'lockout',
              layer: 'account-lockout',
              message: `Account locked after ${attemptCount} failed attempts`,
            };
          }
          break;

        case 'rate-limit':
          if (attemptCount >= thresholds.rateLimitThreshold) {
            return {
              action: 'rate-limit',
              layer: 'rate-limit',
              message: `Rate limit exceeded: ${attemptCount} attempts`,
            };
          }
          break;

        case 'brute-force':
          if (attemptCount >= thresholds.criticalThreshold) {
            const delay = this.calculateProgressiveDelay(attemptCount);
            if (delay > 0) {
              return {
                action: 'delay',
                layer: 'brute-force',
                delay,
                message: `Progressive delay: ${delay}ms`,
              };
            }
          }
          break;
      }
    }

    // Warning level - enhanced monitoring but allow
    if (attemptCount >= thresholds.warningThreshold) {
      return {
        action: 'allow',
        layer: 'monitoring',
        message: `Warning: ${attemptCount} failed attempts detected`,
      };
    }

    return { action: 'allow', layer: 'none' };
  }

  /**
   * Check if a feature is enabled based on security policy
   */
  isFeatureEnabled(feature: keyof SecurityPolicy['account']): boolean {
    return Boolean(this.securityPolicy.account[feature]);
  }

  /**
   * Get security headers configuration
   */
  getSecurityHeaders() {
    return {
      'Strict-Transport-Security':
        'max-age=31536000; includeSubDomains; preload',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': this.getContentSecurityPolicy(),
      'Permissions-Policy': this.getPermissionsPolicy(),
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
  }

  private getContentSecurityPolicy(): string {
    const env = this.configService.get('app.environment', { infer: true });
    const isDevelopment = env === 'development';

    const basePolicy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self'",
      "media-src 'self'",
      "object-src 'none'",
      "frame-src 'none'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ];

    if (isDevelopment) {
      // Allow localhost for development
      basePolicy.push("script-src 'self' 'unsafe-eval' localhost:*");
      basePolicy.push("connect-src 'self' localhost:* ws: wss:");
    }

    return basePolicy.join('; ');
  }

  private getPermissionsPolicy(): string {
    return [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', ');
  }

  /**
   * Get CORS configuration
   */
  getCorsConfig() {
    const corsEnabled = this.configService.get('security.cors.enabled', {
      infer: true,
    });
    const corsOrigins =
      this.configService.get('security.cors.origins', { infer: true }) || [];

    if (!corsEnabled) {
      return false;
    }

    return {
      origin: corsOrigins.length > 0 ? corsOrigins : true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'X-Request-ID',
      ],
      exposedHeaders: ['X-Request-ID', 'X-Rate-Limit-*'],
      credentials: true,
      maxAge: 86400, // 24 hours
    };
  }

  /**
   * Validate if an IP address should be blocked
   */
  shouldBlockIp(ip: string): boolean {
    // Add IP blocking logic here
    // This could check against a blacklist, geographic restrictions, etc.
    const blockedIps = process.env.BLOCKED_IPS?.split(',') || [];
    return blockedIps.includes(ip);
  }

  /**
   * Get encryption settings
   */
  getEncryptionSettings() {
    return {
      algorithm: 'aes-256-gcm',
      keyDerivation: 'pbkdf2',
      iterations: 100000,
      saltLength: 32,
      ivLength: 16,
      tagLength: 16,
    };
  }
}
