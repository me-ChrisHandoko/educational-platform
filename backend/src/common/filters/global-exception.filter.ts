import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { MetricsService } from '../services/metrics.service';
import { ConfigService } from '@nestjs/config';

export interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string | string[];
  error: string;
  code?: string;
  timestamp: string;
  path: string;
  requestId?: string;
  details?: Record<string, any>;
  retryAfter?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly isDevelopment: boolean;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
  ) {
    this.isDevelopment = this.configService.get('NODE_ENV') === 'development';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    const errorResponse = this.buildErrorResponse(exception, request);

    // Log error with context
    this.logError(exception, request, errorResponse);

    // Record metrics
    this.recordMetrics(errorResponse, request);

    // Set appropriate headers
    if (errorResponse.retryAfter) {
      reply.header('Retry-After', errorResponse.retryAfter);
    }

    reply.status(errorResponse.statusCode).send(errorResponse);
  }

  private buildErrorResponse(
    exception: unknown,
    request: FastifyRequest,
  ): ErrorResponse {
    const timestamp = new Date().toISOString();
    const path = request.url;
    const requestId = request.headers['x-request-id'] as string;

    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, path, timestamp, requestId);
    }

    if (exception instanceof PrismaClientKnownRequestError) {
      return this.handlePrismaError(exception, path, timestamp, requestId);
    }

    if (this.isValidationError(exception)) {
      return this.handleValidationError(exception as any, path, timestamp, requestId);
    }

    // Unknown error - don't expose details in production
    const error = exception as Error;
    return {
      success: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred',
      error: 'Internal Server Error',
      timestamp,
      path,
      requestId,
      details: this.isDevelopment
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : undefined,
    };
  }

  private handleHttpException(
    exception: HttpException,
    path: string,
    timestamp: string,
    requestId?: string,
  ): ErrorResponse {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return {
        success: false,
        statusCode: status,
        message: response,
        error: this.getErrorName(status),
        timestamp,
        path,
        requestId,
      };
    }

    const responseObj = response as any;
    return {
      success: false,
      statusCode: status,
      message: responseObj.message || exception.message,
      error: responseObj.error || this.getErrorName(status),
      code: responseObj.code,
      timestamp,
      path,
      requestId,
      details: responseObj.details,
      retryAfter: responseObj.retryAfter,
    };
  }

  private handlePrismaError(
    exception: PrismaClientKnownRequestError,
    path: string,
    timestamp: string,
    requestId?: string,
  ): ErrorResponse {
    let message: string;
    let statusCode: number;
    let code: string = exception.code;

    switch (exception.code) {
      case 'P2002':
        const target = (exception.meta?.target as string[]) || [];
        message = `A record with this ${target.join(', ')} already exists`;
        statusCode = HttpStatus.CONFLICT;
        break;
      case 'P2025':
        message = 'The requested record was not found';
        statusCode = HttpStatus.NOT_FOUND;
        break;
      case 'P2003':
        message = 'Foreign key constraint failed';
        statusCode = HttpStatus.BAD_REQUEST;
        break;
      case 'P2014':
        message = 'The change you are trying to make would violate a required relation';
        statusCode = HttpStatus.BAD_REQUEST;
        break;
      case 'P2016':
        message = 'Query interpretation error';
        statusCode = HttpStatus.BAD_REQUEST;
        break;
      case 'P2021':
        message = 'The table does not exist in the database';
        statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        break;
      case 'P2022':
        message = 'The column does not exist in the database';
        statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        break;
      case 'P2024':
        message = 'Timed out fetching a new connection from the pool';
        statusCode = HttpStatus.SERVICE_UNAVAILABLE;
        break;
      default:
        message = 'Database operation failed';
        statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    }

    return {
      success: false,
      statusCode,
      message,
      error: 'Database Error',
      code,
      timestamp,
      path,
      requestId,
      details: this.isDevelopment
        ? {
            code: exception.code,
            meta: exception.meta,
            clientVersion: exception.clientVersion,
          }
        : undefined,
    };
  }

  private handleValidationError(
    exception: any,
    path: string,
    timestamp: string,
    requestId?: string,
  ): ErrorResponse {
    const errors = exception.errors || [];
    const messages = errors.map((error: any) => {
      const constraints = Object.values(error.constraints || {});
      return constraints.join(', ');
    });

    return {
      success: false,
      statusCode: HttpStatus.BAD_REQUEST,
      message: messages.length > 0 ? messages : 'Validation failed',
      error: 'Validation Error',
      code: 'VALIDATION_ERROR',
      timestamp,
      path,
      requestId,
      details: this.isDevelopment
        ? {
            errors: errors.map((error: any) => ({
              field: error.property,
              constraints: error.constraints,
              value: error.value,
            })),
          }
        : undefined,
    };
  }

  private isValidationError(exception: unknown): boolean {
    return (
      exception instanceof Object &&
      'errors' in exception &&
      Array.isArray((exception as any).errors) &&
      (exception as any).errors.every(
        (error: any) => 'constraints' in error && 'property' in error,
      )
    );
  }

  private getErrorName(statusCode: number): string {
    const errorNames: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      408: 'Request Timeout',
      409: 'Conflict',
      410: 'Gone',
      422: 'Unprocessable Entity',
      423: 'Locked',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      501: 'Not Implemented',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };

    return errorNames[statusCode] || 'Unknown Error';
  }

  private logError(
    exception: unknown,
    request: FastifyRequest,
    errorResponse: ErrorResponse,
  ): void {
    const { method, url, headers, body } = request;
    const userAgent = headers['user-agent'];
    const requestId = headers['x-request-id'];
    const userId = (request as any).user?.id;

    const logContext = {
      requestId,
      method,
      url,
      userAgent,
      userId,
      statusCode: errorResponse.statusCode,
      errorCode: errorResponse.code,
      timestamp: errorResponse.timestamp,
    };

    // Include request body for 4xx errors in development
    if (
      this.isDevelopment &&
      errorResponse.statusCode >= 400 &&
      errorResponse.statusCode < 500
    ) {
      logContext['requestBody'] = this.sanitizeBody(body);
    }

    if (errorResponse.statusCode >= 500) {
      this.logger.error(
        `${method} ${url} - ${errorResponse.message}`,
        exception instanceof Error ? exception.stack : String(exception),
        logContext,
      );
    } else if (errorResponse.statusCode >= 400) {
      this.logger.warn(
        `${method} ${url} - ${errorResponse.message}`,
        logContext,
      );
    }
  }

  private recordMetrics(errorResponse: ErrorResponse, request: FastifyRequest): void {
    const labels = {
      error_type: errorResponse.error.toLowerCase().replace(/\s+/g, '_'),
      status_code: errorResponse.statusCode.toString(),
      method: request.method,
      path: this.normalizePathForMetrics(request.url),
    };

    this.metricsService.incrementCounter('http_errors_total', labels);

    if (errorResponse.statusCode >= 500) {
      this.metricsService.incrementCounter('http_errors_5xx_total', labels);
    } else if (errorResponse.statusCode >= 400) {
      this.metricsService.incrementCounter('http_errors_4xx_total', labels);
    }
  }

  private normalizePathForMetrics(url: string): string {
    // Remove query parameters
    const path = url.split('?')[0];
    
    // Replace UUIDs and IDs with placeholders
    return path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
      .replace(/\/\d+/g, '/:id');
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;

    const sensitiveFields = [
      'password',
      'confirmPassword',
      'currentPassword',
      'newPassword',
      'token',
      'refreshToken',
      'apiKey',
      'secret',
      'creditCard',
      'ssn',
    ];

    if (typeof body === 'object') {
      const sanitized = { ...body };
      
      for (const field of sensitiveFields) {
        if (field in sanitized) {
          sanitized[field] = '[REDACTED]';
        }
      }
      
      return sanitized;
    }

    return body;
  }
}
