import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../common/services/metrics.service';
import { RedisService } from '../redis/redis.service';

export interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: ServiceHealth;
    redis: ServiceHealth;
    memory: ServiceHealth;
    disk?: ServiceHealth;
  };
  details?: Record<string, any>;
}

export interface ServiceHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime?: number;
  message?: string;
  details?: Record<string, any>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();

  constructor(
    private prismaService: PrismaService,
    private metricsService: MetricsService,
    private redisService: RedisService,
  ) {}

  async getHealthStatus(): Promise<HealthCheck> {
    const timestamp = new Date().toISOString();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    const checks = await this.performHealthChecks();
    const overallStatus = this.determineOverallStatus(checks);

    return {
      status: overallStatus,
      timestamp,
      version: process.env.npm_package_version || '1.0.0',
      uptime,
      checks,
      details:
        process.env.NODE_ENV === 'development'
          ? {
              nodeVersion: process.version,
              platform: process.platform,
              environment: process.env.NODE_ENV,
            }
          : undefined,
    };
  }

  async getReadinessStatus(): Promise<{
    ready: boolean;
    checks: Record<string, ServiceHealth>;
  }> {
    const checks = await this.performHealthChecks();
    const ready = Object.values(checks).every(
      (check) => check.status === 'healthy',
    );

    return { ready, checks };
  }

  async getLivenessStatus(): Promise<{ alive: boolean }> {
    // Simple liveness check - if we can respond, we're alive
    return { alive: true };
  }

  private async performHealthChecks(): Promise<HealthCheck['checks']> {
    const [database, redis, memory] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMemory(),
    ]);

    return {
      database:
        database.status === 'fulfilled'
          ? database.value
          : {
              status: 'unhealthy',
              message: database.reason?.message || 'Database check failed',
            },
      redis:
        redis.status === 'fulfilled'
          ? redis.value
          : {
              status: 'unhealthy',
              message: redis.reason?.message || 'Redis check failed',
            },
      memory:
        memory.status === 'fulfilled'
          ? memory.value
          : {
              status: 'unhealthy',
              message: memory.reason?.message || 'Memory check failed',
            },
    };
  }

  private async checkDatabase(): Promise<ServiceHealth> {
    try {
      const startTime = Date.now();

      // Simple database ping
      await this.prismaService.$queryRaw`SELECT 1`;

      const responseTime = Date.now() - startTime;

      if (responseTime > 5000) {
        return {
          status: 'degraded',
          responseTime,
          message: 'Database responding slowly',
        };
      }

      return {
        status: 'healthy',
        responseTime,
        message: 'Database connection successful',
      };
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return {
        status: 'unhealthy',
        message: 'Database connection failed',
        details:
          process.env.NODE_ENV === 'development'
            ? {
                error: error.message,
              }
            : undefined,
      };
    }
  }

  private async checkRedis(): Promise<ServiceHealth> {
    try {
      const healthResult = await this.redisService.healthCheck();

      if (healthResult.status === 'healthy') {
        return {
          status: 'healthy',
          responseTime: healthResult.latency,
          message: 'Redis connection successful',
          details:
            process.env.NODE_ENV === 'development'
              ? {
                  latency: `${healthResult.latency}ms`,
                }
              : undefined,
        };
      } else {
        return {
          status: 'unhealthy',
          message: 'Redis health check failed',
        };
      }
    } catch (error) {
      this.logger.error('Redis health check failed', error);
      return {
        status: 'unhealthy',
        message: 'Redis connection failed',
        details:
          process.env.NODE_ENV === 'development'
            ? {
                error: error.message,
              }
            : undefined,
      };
    }
  }

  private checkMemory(): ServiceHealth {
    const usage = process.memoryUsage();
    const totalMemoryMB = usage.heapTotal / 1024 / 1024;
    const usedMemoryMB = usage.heapUsed / 1024 / 1024;
    const memoryUsagePercent = (usedMemoryMB / totalMemoryMB) * 100;

    const details = {
      heapUsed: `${usedMemoryMB.toFixed(2)} MB`,
      heapTotal: `${totalMemoryMB.toFixed(2)} MB`,
      usagePercent: `${memoryUsagePercent.toFixed(2)}%`,
    };

    if (memoryUsagePercent > 90) {
      return {
        status: 'unhealthy',
        message: 'Memory usage critically high',
        details,
      };
    }

    if (memoryUsagePercent > 80) {
      return {
        status: 'degraded',
        message: 'Memory usage high',
        details,
      };
    }

    return {
      status: 'healthy',
      message: 'Memory usage normal',
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    };
  }

  private determineOverallStatus(
    checks: HealthCheck['checks'],
  ): HealthCheck['status'] {
    const statuses = Object.values(checks).map((check) => check.status);

    if (statuses.includes('unhealthy')) {
      return 'unhealthy';
    }

    if (statuses.includes('degraded')) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Get detailed health information including metrics
   */
  async getDetailedHealth(): Promise<any> {
    const basicHealth = await this.getHealthStatus();
    const performance = this.metricsService.getPerformanceMetrics();
    const requestStats = this.metricsService.getRequestStats();

    return {
      ...basicHealth,
      performance: {
        requests: requestStats,
        metrics: performance,
        uptime: this.metricsService.getUptime(),
      },
      system: {
        memory: process.memoryUsage(),
        process: {
          pid: process.pid,
          version: process.version,
          platform: process.platform,
          arch: process.arch,
        },
        loadAverage:
          process.platform !== 'win32'
            ? (process as any).loadavg?.()
            : undefined,
      },
    };
  }

  /**
   * Alias for getHealthStatus for backwards compatibility
   */
  async checkHealth(): Promise<HealthCheck> {
    return this.getHealthStatus();
  }
}
