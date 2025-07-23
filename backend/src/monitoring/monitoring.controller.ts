import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { MetricsService } from '../common/services/metrics.service';
import { HealthService } from '../health/health.service';
import {
  AuditService,
  AuditAction,
  AuditLevel,
} from '../common/services/audit.service';
import { Context } from '../common/decorators/request-context.decorator';
import { RequestContext } from '../common/middleware/request-context.middleware';

@Controller('monitoring')
export class MonitoringController {
  constructor(
    private metricsService: MetricsService,
    private healthService: HealthService,
    private auditService: AuditService,
    private configService: ConfigService,
  ) {}

  @Get('metrics')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Header('Content-Type', 'text/plain')
  async getMetrics(@Context() context: RequestContext): Promise<string> {
    await this.auditService.logFromContext(
      context,
      AuditAction.SYSTEM_CONFIG_CHANGE,
      AuditLevel.INFO,
      true,
      {
        resourceType: 'metrics',
        resourceId: 'system_metrics',
        details: { action: 'metrics_access' },
      },
    );

    return this.metricsService.getPrometheusMetrics();
  }

  @Get('metrics/performance')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getPerformanceMetrics(@Context() context: RequestContext) {
    await this.auditService.logFromContext(
      context,
      AuditAction.SYSTEM_CONFIG_CHANGE,
      AuditLevel.INFO,
      true,
      {
        resourceType: 'performance',
        resourceId: 'system_performance',
        details: { action: 'performance_metrics_access' },
      },
    );

    return {
      success: true,
      data: {
        performance: this.metricsService.getPerformanceMetrics(),
        requests: this.metricsService.getRequestStats(),
        uptime: this.metricsService.getUptime(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  @Get('health/detailed')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getDetailedHealth(@Context() context: RequestContext) {
    await this.auditService.logFromContext(
      context,
      AuditAction.SYSTEM_CONFIG_CHANGE,
      AuditLevel.INFO,
      true,
      {
        resourceType: 'health',
        resourceId: 'system_health',
        details: { action: 'detailed_health_check' },
      },
    );

    const healthData = await this.healthService.getDetailedHealth();

    return {
      success: true,
      data: healthData,
    };
  }

  @Get('status')
  @Public()
  async getSystemStatus() {
    const health = await this.healthService.checkHealth();
    const uptime = this.metricsService.getUptime();
    const requestStats = this.metricsService.getRequestStats();

    return {
      success: true,
      data: {
        status: health.status,
        uptime: uptime,
        version: this.configService.get('app.version'),
        environment: this.configService.get('app.environment'),
        timestamp: new Date().toISOString(),
        requests: {
          total: requestStats.totalRequests,
          errorRate: Math.round(requestStats.errorRate * 100) / 100,
        },
        services: {
          database: health.checks.database.status,
          memory: health.checks.memory.status,
        },
      },
    };
  }

  @Get('info')
  @Public()
  async getApplicationInfo() {
    return {
      success: true,
      data: {
        name: this.configService.get('app.name'),
        version: this.configService.get('app.version'),
        environment: this.configService.get('app.environment'),
        apiPrefix: this.configService.get('app.apiPrefix'),
        features: {
          cors: this.configService.get('security.cors.enabled'),
          metrics: this.configService.get('features.metrics'),
          swagger: this.configService.get('features.swagger'),
          healthCheck: this.configService.get('features.healthCheck'),
        },
        uptime: this.metricsService.getUptime(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  @Get('debug')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.SUPER_ADMIN)
  async getDebugInfo(@Context() context: RequestContext) {
    // Only allow in development
    const environment = this.configService.get('app.environment');
    if (environment === 'production') {
      await this.auditService.logFromContext(
        context,
        AuditAction.UNAUTHORIZED_ACCESS,
        AuditLevel.WARN,
        false,
        {
          resourceType: 'debug',
          resourceId: 'system_debug',
          details: { reason: 'debug_access_denied_in_production' },
        },
      );

      return {
        success: false,
        error: 'Debug information not available in production',
      };
    }

    await this.auditService.logFromContext(
      context,
      AuditAction.SYSTEM_CONFIG_CHANGE,
      AuditLevel.WARN,
      true,
      {
        resourceType: 'debug',
        resourceId: 'system_debug',
        details: { action: 'debug_info_access' },
      },
    );

    const performance = this.metricsService.getPerformanceMetrics();
    const health = await this.healthService.getDetailedHealth();

    return {
      success: true,
      data: {
        performance,
        health,
        memory: process.memoryUsage(),
        process: {
          pid: process.pid,
          version: process.version,
          platform: process.platform,
          arch: process.arch,
          uptime: process.uptime(),
        },
        environment: {
          nodeEnv: process.env.NODE_ENV,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        metrics: {
          availableMetrics: this.metricsService.getMetricNames(),
          requestStats: this.metricsService.getRequestStats(),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }
}
