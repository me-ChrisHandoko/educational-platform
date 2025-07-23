import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { EnterpriseSessionService } from '../services/enterprise-session.service';
import { AuditTrailService } from '../services/audit-trail.service';
import { SecurityMonitoringService } from '../services/security-monitoring.service';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export interface SecurityRequirement {
  minTrustLevel?: 'UNKNOWN' | 'KNOWN' | 'VERIFIED' | 'TRUSTED';
  maxRiskScore?: number;
  requiresMFA?: boolean;
  allowedRoles?: UserRole[];
  restrictedPaths?: string[];
  businessHoursOnly?: boolean;
}

@Injectable()
export class EnterpriseSecurityGuard implements CanActivate {
  private readonly logger = new Logger(EnterpriseSecurityGuard.name);

  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private enterpriseSessionService: EnterpriseSessionService,
    private auditTrailService: AuditTrailService,
    private securityMonitoringService: SecurityMonitoringService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    try {
      // Extract and validate JWT token
      const token = this.extractTokenFromHeader(request);
      if (!token) {
        await this.logSecurityEvent(null, request, 'NO_TOKEN', 'Missing authentication token');
        throw new UnauthorizedException('Authentication token required');
      }

      let payload;
      try {
        payload = await this.jwtService.verifyAsync(token);
      } catch {
        await this.logSecurityEvent(null, request, 'INVALID_TOKEN', 'Invalid JWT token');
        throw new UnauthorizedException('Invalid authentication token');
      }

      // Validate enterprise session
      const activeSession = await this.enterpriseSessionService.validateSession(payload.sessionId);
      if (!activeSession) {
        await this.logSecurityEvent(payload.userId, request, 'INVALID_SESSION', 'Session invalid or expired');
        throw new UnauthorizedException('Session invalid or expired');
      }

      // Get required roles from decorator
      const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      // Apply role-based access control
      if (requiredRoles && !this.hasRequiredRole(payload.role, requiredRoles)) {
        await this.logSecurityEvent(
          payload.userId, 
          request, 
          'INSUFFICIENT_PRIVILEGES', 
          `User role ${payload.role} insufficient for required roles: ${requiredRoles.join(', ')}`
        );
        throw new ForbiddenException('Insufficient privileges');
      }

      // Get security requirements for this route
      const securityRequirements = this.getSecurityRequirements(request, payload.role);

      // Apply enterprise security policies
      await this.applySecurityPolicies(activeSession, request, securityRequirements);

      // Update session activity
      await this.enterpriseSessionService.updateSessionActivity(activeSession.sessionId);

      // Attach user and session info to request
      request.user = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        sessionId: payload.sessionId
      };

      request.session = {
        sessionId: activeSession.sessionId,
        riskScore: activeSession.riskScore,
        riskLevel: activeSession.riskLevel,
        deviceTrustLevel: activeSession.deviceTrustLevel,
        deviceName: activeSession.deviceName
      };

      // Log successful access
      await this.logSecurityEvent(
        payload.userId,
        request,
        'ACCESS_GRANTED',
        'Successful authentication and authorization',
        {
          sessionId: activeSession.sessionId,
          riskScore: activeSession.riskScore,
          deviceTrustLevel: activeSession.deviceTrustLevel
        }
      );

      return true;

    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }

      this.logger.error('Enterprise security guard error:', error);
      await this.logSecurityEvent(
        request.user?.userId || null,
        request,
        'GUARD_ERROR',
        `Security guard error: ${error.message}`
      );
      
      throw new UnauthorizedException('Authentication failed');
    }
  }

  /**
   * Apply enterprise security policies
   */
  private async applySecurityPolicies(
    session: any,
    request: any,
    requirements: SecurityRequirement
  ): Promise<void> {
    // Risk score policy
    if (requirements.maxRiskScore && session.riskScore > requirements.maxRiskScore) {
      await this.auditTrailService.createSecurityAlert({
        userId: session.userId,
        sessionId: session.sessionId,
        alertType: 'HIGH_RISK_LOGIN',
        severity: 'HIGH',
        title: 'High Risk Session Access Blocked',
        description: `Access blocked due to risk score ${session.riskScore} exceeding limit ${requirements.maxRiskScore}`,
        riskScore: session.riskScore,
        metadata: {
          requestPath: request.path,
          requestMethod: request.method,
          maxRiskScore: requirements.maxRiskScore
        }
      });

      throw new ForbiddenException({
        message: 'Access denied due to security risk',
        riskScore: session.riskScore,
        maxAllowed: requirements.maxRiskScore
      });
    }

    // Device trust level policy
    if (requirements.minTrustLevel && 
        !this.meetsTrustLevelRequirement(session.deviceTrustLevel, requirements.minTrustLevel)) {
      
      await this.auditTrailService.createSecurityAlert({
        userId: session.userId,
        sessionId: session.sessionId,
        alertType: 'NEW_DEVICE',
        severity: 'MEDIUM',
        title: 'Untrusted Device Access Attempt',
        description: `Access attempted from device with trust level ${session.deviceTrustLevel}, required: ${requirements.minTrustLevel}`,
        metadata: {
          currentTrustLevel: session.deviceTrustLevel,
          requiredTrustLevel: requirements.minTrustLevel,
          requestPath: request.path
        }
      });

      throw new ForbiddenException({
        message: 'Trusted device required for this operation',
        currentTrustLevel: session.deviceTrustLevel,
        requiredTrustLevel: requirements.minTrustLevel
      });
    }

    // Business hours policy
    if (requirements.businessHoursOnly && !this.isBusinessHours()) {
      await this.auditTrailService.createSecurityAlert({
        userId: session.userId,
        sessionId: session.sessionId,
        alertType: 'POLICY_VIOLATION',
        severity: 'MEDIUM',
        title: 'Off-Hours Access Attempt',
        description: 'Access attempted outside business hours',
        metadata: {
          requestTime: new Date().toISOString(),
          requestPath: request.path
        }
      });

      throw new ForbiddenException('Access restricted to business hours');
    }

    // MFA requirement policy
    if (requirements.requiresMFA && !session.mfaVerified) {
      throw new ForbiddenException({
        message: 'Multi-factor authentication required',
        requiresMFA: true,
        mfaVerified: session.mfaVerified
      });
    }
  }

  /**
   * Get security requirements based on the request and user role
   */
  private getSecurityRequirements(request: any, userRole: string): SecurityRequirement {
    const path = request.path;
    const method = request.method;

    // Default requirements
    let requirements: SecurityRequirement = {
      maxRiskScore: 100,
      minTrustLevel: 'UNKNOWN'
    };

    // Admin endpoints require higher security
    if (path.startsWith('/admin') || path.includes('/admin/')) {
      requirements = {
        maxRiskScore: 70,
        minTrustLevel: 'VERIFIED',
        allowedRoles: [UserRole.ADMIN, UserRole.ADMIN],
        businessHoursOnly: true
      };
    }

    // Super admin endpoints require maximum security
    if (path.includes('/super-admin') || path.includes('/system')) {
      requirements = {
        maxRiskScore: 50,
        minTrustLevel: 'TRUSTED',
        requiresMFA: true,
        allowedRoles: [UserRole.ADMIN],
        businessHoursOnly: true
      };
    }

    // Security and audit endpoints
    if (path.includes('/security') || path.includes('/audit')) {
      requirements = {
        maxRiskScore: 60,
        minTrustLevel: 'VERIFIED',
        allowedRoles: [UserRole.ADMIN, UserRole.ADMIN]
      };
    }

    // User management endpoints
    if (path.includes('/users') && ['PUT', 'PATCH', 'DELETE'].includes(method)) {
      requirements = {
        maxRiskScore: 80,
        minTrustLevel: 'KNOWN',
        allowedRoles: [UserRole.ADMIN, UserRole.ADMIN]
      };
    }

    return requirements;
  }

  /**
   * Helper methods
   */
  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private hasRequiredRole(userRole: string, requiredRoles: UserRole[]): boolean {
    return requiredRoles.includes(userRole as UserRole);
  }

  private meetsTrustLevelRequirement(current: string, required: string): boolean {
    const trustLevels = ['UNKNOWN', 'KNOWN', 'VERIFIED', 'TRUSTED'];
    const currentIndex = trustLevels.indexOf(current);
    const requiredIndex = trustLevels.indexOf(required);
    return currentIndex >= requiredIndex;
  }

  private isBusinessHours(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    
    // Monday (1) to Friday (5), 8 AM to 6 PM
    return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
  }

  private async logSecurityEvent(
    userId: string | null,
    request: any,
    action: string,
    description: string,
    metadata: any = {}
  ): Promise<void> {
    try {
      await this.auditTrailService.logSecurityEvent({
        userId: userId || undefined,
        action: 'POLICY_VIOLATION',
        description,
        ipAddress: this.getClientIP(request),
        userAgent: request.headers['user-agent'],
        metadata: {
          ...metadata,
          path: request.path,
          method: request.method,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      this.logger.error('Failed to log security event:', error);
    }
  }

  private getClientIP(request: any): string {
    return (
      request.headers['x-forwarded-for'] ||
      request.headers['x-real-ip'] ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      'unknown'
    );
  }
}