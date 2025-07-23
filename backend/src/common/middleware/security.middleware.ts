import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SecurityMiddleware.name);

  // Suspicious patterns to monitor
  private readonly suspiciousPatterns = [
    // SQL Injection patterns
    /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/i,
    /(\-\-|\;|\||\*|\/\*|\*\/)/,

    // XSS patterns
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,

    // Path traversal
    /\.\.\/|\.\.\\|\.\.\//,

    // Command injection
    /(\||&|;|\$\(|\`)/,
  ];

  use(req: FastifyRequest, res: FastifyReply['raw'], next: () => void): void {
    console.log('🛡️ SecurityMiddleware processing:', { 
      method: req.method, 
      url: req.url,
      headers: Object.keys(req.headers),
      body: req.body ? 'has body' : 'no body'
    });
    
    try {
      this.addSecurityHeaders(res);
      this.checkSuspiciousActivity(req);
      this.sanitizeRequest(req);
      console.log('✅ SecurityMiddleware completed successfully');
      next();
    } catch (error) {
      console.log('❌ SecurityMiddleware error:', error);
      throw error;
    }
  }

  private addSecurityHeaders(res: FastifyReply['raw']): void {
    // Security headers for defense in depth
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );

    // Remove server identification
    res.removeHeader('X-Powered-By');
    res.setHeader('Server', 'Educational-Platform');

    // HSTS for HTTPS (enable in production)
    if (process.env.NODE_ENV === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
    }
  }

  private checkSuspiciousActivity(req: FastifyRequest): void {
    const userAgent = req.headers['user-agent'] || '';
    const url = req.url;
    const method = req.method;

    // Check for suspicious user agents
    const suspiciousUAs = [
      'sqlmap',
      'nikto',
      'nessus',
      'burpsuite',
      'acunetix',
      'w3af',
    ];

    const isSuspiciousUA = suspiciousUAs.some((ua) =>
      userAgent.toLowerCase().includes(ua),
    );

    if (isSuspiciousUA) {
      this.logger.warn(`Suspicious User-Agent detected: ${userAgent}`, {
        ip: this.getClientIp(req),
        url,
        method,
        userAgent,
      });
    }

    // Check for suspicious URL patterns
    const isSuspiciousURL = this.suspiciousPatterns.some((pattern) =>
      pattern.test(url),
    );

    if (isSuspiciousURL) {
      this.logger.warn(`Suspicious URL pattern detected: ${url}`, {
        ip: this.getClientIp(req),
        url,
        method,
        userAgent,
      });
    }
  }

  private sanitizeRequest(req: FastifyRequest): void {
    // Sanitize query parameters (handle readonly property)
    if (req.query && typeof req.query === 'object') {
      try {
        const sanitizedQuery = this.sanitizeObject(req.query);
        // Check if query is writable before attempting to modify
        const queryDescriptor = Object.getOwnPropertyDescriptor(req, 'query');
        if (queryDescriptor && queryDescriptor.writable !== false && queryDescriptor.set) {
          Object.assign(req, { query: sanitizedQuery });
        } else {
          // Query is readonly, skip modification but log if different
          const originalKeys = Object.keys(req.query);
          const sanitizedKeys = Object.keys(sanitizedQuery);
          if (JSON.stringify(originalKeys) !== JSON.stringify(sanitizedKeys)) {
            this.logger.warn('Query parameters contained suspicious content but could not be sanitized (readonly)', {
              url: req.url,
              originalKeys,
              sanitizedKeys,
            });
          }
        }
      } catch (error) {
        // Log error but don't fail the request
        this.logger.warn('Failed to sanitize query parameters:', error.message);
      }
    }

    // Sanitize body for non-file uploads
    if (req.body && typeof req.body === 'object') {
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        try {
          req.body = this.sanitizeObject(req.body);
        } catch (error) {
          console.warn('Failed to sanitize request body:', error.message);
        }
      }
    }
  }

  private sanitizeObject(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item));
    }

    const sanitized: any = {};

    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = this.sanitizeString(key);

      if (typeof value === 'string') {
        sanitized[sanitizedKey] = this.sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[sanitizedKey] = this.sanitizeObject(value);
      } else {
        sanitized[sanitizedKey] = value;
      }
    }

    return sanitized;
  }

  private sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      return input;
    }

    // Remove null bytes
    let sanitized = input.replace(/\0/g, '');

    // Limit length to prevent DoS
    if (sanitized.length > 10000) {
      this.logger.warn(
        `Extremely long input detected (${sanitized.length} chars)`,
      );
      sanitized = sanitized.substring(0, 10000);
    }

    return sanitized;
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
