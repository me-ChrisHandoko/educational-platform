import { Injectable, NestMiddleware, Logger, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { EnterpriseSessionService } from '../services/enterprise-session.service';
import { AuditTrailService } from '../services/audit-trail.service';
import { SecurityMonitoringService } from '../services/security-monitoring.service';
import { RiskAssessmentService } from '../services/risk-assessment.service';

export interface EnterpriseSecurityContext {
  user: {
    id: string;
    email: string;
    role: string;
  };
  session: {
    sessionId: string;
    riskScore: number;
    riskLevel: string;
    deviceTrustLevel: string;
  };
  request: {
    ipAddress: string;
    userAgent: string;
    path: string;
    method: string;
    timestamp: Date;
  };
}

@Injectable()
export class EnterpriseSecurityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(EnterpriseSecurityMiddleware.name);
  private readonly HIGH_RISK_PATHS = [
    '/admin',
    '/users',
    '/settings',
    '/security',
    '/audit'
  ];
  private readonly MONITORING_PATHS = [
    '/api',
    '/auth'
  ];

  constructor(
    private jwtService: JwtService,
    private enterpriseSessionService: EnterpriseSessionService,
    private auditTrailService: AuditTrailService,
    private securityMonitoringService: SecurityMonitoringService,
    private riskAssessmentService: RiskAssessmentService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    const ipAddress = this.getClientIP(req);
    const userAgent = req.headers['user-agent'] || '';

    // Add request ID for tracking
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);

    try {
      // Skip security checks for public endpoints
      if (this.isPublicEndpoint(req.path)) {
        await this.logRequestEvent(null, req, ipAddress, userAgent, 'PUBLIC_ACCESS');
        return next();
      }

      // Extract JWT token
      const token = this.extractToken(req);
      if (!token) {
        await this.logRequestEvent(null, req, ipAddress, userAgent, 'NO_TOKEN');
        return next();
      }

      // Validate JWT and get session
      const payload = await this.validateToken(token);
      if (!payload) {
        await this.logRequestEvent(null, req, ipAddress, userAgent, 'INVALID_TOKEN');
        return next();
      }

      // Validate enterprise session
      const activeSession = await this.enterpriseSessionService.validateSession(payload.sessionId);
      if (!activeSession) {
        await this.logRequestEvent(payload.userId, req, ipAddress, userAgent, 'INVALID_SESSION');
        throw new ForbiddenException('Session invalid or expired');
      }

      // Build security context
      const securityContext: EnterpriseSecurityContext = {
        user: {
          id: payload.userId,
          email: payload.email,
          role: payload.role
        },
        session: {
          sessionId: activeSession.sessionId,
          riskScore: activeSession.riskScore,
          riskLevel: activeSession.riskLevel,
          deviceTrustLevel: activeSession.deviceTrustLevel
        },
        request: {
          ipAddress,
          userAgent,
          path: req.path,
          method: req.method,
          timestamp: new Date()
        }
      };

      // Apply security policies
      await this.applySecurityPolicies(securityContext, req);

      // Real-time risk assessment for sensitive operations
      if (this.isSensitiveOperation(req)) {
        await this.performRuntimeRiskAssessment(securityContext, req);
      }

      // Update session activity
      await this.enterpriseSessionService.updateSessionActivity(activeSession.sessionId);

      // Log request for audit trail
      await this.logRequestEvent(
        payload.userId, 
        req, 
        ipAddress, 
        userAgent, 
        'AUTHORIZED_ACCESS',
        {
          sessionId: activeSession.sessionId,
          riskScore: activeSession.riskScore,
          deviceTrustLevel: activeSession.deviceTrustLevel
        }
      );

      // Attach security context to request
      (req as any).security = securityContext;
      (req as any).user = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        sessionId: payload.sessionId
      };

      next();

    } catch (error) {
      this.logger.error('Security middleware error:', error);
      
      await this.logRequestEvent(
        (req as any).user?.userId || null,
        req,
        ipAddress,
        userAgent,
        'SECURITY_ERROR',
        { error: error.message }
      );

      throw error;
    } finally {
      // Log response metrics
      const processingTime = Date.now() - startTime;
      res.setHeader('x-processing-time', processingTime.toString());
      
      // Monitor for performance issues
      if (processingTime > 1000) {
        this.logger.warn(`Slow request: ${req.method} ${req.path} took ${processingTime}ms`);
      }
    }
  }

  /**
   * Apply enterprise security policies
   */
  private async applySecurityPolicies(
    context: EnterpriseSecurityContext,
    req: Request
  ): Promise<void> {
    // High-risk session blocking
    if (context.session.riskScore >= 90) {
      await this.auditTrailService.createSecurityAlert({
        userId: context.user.id,
        sessionId: context.session.sessionId,
        alertType: 'HIGH_RISK_LOGIN',
        severity: 'CRITICAL',
        title: 'High Risk Session Blocked',
        description: `Request blocked due to critical risk score: ${context.session.riskScore}`,
        riskScore: context.session.riskScore,
        metadata: {
          path: req.path,
          method: req.method,
          ipAddress: context.request.ipAddress
        }
      });

      throw new ForbiddenException({
        message: 'Access denied due to security risk',
        riskScore: context.session.riskScore,
        requiresVerification: true
      });
    }

    // Admin-only path protection
    if (this.isAdminPath(req.path) && !this.isAdminRole(context.user.role)) {
      await this.auditTrailService.createSecurityAlert({
        userId: context.user.id,
        sessionId: context.session.sessionId,
        alertType: 'POLICY_VIOLATION',
        severity: 'HIGH',
        title: 'Unauthorized Admin Access Attempt',
        description: `Non-admin user attempted to access admin path: ${req.path}`,
        metadata: {
          userRole: context.user.role,
          requestedPath: req.path
        }
      });

      throw new ForbiddenException('Insufficient privileges for this operation');
    }

    // Device trust level enforcement for sensitive operations
    if (this.isSensitiveOperation(req) && 
        context.session.deviceTrustLevel === 'UNKNOWN' &&
        this.requiresTrustedDevice(context.user.role)) {
      
      await this.auditTrailService.createSecurityAlert({
        userId: context.user.id,
        sessionId: context.session.sessionId,
        alertType: 'NEW_DEVICE',
        severity: 'MEDIUM',
        title: 'Untrusted Device Access',
        description: 'Sensitive operation attempted from untrusted device',
        metadata: {
          operation: `${req.method} ${req.path}`,
          deviceTrustLevel: context.session.deviceTrustLevel
        }
      });

      throw new ForbiddenException({
        message: 'Trusted device required for this operation',
        requiresDeviceVerification: true
      });
    }
  }

  /**
   * Perform runtime risk assessment for sensitive operations
   */
  private async performRuntimeRiskAssessment(
    context: EnterpriseSecurityContext,
    req: Request
  ): Promise<void> {
    const riskAssessment = await this.riskAssessmentService.assessOperationRisk(
      context.user.id,
      {
        operation: `${req.method} ${req.path}`,
        ipAddress: context.request.ipAddress,
        userAgent: context.request.userAgent,
        sessionId: context.session.sessionId,
        currentRiskScore: context.session.riskScore,
        timestamp: new Date()
      }
    );

    // If runtime risk is significantly higher, create alert
    if (riskAssessment.riskScore > context.session.riskScore + 20) {
      await this.auditTrailService.createSecurityAlert({
        userId: context.user.id,
        sessionId: context.session.sessionId,
        alertType: 'SUSPICIOUS_ACTIVITY',
        severity: riskAssessment.riskScore >= 80 ? 'CRITICAL' : 'HIGH',
        title: 'Elevated Risk Operation',
        description: `Risk score increased to ${riskAssessment.riskScore} during operation`,
        riskScore: riskAssessment.riskScore,
        metadata: {
          operation: `${req.method} ${req.path}`,
          previousRiskScore: context.session.riskScore,
          newRiskScore: riskAssessment.riskScore,
          riskFactors: riskAssessment.factors
        }
      });

      // Block if risk is too high
      if (riskAssessment.riskScore >= 85) {
        throw new ForbiddenException({
          message: 'Operation blocked due to elevated security risk',
          riskScore: riskAssessment.riskScore,
          factors: riskAssessment.factors
        });
      }
    }
  }

  /**
   * Log request event to audit trail
   */
  private async logRequestEvent(
    userId: string | null,
    req: Request,
    ipAddress: string,
    userAgent: string,
    action: string,
    metadata: any = {}
  ): Promise<void> {
    try {
      await this.auditTrailService.logAuditEvent({
        userId: userId || undefined,
        action,
        resourceType: 'REQUEST',
        description: `${req.method} ${req.path}`,
        ipAddress,
        userAgent,
        requestPath: req.path,
        requestMethod: req.method,
        metadata: {
          ...metadata,
          query: req.query,
          headers: this.sanitizeHeaders(req.headers)
        }
      });
    } catch (error) {
      this.logger.error('Failed to log request event:', error);
    }
  }

  /**
   * Helper methods
   */
  private extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }

  private async validateToken(token: string): Promise<any> {
    try {
      return await this.jwtService.verifyAsync(token);
    } catch {
      return null;
    }
  }

  private getClientIP(req: Request): string {
    return (
      req.headers['x-forwarded-for'] as string ||
      req.headers['x-real-ip'] as string ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      'unknown'
    );
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private isPublicEndpoint(path: string): boolean {
    const publicPaths = [
      '/auth/login',
      '/auth/register', 
      '/auth/enterprise/login',
      '/health',
      '/metrics',
      '/',
      '/favicon.ico'
    ];
    return publicPaths.some(publicPath => path.startsWith(publicPath));
  }

  private isSensitiveOperation(req: Request): boolean {
    return (
      this.HIGH_RISK_PATHS.some(path => req.path.startsWith(path)) ||
      ['DELETE', 'PUT', 'PATCH'].includes(req.method) ||
      req.path.includes('/admin') ||
      req.path.includes('/security') ||
      req.path.includes('/users')
    );
  }

  private isAdminPath(path: string): boolean {
    return path.startsWith('/admin') || 
           path.includes('/admin/') ||
           path.startsWith('/auth/admin') ||
           path.startsWith('/security/admin');
  }

  private isAdminRole(role: string): boolean {
    return ['ADMIN', 'SUPER_ADMIN'].includes(role);
  }

  private requiresTrustedDevice(role: string): boolean {
    return ['ADMIN', 'SUPER_ADMIN'].includes(role);
  }

  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers };
    delete sanitized.authorization;
    delete sanitized.cookie;
    return sanitized;
  }
}