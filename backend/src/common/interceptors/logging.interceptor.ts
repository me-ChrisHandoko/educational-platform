import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { MetricsService } from '../services/metrics.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const { method, url, headers } = request;
    const startTime = Date.now();

    // Generate or extract request ID
    const requestId = (headers['x-request-id'] as string) || uuidv4();

    // Add request ID to headers for downstream services
    request.headers['x-request-id'] = requestId;

    const logContext = {
      requestId,
      method,
      url,
      userAgent: headers['user-agent'],
      ip: this.getClientIp(request),
    };

    this.logger.log(`→ ${method} ${url}`, logContext);

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        const response = context.switchToHttp().getResponse();
        const statusCode = response.statusCode || 200;

        // Record metrics
        this.metricsService.recordRequest(
          duration,
          statusCode,
          method,
          this.extractRoute(url),
        );

        this.logger.log(`← ${method} ${url} ${statusCode} [${duration}ms]`, {
          ...logContext,
          statusCode,
          duration,
          responseSize: this.getResponseSize(data),
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || 500;

        // Record error metrics
        this.metricsService.recordRequest(
          duration,
          statusCode,
          method,
          this.extractRoute(url),
        );

        this.logger.error(
          `✗ ${method} ${url} ${statusCode} [${duration}ms]`,
          error.stack,
          {
            ...logContext,
            duration,
            error: error.message,
            statusCode,
          },
        );

        return throwError(error);
      }),
    );
  }

  private getClientIp(request: FastifyRequest): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (request.headers['x-real-ip'] as string) ||
      request.ip ||
      'unknown'
    );
  }

  private getResponseSize(data: any): number {
    if (!data) return 0;

    try {
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }

  private extractRoute(url: string): string {
    // Extract route pattern by removing query parameters and normalizing paths
    const path = url.split('?')[0];

    // Replace UUIDs and numbers with placeholders for better grouping
    return (
      path
        .replace(
          /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
          '/:id',
        )
        .replace(/\/\d+/g, '/:id')
        .replace(/\/api\/v\d+/, '')
        .replace(/^\//, '') || 'root'
    );
  }
}
