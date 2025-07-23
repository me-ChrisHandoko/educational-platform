import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';

export interface RequestWithTenant extends Request {
  tenantId?: string;
  schoolId?: string;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(private configService: ConfigService) {}

  use(req: RequestWithTenant, res: Response, next: NextFunction) {
    // Extract tenant ID from various sources
    const tenantId = this.extractTenantId(req);
    
    if (tenantId) {
      req.tenantId = tenantId;
      this.logger.debug(`Tenant ID set: ${tenantId}`);
      
      // Add tenant ID to response headers for debugging
      if (this.configService.get('NODE_ENV') === 'development') {
        res.setHeader('X-Tenant-ID', tenantId);
      }
    }

    // Extract school ID if present
    const schoolId = this.extractSchoolId(req);
    if (schoolId) {
      req.schoolId = schoolId;
    }

    next();
  }

  private extractTenantId(req: RequestWithTenant): string | null {
    // 1. Check custom header
    const headerTenantId = req.headers['x-tenant-id'] as string;
    if (headerTenantId) {
      return headerTenantId;
    }

    // 2. Check subdomain
    const host = req.headers.host || '';
    const subdomain = this.extractSubdomain(host);
    if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
      return subdomain;
    }

    // 3. Check JWT token (if authenticated)
    if (req.user && typeof req.user === 'object' && 'tenantId' in req.user) {
      return (req.user as any).tenantId;
    }

    // 4. Check query parameter (for testing/development)
    if (this.configService.get('NODE_ENV') === 'development' && req.query.tenantId) {
      return req.query.tenantId as string;
    }

    return null;
  }

  private extractSchoolId(req: RequestWithTenant): string | null {
    // From JWT token
    if (req.user && typeof req.user === 'object' && 'schoolId' in req.user) {
      return (req.user as any).schoolId;
    }

    // From header (for specific operations)
    const headerSchoolId = req.headers['x-school-id'] as string;
    if (headerSchoolId) {
      return headerSchoolId;
    }

    return null;
  }

  private extractSubdomain(host: string): string | null {
    const parts = host.split('.');
    
    // For localhost or IP addresses, no subdomain
    if (parts.length < 2 || host.includes('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(host)) {
      return null;
    }

    // For standard domains (e.g., tenant.example.com)
    if (parts.length >= 3) {
      return parts[0];
    }

    return null;
  }
}
