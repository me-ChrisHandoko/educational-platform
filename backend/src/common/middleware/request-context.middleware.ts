import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

export interface RequestContext {
  requestId: string;
  userId?: string;
  userRole?: string;
  tenantId?: string;
  startTime: number;
  ipAddress: string;
  userAgent: string;
}

declare global {
  namespace Express {
    interface Request {
      context: RequestContext;
    }
  }
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: FastifyRequest, res: FastifyReply['raw'], next: () => void): void {
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();
    const startTime = Date.now();
    const ipAddress = this.getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // Create request context
    const context: RequestContext = {
      requestId,
      startTime,
      ipAddress,
      userAgent,
    };

    // Attach context to request
    (req as any).context = context;

    // Set request ID header for response
    res.setHeader('X-Request-ID', requestId);

    next();
  }

  private getClientIp(req: FastifyRequest): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (req.headers['x-real-ip'] as string) ||
      req.ip ||
      'unknown'
    );
  }
}
