import { SetMetadata } from '@nestjs/common';
import { ThrottlerOptions } from '@nestjs/throttler';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions extends ThrottlerOptions {
  keyGenerator?: (context: any) => string;
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

// Predefined rate limits
export const RateLimits = {
  // Authentication endpoints
  AUTH_STRICT: { limit: 5, ttl: 900 }, // 5 requests per 15 minutes
  AUTH_STANDARD: { limit: 10, ttl: 900 }, // 10 requests per 15 minutes
  
  // API endpoints
  API_BURST: { limit: 100, ttl: 60 }, // 100 requests per minute
  API_STANDARD: { limit: 60, ttl: 60 }, // 60 requests per minute
  API_LIMITED: { limit: 20, ttl: 60 }, // 20 requests per minute
  
  // File operations
  FILE_UPLOAD: { limit: 10, ttl: 3600 }, // 10 uploads per hour
  FILE_DOWNLOAD: { limit: 100, ttl: 3600 }, // 100 downloads per hour
  
  // Report generation
  REPORT_GENERATION: { limit: 5, ttl: 3600 }, // 5 reports per hour
  
  // Bulk operations
  BULK_OPERATION: { limit: 2, ttl: 3600 }, // 2 bulk operations per hour
};

// Decorators for common rate limits
export const AuthRateLimit = () => RateLimit(RateLimits.AUTH_STRICT);
export const ApiRateLimit = () => RateLimit(RateLimits.API_STANDARD);
export const FileUploadRateLimit = () => RateLimit(RateLimits.FILE_UPLOAD);
export const BulkOperationRateLimit = () => RateLimit(RateLimits.BULK_OPERATION);
