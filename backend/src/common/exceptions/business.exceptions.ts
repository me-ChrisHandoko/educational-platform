import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessRuleViolationException extends HttpException {
  constructor(code: string, message: string, details?: any) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Business Rule Violation',
        code,
        message,
        details,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ResourceLockedException extends HttpException {
  constructor(resource: string, retryAfter?: number) {
    super(
      {
        statusCode: HttpStatus.LOCKED,
        error: 'Resource Locked',
        message: `${resource} is currently locked`,
        retryAfter,
      },
      HttpStatus.LOCKED,
    );
  }
}

export class InsufficientPermissionsException extends HttpException {
  constructor(action: string, resource: string) {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Insufficient Permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        message: `You do not have permission to ${action} ${resource}`,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

export class InvalidStateTransitionException extends HttpException {
  constructor(entity: string, fromState: string, toState: string) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Invalid State Transition',
        code: 'INVALID_STATE_TRANSITION',
        message: `Cannot transition ${entity} from ${fromState} to ${toState}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class DuplicateResourceException extends HttpException {
  constructor(resource: string, identifier: string) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Duplicate Resource',
        code: 'DUPLICATE_RESOURCE',
        message: `${resource} with identifier '${identifier}' already exists`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class ResourceNotFoundException extends HttpException {
  constructor(resource: string, identifier: string) {
    super(
      {
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Resource Not Found',
        code: 'RESOURCE_NOT_FOUND',
        message: `${resource} with identifier '${identifier}' not found`,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ValidationException extends HttpException {
  constructor(errors: Record<string, string[]>) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Validation Failed',
        code: 'VALIDATION_FAILED',
        message: 'The provided data failed validation',
        errors,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class ExternalServiceException extends HttpException {
  constructor(service: string, message: string, retryable: boolean = false) {
    super(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'External Service Error',
        code: 'EXTERNAL_SERVICE_ERROR',
        message: `Error communicating with ${service}: ${message}`,
        service,
        retryable,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class RateLimitExceededException extends HttpException {
  constructor(limit: number, window: string, retryAfter: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Rate Limit Exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit of ${limit} requests per ${window} exceeded`,
        limit,
        window,
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class SubscriptionRequiredException extends HttpException {
  constructor(feature: string, requiredPlan: string) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Subscription Required',
        code: 'SUBSCRIPTION_REQUIRED',
        message: `${feature} requires ${requiredPlan} subscription`,
        feature,
        requiredPlan,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export class DataIntegrityException extends HttpException {
  constructor(entity: string, message: string) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Data Integrity Violation',
        code: 'DATA_INTEGRITY_VIOLATION',
        message: `Data integrity violation for ${entity}: ${message}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class InvalidOperationException extends HttpException {
  constructor(operation: string, reason: string) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Invalid Operation',
        code: 'INVALID_OPERATION',
        message: `Cannot perform ${operation}: ${reason}`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
