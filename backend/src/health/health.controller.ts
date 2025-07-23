import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { HealthService, HealthCheck } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth(@Res() reply: FastifyReply): Promise<void> {
    const health = await this.healthService.getHealthStatus();

    const statusCode = this.getHttpStatusFromHealth(health.status);
    reply.status(statusCode).send(health);
  }

  @Get('ready')
  async getReadiness(@Res() reply: FastifyReply): Promise<void> {
    const readiness = await this.healthService.getReadinessStatus();

    const statusCode = readiness.ready
      ? HttpStatus.OK
      : HttpStatus.SERVICE_UNAVAILABLE;
    reply.status(statusCode).send(readiness);
  }

  @Get('live')
  async getLiveness(@Res() reply: FastifyReply): Promise<void> {
    const liveness = await this.healthService.getLivenessStatus();

    const statusCode = liveness.alive
      ? HttpStatus.OK
      : HttpStatus.SERVICE_UNAVAILABLE;
    reply.status(statusCode).send(liveness);
  }

  @Get('metrics')
  async getMetrics(): Promise<Record<string, any>> {
    const health = await this.healthService.getHealthStatus();
    const memUsage = process.memoryUsage();

    return {
      uptime: health.uptime,
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
      },
      process: {
        pid: process.pid,
        version: process.version,
        platform: process.platform,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private getHttpStatusFromHealth(status: HealthCheck['status']): number {
    switch (status) {
      case 'healthy':
        return HttpStatus.OK;
      case 'degraded':
        return HttpStatus.OK; // Still operational
      case 'unhealthy':
        return HttpStatus.SERVICE_UNAVAILABLE;
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }
}
