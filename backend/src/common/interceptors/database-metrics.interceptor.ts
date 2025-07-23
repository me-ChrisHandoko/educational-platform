import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '../services/metrics.service';

@Injectable()
export class DatabaseMetricsInterceptor implements NestInterceptor {
  constructor(private metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const className = context.getClass().name;
    const handlerName = context.getHandler().name;

    // Only track database-related operations
    if (!this.isDatabaseOperation(className, handlerName)) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.recordMetrics(className, handlerName, duration, true);
        },
        error: () => {
          const duration = Date.now() - startTime;
          this.recordMetrics(className, handlerName, duration, false);
        },
      }),
    );
  }

  private isDatabaseOperation(className: string, handlerName: string): boolean {
    // Check if the class or handler name suggests database operations
    const dbKeywords = [
      'repository',
      'service',
      'find',
      'create',
      'update',
      'delete',
      'save',
      'query',
      'fetch',
      'get',
      'list',
    ];

    const lowerClassName = className.toLowerCase();
    const lowerHandlerName = handlerName.toLowerCase();

    return dbKeywords.some(
      (keyword) =>
        lowerClassName.includes(keyword) || lowerHandlerName.includes(keyword),
    );
  }

  private recordMetrics(
    className: string,
    handlerName: string,
    duration: number,
    success: boolean,
  ): void {
    const labels = {
      service: className,
      operation: handlerName,
      status: success ? 'success' : 'error',
    };

    this.metricsService.recordHistogram(
      'service_operation_duration',
      duration,
      labels,
    );

    if (!success) {
      this.metricsService.incrementCounter('service_operation_errors', labels);
    }
  }
}
