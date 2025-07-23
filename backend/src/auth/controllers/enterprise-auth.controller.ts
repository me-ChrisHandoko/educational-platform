import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  UnauthorizedException,
  ForbiddenException,
  Headers,
  Ip,
  Delete,
  Param,
  Query,
  Put,
  Logger
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request as ExpressRequest } from 'express';
import { AuthService } from '../auth.service';
import { EnterpriseSessionService } from '../services/enterprise-session.service';
import { RiskAssessmentService, DeviceFingerprint } from '../services/risk-assessment.service';
import { AuditTrailService } from '../services/audit-trail.service';
import { LocalAuthGuard } from '../guards/local-auth.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import { LoginDto } from '../dto/auth.dto';
import { SecurityContext } from '../interfaces/auth.interface';
import { 
  UserRole, 
  LoginResult,
  SecurityAlertType,
  AlertSeverity,
  AssessmentType
} from '@prisma/client';

export interface DeviceFingerprintDto {
  userAgent: string;
  screen: { width: number; height: number; colorDepth: number };
  timezone: string;
  language: string;
  platform: string;
  cookieEnabled: boolean;
  doNotTrack: boolean;
  hash: string;
}

export interface EnterpriseLoginRequest {
  email: string;
  password: string;
  tenantId?: string;
  deviceFingerprint: DeviceFingerprintDto;
  timezone?: string;
  browserLanguage?: string;
  coordinates?: { lat: number; lng: number };
}

export interface EnterpriseLoginResponse {
  success: boolean;
  data: {
    user: {
      id: string;
      email: string;
      role: UserRole;
      firstName?: string;
      lastName?: string;
    };
    tokens: {
      accessToken: string;
      refreshToken: string;
      accessTokenExpiresAt: string;
      refreshTokenExpiresAt: string;
    };
    session: {
      sessionId: string;
      expiresAt: string;
      deviceName: string;
      location: string;
      riskScore: number;
      deviceTrusted: boolean;
    };
    security: {
      riskScore: number;
      riskLevel: string;
      newDevice: boolean;
      newLocation: boolean;
      sessionPolicy: string;
      requiresAdditionalVerification: boolean;
    };
    notifications: string[];
  };
}

@Controller('auth/enterprise')
@UseGuards(RolesGuard)
export class EnterpriseAuthController {
  private readonly logger = new Logger(EnterpriseAuthController.name);

  constructor(
    private authService: AuthService,
    private enterpriseSessionService: EnterpriseSessionService,
    private riskAssessmentService: RiskAssessmentService,
    private auditTrailService: AuditTrailService,
  ) {}

  /**
   * Enterprise-grade login with comprehensive security assessment
   */
  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 attempts per minute
  async enterpriseLogin(
    @Body() loginRequest: EnterpriseLoginRequest,
    @Request() req: ExpressRequest & { user: any },
    @Headers('user-agent') userAgent: string,
    @Ip() ipAddress: string,
  ): Promise<EnterpriseLoginResponse> {
    this.logger.log(`Enterprise login attempt from ${ipAddress} for ${loginRequest.email}`);

    if (!req.user) {
      throw new UnauthorizedException('Authentication failed');
    }

    const user = req.user;
    const notifications: string[] = [];

    try {
      // 1. Log login attempt as successful (LocalAuthGuard already verified)
      await this.auditTrailService.logLoginAttempt({
        email: loginRequest.email,
        userId: user.id,
        result: LoginResult.SUCCESS,
        ipAddress,
        userAgent,
        deviceFingerprint: loginRequest.deviceFingerprint.hash,
        location: await this.getLocationFromIP(ipAddress),
        riskScore: 0 // Will be updated after risk assessment
      });

      // 2. Comprehensive risk assessment
      const locationDetails = await this.getLocationDetails(ipAddress);
      const riskAssessment = await this.riskAssessmentService.assessLoginRisk(user.id, {
        ipAddress,
        userAgent,
        deviceFingerprint: loginRequest.deviceFingerprint,
        location: locationDetails.country && locationDetails.city ? {
          country: locationDetails.country,
          city: locationDetails.city
        } : undefined,
        timestamp: new Date()
      });

      // 3. Create risk assessment record
      await this.auditTrailService.createRiskAssessment({
        userId: user.id,
        assessmentType: AssessmentType.LOGIN,
        overallRiskScore: riskAssessment.riskScore,
        deviceRisk: 0, // Would be calculated by risk service
        locationRisk: 0,
        behavioralRisk: 0,
        temporalRisk: 0,
        patternRisk: 0,
        riskFactors: riskAssessment.factors,
        recommendations: riskAssessment.recommendations,
        ipAddress,
        deviceFingerprint: loginRequest.deviceFingerprint.hash
      });

      // 4. Check for high-risk scenarios requiring additional verification
      if (riskAssessment.riskScore >= 80) {
        await this.auditTrailService.createSecurityAlert({
          userId: user.id,
          alertType: SecurityAlertType.HIGH_RISK_LOGIN,
          severity: AlertSeverity.CRITICAL,
          title: 'Critical Risk Login Blocked',
          description: `Login blocked due to critical risk score: ${riskAssessment.riskScore}`,
          riskScore: riskAssessment.riskScore,
          metadata: {
            factors: riskAssessment.factors,
            ipAddress,
            deviceFingerprint: loginRequest.deviceFingerprint.hash
          }
        });

        throw new ForbiddenException({
          message: 'Login blocked due to security concerns',
          riskAssessment: {
            riskLevel: riskAssessment.riskLevel,
            factors: riskAssessment.factors.map(f => f.description),
            requiresVerification: true
          }
        });
      }

      // 5. Handle medium-high risk scenarios
      if (riskAssessment.riskScore >= 50) {
        notifications.push('Additional security verification may be required');
        
        await this.auditTrailService.createSecurityAlert({
          userId: user.id,
          alertType: SecurityAlertType.HIGH_RISK_LOGIN,
          severity: AlertSeverity.HIGH,
          title: 'High Risk Login Detected',
          description: `Login from potentially risky context with score: ${riskAssessment.riskScore}`,
          riskScore: riskAssessment.riskScore,
          metadata: { factors: riskAssessment.factors }
        });
      }

      // 6. Create enterprise session
      const sessionResult = await this.enterpriseSessionService.createSession(
        user.id,
        user.role as UserRole,
        {
          deviceFingerprint: loginRequest.deviceFingerprint.hash,
          ipAddress,
          userAgent,
          location: locationDetails,
          timezone: loginRequest.timezone,
          language: loginRequest.browserLanguage
        }
      );

      // 7. Generate JWT tokens
      const tokens = await this.authService.generateTokens(user, sessionResult.sessionId);

      // 8. Detect security events
      const newDevice = riskAssessment.factors.some(f => 
        f.description && f.description.includes('unknown device')
      );
      const newLocation = riskAssessment.factors.some(f => 
        f.description && f.description.includes('new location')
      );

      // 9. Create security alerts for new device/location
      if (newDevice) {
        notifications.push('Login from a new device detected');
        await this.auditTrailService.createSecurityAlert({
          userId: user.id,
          sessionId: sessionResult.sessionId,
          alertType: SecurityAlertType.NEW_DEVICE,
          severity: AlertSeverity.MEDIUM,
          title: 'New Device Login',
          description: 'User logged in from a previously unknown device',
          metadata: {
            deviceFingerprint: loginRequest.deviceFingerprint.hash,
            deviceName: this.extractDeviceName(userAgent)
          }
        });
      }

      if (newLocation) {
        notifications.push('Login from a new location detected');
        await this.auditTrailService.createSecurityAlert({
          userId: user.id,
          sessionId: sessionResult.sessionId,
          alertType: SecurityAlertType.NEW_LOCATION,
          severity: AlertSeverity.MEDIUM,
          title: 'New Location Login',
          description: 'User logged in from a new geographic location',
          metadata: {
            ipAddress,
            location: await this.getLocationFromIP(ipAddress)
          }
        });
      }

      // 10. Add session management notifications
      if (sessionResult.warningMessage) {
        notifications.push(sessionResult.warningMessage);
      }

      // 11. Log successful enterprise login
      await this.auditTrailService.logAuthenticationEvent({
        userId: user.id,
        sessionId: sessionResult.sessionId,
        action: 'LOGIN_SUCCESS',
        description: 'Enterprise login completed successfully',
        ipAddress,
        userAgent,
        deviceFingerprint: loginRequest.deviceFingerprint.hash,
        riskScore: riskAssessment.riskScore,
        metadata: {
          riskLevel: riskAssessment.riskLevel,
          newDevice,
          newLocation,
          deviceTrusted: sessionResult.deviceTrusted
        }
      });

      this.logger.log(`Enterprise login successful for user ${user.id}, risk score: ${riskAssessment.riskScore}`);

      return {
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            firstName: user.profile?.firstName,
            lastName: user.profile?.lastName,
          },
          tokens: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
            refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
          },
          session: {
            sessionId: sessionResult.sessionId,
            expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
            deviceName: this.extractDeviceName(userAgent),
            location: await this.getLocationFromIP(ipAddress),
            riskScore: riskAssessment.riskScore,
            deviceTrusted: sessionResult.deviceTrusted
          },
          security: {
            riskScore: riskAssessment.riskScore,
            riskLevel: riskAssessment.riskLevel,
            newDevice,
            newLocation,
            sessionPolicy: user.role,
            requiresAdditionalVerification: riskAssessment.requiresAdditionalVerification
          },
          notifications
        }
      };

    } catch (error) {
      // Log failed login attempt due to security restrictions
      await this.auditTrailService.logLoginAttempt({
        email: loginRequest.email,
        userId: user.id,
        result: LoginResult.FAILED_RISK_BLOCKED,
        resultMessage: error.message,
        ipAddress,
        userAgent,
        deviceFingerprint: loginRequest.deviceFingerprint.hash,
        blocked: true,
        blockReason: 'SECURITY_RISK'
      });

      throw error;
    }
  }

  /**
   * Get active sessions for current user
   */
  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async getActiveSessions(@CurrentUser() user: SecurityContext) {
    const sessions = await this.enterpriseSessionService.getActiveSessions(user.userId);
    
    return {
      success: true,
      data: {
        sessions: sessions.map(session => ({
          sessionId: session.sessionId,
          deviceName: session.deviceName,
          deviceType: session.deviceType,
          location: session.location,
          ipAddress: session.ipAddress,
          createdAt: session.createdAt,
          lastActivityAt: session.lastActivityAt,
          isCurrent: session.sessionId === user.sessionId,
          riskScore: session.riskScore,
          riskLevel: session.riskLevel,
          deviceTrustLevel: session.deviceTrustLevel,
          status: session.status
        })),
        currentSessionId: user.sessionId,
        totalActiveSessions: sessions.length
      }
    };
  }

  /**
   * Terminate specific session
   */
  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:sessionId')
  async terminateSession(
    @CurrentUser() user: SecurityContext,
    @Param('sessionId') sessionId: string
  ) {
    // Prevent users from terminating their current session via this endpoint
    if (sessionId === user.sessionId) {
      throw new ForbiddenException('Cannot terminate current session. Use logout instead.');
    }

    // Verify session belongs to user
    const userSessions = await this.enterpriseSessionService.getActiveSessions(user.userId);
    const targetSession = userSessions.find(s => s.sessionId === sessionId);
    
    if (!targetSession) {
      throw new UnauthorizedException('Session not found or does not belong to user');
    }

    await this.enterpriseSessionService.terminateSession(sessionId, 'USER_TERMINATED');

    await this.auditTrailService.logSessionEvent({
      userId: user.userId,
      sessionId: user.sessionId,
      action: 'SESSION_TERMINATED',
      description: 'User terminated their own session',
      metadata: {
        terminatedSessionId: sessionId,
        deviceName: targetSession.deviceName
      }
    });

    return {
      success: true,
      data: {
        message: 'Session terminated successfully',
        terminatedSession: {
          sessionId: sessionId,
          deviceName: targetSession.deviceName
        }
      }
    };
  }

  /**
   * Terminate all other sessions (except current)
   */
  @UseGuards(JwtAuthGuard)
  @Post('sessions/terminate-all-others')
  async terminateAllOtherSessions(@CurrentUser() user: SecurityContext) {
    const userSessions = await this.enterpriseSessionService.getActiveSessions(user.userId);
    const otherSessions = userSessions.filter(s => s.sessionId !== user.sessionId);

    for (const session of otherSessions) {
      await this.enterpriseSessionService.terminateSession(session.sessionId, 'USER_TERMINATED_ALL');
    }

    await this.auditTrailService.logSessionEvent({
      userId: user.userId,
      sessionId: user.sessionId,
      action: 'SESSION_TERMINATED',
      description: 'User terminated all other sessions',
      metadata: {
        terminatedCount: otherSessions.length,
        terminatedSessions: otherSessions.map(s => ({
          sessionId: s.sessionId,
          deviceName: s.deviceName
        }))
      }
    });

    return {
      success: true,
      data: {
        message: `${otherSessions.length} other session(s) terminated successfully`,
        terminatedCount: otherSessions.length,
        currentSessionId: user.sessionId
      }
    };
  }

  /**
   * Enterprise logout with comprehensive cleanup
   */
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async enterpriseLogout(@CurrentUser() user: SecurityContext) {
    // Terminate current session
    await this.enterpriseSessionService.terminateSession(user.sessionId, 'USER_LOGOUT');

    await this.auditTrailService.logAuthenticationEvent({
      userId: user.userId,
      sessionId: user.sessionId,
      action: 'LOGOUT',
      description: 'User logged out successfully'
    });

    return {
      success: true,
      data: {
        message: 'Logged out successfully',
        sessionId: user.sessionId
      }
    };
  }

  /**
   * Get security overview for current user
   */
  @UseGuards(JwtAuthGuard)
  @Get('security/overview')
  async getSecurityOverview(@CurrentUser() user: SecurityContext) {
    const [sessions, alerts, statistics] = await Promise.all([
      this.enterpriseSessionService.getActiveSessions(user.userId),
      this.auditTrailService.getUserSecurityAlerts(user.userId, { limit: 10 }),
      this.auditTrailService.getAuditStatistics(user.userId, 'week')
    ]);

    const securityScore = this.calculateUserSecurityScore(sessions, alerts.alerts);

    return {
      success: true,
      data: {
        securityScore,
        activeSessions: {
          count: sessions.length,
          highRiskCount: sessions.filter(s => s.riskScore > 60).length,
          trustedDeviceCount: sessions.filter(s => s.deviceTrustLevel === 'TRUSTED').length
        },
        recentActivity: {
          loginCount: statistics.authenticationEvents,
          securityAlerts: statistics.activeAlerts,
          failedAttempts: statistics.failedLogins,
          riskAssessments: statistics.highRiskAssessments
        },
        recentAlerts: alerts.alerts.slice(0, 5).map(alert => ({
          id: alert.id,
          type: alert.alertType,
          severity: alert.severity,
          title: alert.title,
          triggeredAt: alert.triggeredAt,
          status: alert.status
        })),
        recommendations: this.generateSecurityRecommendations(securityScore, sessions, alerts.alerts)
      }
    };
  }

  /**
   * Get audit history for current user
   */
  @UseGuards(JwtAuthGuard)
  @Get('audit/history')
  async getAuditHistory(
    @CurrentUser() user: SecurityContext,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('category') category?: string
  ) {
    const result = await this.auditTrailService.getUserAuditHistory(user.userId, {
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      category: category as any
    });

    return {
      success: true,
      data: {
        events: result.events.map(event => ({
          id: event.id,
          action: event.action,
          category: event.category,
          description: typeof event.metadata === 'object' && event.metadata !== null && 'description' in event.metadata ? event.metadata.description : null,
          timestamp: event.createdAt,
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          riskScore: typeof event.metadata === 'object' && event.metadata !== null && 'riskScore' in event.metadata ? event.metadata.riskScore : null
        })),
        total: result.total,
        hasMore: (parseInt(offset || '0') + result.events.length) < result.total
      }
    };
  }

  /**
   * Admin endpoints for IT governance
   */
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/users/:userId/sessions')
  async getUserSessionsAdmin(
    @CurrentUser() admin: SecurityContext,
    @Param('userId') userId: string,
    @Query('includeInactive') includeInactive?: boolean
  ) {
    const sessions = await this.enterpriseSessionService.getActiveSessions(userId);
    
    await this.auditTrailService.logSecurityEvent({
      userId: admin.userId,
      action: 'ADMIN_ACTION',
      description: 'Admin viewed user sessions',
      metadata: {
        action: 'VIEW_USER_SESSIONS',
        targetUserId: userId
      }
    });

    return {
      success: true,
      data: {
        userId,
        sessions: sessions.map(session => ({
          ...session,
          // Include more details for admin view
          deviceFingerprint: session.deviceFingerprint,
          riskFactors: session.riskScore > 50 ? 'High risk detected' : 'Normal',
        })),
        totalSessions: sessions.length
      }
    };
  }

  /**
   * Admin endpoint: Terminate user session
   */
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN)
  @Delete('admin/users/:userId/sessions/:sessionId')
  async terminateUserSessionAdmin(
    @CurrentUser() admin: SecurityContext,
    @Param('userId') userId: string,
    @Param('sessionId') sessionId: string
  ) {
    await this.enterpriseSessionService.terminateSession(sessionId, 'ADMIN_TERMINATED');

    await this.auditTrailService.logSecurityEvent({
      userId: admin.userId,
      action: 'ADMIN_ACTION',
      description: 'Admin terminated user session',
      metadata: {
        action: 'TERMINATE_USER_SESSION',
        targetUserId: userId,
        terminatedSessionId: sessionId
      }
    });

    return {
      success: true,
      data: {
        message: 'User session terminated by admin',
        userId,
        sessionId,
        terminatedBy: admin.userId
      }
    };
  }

  /**
   * Admin endpoint: Get system-wide security statistics
   */
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/security/statistics')
  async getSystemSecurityStatistics(
    @CurrentUser() admin: SecurityContext,
    @Query('timeframe') timeframe?: 'hour' | 'day' | 'week' | 'month'
  ) {
    const statistics = await this.auditTrailService.getAuditStatistics(
      undefined, // No specific user - system wide
      timeframe || 'day'
    );

    const sessionStats = await this.enterpriseSessionService.getSessionStatistics();

    await this.auditTrailService.logSecurityEvent({
      userId: admin.userId,
      action: 'ADMIN_ACTION',
      description: 'Admin accessed security statistics',
      metadata: { action: 'VIEW_SECURITY_STATISTICS' }
    });

    return {
      success: true,
      data: {
        timeframe: timeframe || 'day',
        sessions: sessionStats,
        audit: statistics,
        summary: {
          totalActiveSessions: sessionStats.activeSessions,
          highRiskSessions: sessionStats.highRiskSessions,
          securityAlerts: statistics.activeAlerts,
          failedLogins: statistics.failedLogins,
          systemSecurityScore: statistics.securityScore
        }
      }
    };
  }

  /**
   * Private helper methods
   */
  private extractDeviceName(userAgent: string): string {
    if (userAgent.includes('iPhone')) return 'iPhone';
    if (userAgent.includes('iPad')) return 'iPad';
    if (userAgent.includes('Android')) return 'Android Device';
    if (userAgent.includes('Windows')) return 'Windows PC';
    if (userAgent.includes('Macintosh')) return 'Mac';
    return 'Unknown Device';
  }

  private async getLocationFromIP(ipAddress: string): Promise<string> {
    // TODO: Implement IP geolocation service
    // For now, return placeholder
    return 'Location detection needed';
  }

  private async getLocationDetails(ipAddress: string): Promise<{ country?: string; city?: string }> {
    // TODO: Implement IP geolocation service
    // For now, return placeholder
    return {};
  }

  private calculateUserSecurityScore(sessions: any[], alerts: any[]): number {
    let score = 100;
    
    // Deduct points for security issues
    const highRiskSessions = sessions.filter(s => s.riskScore > 60).length;
    const activeAlerts = alerts.filter(a => a.status === 'ACTIVE').length;
    
    score -= Math.min(highRiskSessions * 10, 30);
    score -= Math.min(activeAlerts * 5, 40);
    
    return Math.max(score, 0);
  }

  private generateSecurityRecommendations(
    score: number, 
    sessions: any[], 
    alerts: any[]
  ): string[] {
    const recommendations: string[] = [];

    if (score < 70) {
      recommendations.push('Consider enabling two-factor authentication');
    }

    if (sessions.length > 5) {
      recommendations.push('You have many active sessions. Consider terminating unused ones');
    }

    const highRiskSessions = sessions.filter(s => s.riskScore > 60);
    if (highRiskSessions.length > 0) {
      recommendations.push('Some sessions have high risk scores. Review and terminate if necessary');
    }

    const activeAlerts = alerts.filter(a => a.status === 'ACTIVE');
    if (activeAlerts.length > 0) {
      recommendations.push(`You have ${activeAlerts.length} active security alert(s). Please review them`);
    }

    return recommendations;
  }
}