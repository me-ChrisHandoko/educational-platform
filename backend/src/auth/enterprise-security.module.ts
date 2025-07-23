import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

// Services
import { EnterpriseSessionService } from './services/enterprise-session.service';
import { AuditTrailService } from './services/audit-trail.service';
import { SecurityMonitoringService } from './services/security-monitoring.service';
import { RiskAssessmentService } from './services/risk-assessment.service';
import { AdminGovernanceService } from './services/admin-governance.service';

// Guards
import { EnterpriseSecurityGuard } from './guards/enterprise-security.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

// Middleware
import { EnterpriseSecurityMiddleware } from './middleware/enterprise-security.middleware';
import { EnterpriseRateLimitMiddleware } from './middleware/enterprise-rate-limit.middleware';

// Controllers
import { EnterpriseAuthController } from './controllers/enterprise-auth.controller';
import { AdminGovernanceController } from './controllers/admin-governance.controller';

// Other modules
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_ACCESS_TOKEN_EXPIRY', '15m'),
          issuer: 'educational-platform',
          audience: 'educational-platform-users'
        },
        verifyOptions: {
          issuer: 'educational-platform',
          audience: 'educational-platform-users'
        }
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [
        {
          name: 'short',
          ttl: 1000, // 1 second
          limit: 10, // 10 requests per second
        },
        {
          name: 'medium', 
          ttl: 10000, // 10 seconds
          limit: 50, // 50 requests per 10 seconds
        },
        {
          name: 'long',
          ttl: 60000, // 1 minute
          limit: 100, // 100 requests per minute
        },
      ],
      inject: [ConfigService],
    }),
  ],
  providers: [
    // Services
    EnterpriseSessionService,
    AuditTrailService,
    SecurityMonitoringService, 
    RiskAssessmentService,
    AdminGovernanceService,

    // Global guards
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard, // Basic throttling - first line of defense
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard, // JWT validation
    },
    {
      provide: APP_GUARD,
      useClass: EnterpriseSecurityGuard, // Enterprise security policies
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard, // Role-based access control
    },

    // Middleware
    EnterpriseSecurityMiddleware,
    EnterpriseRateLimitMiddleware,
  ],
  controllers: [
    EnterpriseAuthController,
    AdminGovernanceController,
  ],
  exports: [
    EnterpriseSessionService,
    AuditTrailService,
    SecurityMonitoringService,
    RiskAssessmentService,
    AdminGovernanceService,
    JwtModule,
  ],
})
export class EnterpriseSecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply rate limiting middleware first
    consumer
      .apply(EnterpriseRateLimitMiddleware)
      .forRoutes(
        // Apply to all authentication endpoints
        { path: 'auth/*', method: RequestMethod.ALL },
        // Apply to admin endpoints
        { path: 'admin/*', method: RequestMethod.ALL },
        // Apply to security-sensitive endpoints
        { path: 'users/*', method: RequestMethod.ALL },
        { path: 'security/*', method: RequestMethod.ALL },
        { path: 'audit/*', method: RequestMethod.ALL }
      );

    // Apply comprehensive security middleware to all API routes
    consumer
      .apply(EnterpriseSecurityMiddleware)
      .exclude(
        // Exclude health checks and public endpoints
        'health',
        'metrics',
        'favicon.ico',
        '/',
        // Exclude some auth endpoints to avoid double processing
        'auth/login',
        'auth/register'
      )
      .forRoutes('*'); // Apply to all other routes
  }
}

/**
 * Security Configuration Factory
 * Provides different security configurations for different environments
 */
export class SecurityConfigFactory {
  static createConfig(environment: string) {
    const baseConfig = {
      // JWT Configuration
      jwt: {
        accessTokenExpiryMinutes: 15,
        refreshTokenExpiryDays: 7,
        issuer: 'educational-platform',
        audience: 'educational-platform-users'
      },

      // Session Configuration
      session: {
        timeoutMinutes: 30,
        maxConcurrentSessions: 5,
        cleanupIntervalMinutes: 10
      },

      // Rate Limiting Configuration
      rateLimit: {
        windowMs: 60000, // 1 minute
        maxRequests: 100,
        skipSuccessfulRequests: false
      },

      // Security Policies
      security: {
        maxRiskScore: 80,
        requireTrustedDeviceForAdmin: true,
        businessHoursOnlyForAdmin: true,
        mfaRequiredForSuperAdmin: true
      },

      // Monitoring Configuration
      monitoring: {
        alertThresholds: {
          highRiskSessions: 10,
          failedLoginsPerHour: 50,
          suspiciousIpCount: 5
        },
        reportingIntervalMinutes: 60
      }
    };

    // Environment-specific overrides
    switch (environment) {
      case 'development':
        return {
          ...baseConfig,
          security: {
            ...baseConfig.security,
            maxRiskScore: 90, // More lenient in dev
            businessHoursOnlyForAdmin: false,
            requireTrustedDeviceForAdmin: false
          },
          rateLimit: {
            ...baseConfig.rateLimit,
            maxRequests: 1000 // Higher limits in dev
          }
        };

      case 'production':
        return {
          ...baseConfig,
          security: {
            ...baseConfig.security,
            maxRiskScore: 70, // Stricter in production
            businessHoursOnlyForAdmin: true,
            requireTrustedDeviceForAdmin: true,
            mfaRequiredForSuperAdmin: true
          },
          session: {
            ...baseConfig.session,
            timeoutMinutes: 15, // Shorter sessions in production
            maxConcurrentSessions: 3
          }
        };

      case 'testing':
        return {
          ...baseConfig,
          security: {
            ...baseConfig.security,
            maxRiskScore: 95,
            businessHoursOnlyForAdmin: false,
            requireTrustedDeviceForAdmin: false,
            mfaRequiredForSuperAdmin: false
          },
          rateLimit: {
            ...baseConfig.rateLimit,
            maxRequests: 10000 // Very high limits for testing
          }
        };

      default:
        return baseConfig;
    }
  }
}

/**
 * Security Metrics Collector
 * Collects and reports security metrics
 */
export class SecurityMetricsCollector {
  constructor(
    private securityMonitoringService: SecurityMonitoringService,
    private auditTrailService: AuditTrailService
  ) {}

  async collectMetrics() {
    const [
      securityMetrics,
      systemHealth,
      threatData
    ] = await Promise.all([
      this.securityMonitoringService.getSecurityMetrics('hour'),
      this.securityMonitoringService.getSystemHealth(),
      this.securityMonitoringService.detectSecurityThreats()
    ]);

    return {
      timestamp: new Date(),
      metrics: securityMetrics,
      health: systemHealth,
      threats: {
        active: threatData.filter(t => t.status === 'ACTIVE').length,
        critical: threatData.filter(t => t.severity === 'CRITICAL').length,
        total: threatData.length
      },
      summary: {
        overallHealth: systemHealth.status,
        riskLevel: this.calculateOverallRiskLevel(securityMetrics, systemHealth),
        actionRequired: this.determineActionRequired(securityMetrics, systemHealth, threatData)
      }
    };
  }

  private calculateOverallRiskLevel(metrics: any, health: any): string {
    if (health.healthScore < 60 || metrics.highRiskSessions > 10) return 'HIGH';
    if (health.healthScore < 80 || metrics.highRiskSessions > 5) return 'MEDIUM';
    return 'LOW';
  }

  private determineActionRequired(metrics: any, health: any, threats: any[]): boolean {
    return health.healthScore < 70 || 
           metrics.highRiskSessions > 10 || 
           threats.filter(t => t.severity === 'CRITICAL').length > 0;
  }
}