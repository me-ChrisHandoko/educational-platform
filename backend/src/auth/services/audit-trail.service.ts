import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { 
  AuditEventType,
  AuditCategory,
  AuditSeverity,
  AssessmentType,
  SecurityAlertType,
  AlertSeverity,
  AlertStatus,
  LoginResult
} from '@prisma/client';

export interface AuditEvent {
  userId?: string;
  sessionId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  description?: string;
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
  location?: string;
  riskScore?: number;
  severity?: AuditSeverity;
  beforeData?: any;
  afterData?: any;
  metadata?: any;
  requestPath?: string;
  requestMethod?: string;
  responseStatus?: number;
  processingTime?: number;
}

export interface SecurityAlertInput {
  userId: string;
  sessionId?: string;
  alertType: SecurityAlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  riskScore?: number;
  metadata?: any;
  evidence?: any;
}

export interface LoginAttemptInput {
  email: string;
  userId?: string;
  result: LoginResult;
  resultMessage?: string;
  ipAddress: string;
  userAgent?: string;
  deviceFingerprint?: string;
  location?: string;
  riskScore?: number;
  blocked?: boolean;
  blockReason?: string;
  metadata?: any;
}

export interface RiskAssessmentInput {
  userId: string;
  sessionId?: string;
  assessmentType: AssessmentType;
  overallRiskScore: number;
  deviceRisk: number;
  locationRisk: number;
  behavioralRisk: number;
  temporalRisk: number;
  patternRisk: number;
  riskFactors: any;
  recommendations: any;
  ipAddress?: string;
  deviceFingerprint?: string;
  location?: string;
}

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Log general audit event
   */
  async logAuditEvent(event: AuditEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: event.userId,
          sessionId: event.sessionId,
          action: event.action,
          entity: event.resourceType || 'UNKNOWN',
          entityId: event.resourceId,
          category: this.determineAuditCategory(event.action),
          schoolId: null, // Will be set by context if needed
          oldData: event.beforeData,
          newData: event.afterData,
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          metadata: {
            ...event.metadata,
            deviceFingerprint: event.deviceFingerprint,
            location: event.location,
            riskScore: event.riskScore,
            severity: event.severity,
            requestPath: event.requestPath,
            requestMethod: event.requestMethod,
            responseStatus: event.responseStatus,
            processingTime: event.processingTime
          },
          createdAt: new Date()
        }
      });

      this.logger.debug(`Audit event logged: ${event.action} for user ${event.userId}`);
    } catch (error) {
      this.logger.error('Failed to log audit event:', error);
      // Don't throw to avoid breaking main application flow
    }
  }

  /**
   * Log authentication events
   */
  async logAuthenticationEvent(event: Omit<AuditEvent, 'action'> & { 
    action: 'LOGIN_SUCCESS' | 'LOGIN_FAILURE' | 'LOGOUT' | 'SESSION_EXPIRED' | 'PASSWORD_CHANGE' | 'MFA_ENABLED' | 'MFA_DISABLED'
  }): Promise<void> {
    await this.logAuditEvent({
      ...event,
      resourceType: 'AUTHENTICATION'
    });
  }

  /**
   * Log session events
   */
  async logSessionEvent(event: Omit<AuditEvent, 'action'> & {
    action: 'SESSION_CREATED' | 'SESSION_TERMINATED' | 'SESSION_EXTENDED' | 'SESSION_BLOCKED'
  }): Promise<void> {
    await this.logAuditEvent({
      ...event,
      resourceType: 'SESSION'
    });
  }

  /**
   * Log security events
   */
  async logSecurityEvent(event: Omit<AuditEvent, 'action'> & {
    action: 'RISK_ASSESSMENT' | 'SECURITY_ALERT' | 'ADMIN_ACTION' | 'SUSPICIOUS_ACTIVITY' | 'POLICY_VIOLATION'
  }): Promise<void> {
    await this.logAuditEvent({
      ...event,
      resourceType: 'SECURITY',
      severity: event.severity || AuditSeverity.WARN
    });
  }

  /**
   * Create security alert
   */
  async createSecurityAlert(alert: SecurityAlertInput): Promise<void> {
    try {
      await this.prisma.securityAlert.create({
        data: {
          userId: alert.userId,
          sessionId: alert.sessionId,
          alertType: alert.alertType,
          severity: alert.severity,
          title: alert.title,
          description: alert.description,
          riskScore: alert.riskScore || 0,
          status: AlertStatus.ACTIVE,
          metadata: alert.metadata,
          evidence: alert.evidence
        }
      });

      // Also log as audit event
      await this.logSecurityEvent({
        userId: alert.userId,
        sessionId: alert.sessionId,
        action: 'SECURITY_ALERT',
        description: alert.title,
        riskScore: alert.riskScore,
        severity: this.mapAlertSeverityToAuditSeverity(alert.severity),
        metadata: {
          alertType: alert.alertType,
          ...alert.metadata
        }
      });

      this.logger.warn(`Security alert created: ${alert.title} for user ${alert.userId}`);
    } catch (error) {
      this.logger.error('Failed to create security alert:', error);
      throw error;
    }
  }

  /**
   * Log login attempt
   */
  async logLoginAttempt(attempt: LoginAttemptInput): Promise<void> {
    try {
      await this.prisma.loginAttempt.create({
        data: {
          email: attempt.email,
          userId: attempt.userId,
          result: attempt.result,
          resultMessage: attempt.resultMessage,
          ipAddress: attempt.ipAddress,
          userAgent: attempt.userAgent,
          deviceFingerprint: attempt.deviceFingerprint,
          location: attempt.location,
          riskScore: attempt.riskScore || 0,
          blocked: attempt.blocked || false,
          blockReason: attempt.blockReason,
          metadata: attempt.metadata
        }
      });

      // Also log as audit event
      const isSuccess = attempt.result === LoginResult.SUCCESS;
      await this.logAuthenticationEvent({
        userId: attempt.userId,
        action: isSuccess ? 'LOGIN_SUCCESS' : 'LOGIN_FAILURE',
        description: `Login ${isSuccess ? 'successful' : 'failed'}: ${attempt.resultMessage || attempt.result}`,
        ipAddress: attempt.ipAddress,
        userAgent: attempt.userAgent,
        deviceFingerprint: attempt.deviceFingerprint,
        location: attempt.location,
        riskScore: attempt.riskScore,
        severity: isSuccess ? AuditSeverity.INFO : AuditSeverity.WARN,
        metadata: {
          result: attempt.result,
          blocked: attempt.blocked,
          blockReason: attempt.blockReason,
          ...attempt.metadata
        }
      });

      this.logger.log(`Login attempt logged: ${attempt.result} for ${attempt.email}`);
    } catch (error) {
      this.logger.error('Failed to log login attempt:', error);
      throw error;
    }
  }

  /**
   * Create risk assessment record
   */
  async createRiskAssessment(assessment: RiskAssessmentInput): Promise<void> {
    try {
      await this.prisma.riskAssessment.create({
        data: {
          userId: assessment.userId,
          sessionId: assessment.sessionId,
          assessmentType: assessment.assessmentType,
          overallRiskScore: assessment.overallRiskScore,
          riskLevel: this.calculateRiskLevel(assessment.overallRiskScore),
          deviceRisk: assessment.deviceRisk,
          locationRisk: assessment.locationRisk,
          behavioralRisk: assessment.behavioralRisk,
          temporalRisk: assessment.temporalRisk,
          patternRisk: assessment.patternRisk,
          riskFactors: assessment.riskFactors,
          recommendations: assessment.recommendations,
          ipAddress: assessment.ipAddress,
          deviceFingerprint: assessment.deviceFingerprint,
          location: assessment.location
        }
      });

      // Also log as audit event
      await this.logSecurityEvent({
        userId: assessment.userId,
        sessionId: assessment.sessionId,
        action: 'RISK_ASSESSMENT',
        description: `Risk assessment completed with score ${assessment.overallRiskScore}`,
        riskScore: assessment.overallRiskScore,
        severity: assessment.overallRiskScore >= 70 ? AuditSeverity.ERROR : 
                  assessment.overallRiskScore >= 50 ? AuditSeverity.WARN : AuditSeverity.INFO,
        metadata: {
          assessmentType: assessment.assessmentType,
          riskBreakdown: {
            device: assessment.deviceRisk,
            location: assessment.locationRisk,
            behavioral: assessment.behavioralRisk,
            temporal: assessment.temporalRisk,
            pattern: assessment.patternRisk
          }
        }
      });

      this.logger.log(`Risk assessment created: score ${assessment.overallRiskScore} for user ${assessment.userId}`);
    } catch (error) {
      this.logger.error('Failed to create risk assessment:', error);
      throw error;
    }
  }

  /**
   * Get audit history for user
   */
  async getUserAuditHistory(
    userId: string, 
    options: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
      category?: AuditCategory;
      action?: string;
    } = {}
  ) {
    const where: any = { userId };

    if (options.startDate || options.endDate) {
      where.createdAt = {};
      if (options.startDate) where.createdAt.gte = options.startDate;
      if (options.endDate) where.createdAt.lte = options.endDate;
    }

    if (options.category) where.category = options.category;
    if (options.action) where.action = { contains: options.action };

    const [events, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: options.limit || 50,
        skip: options.offset || 0,
        include: {
          user: {
            select: { id: true, email: true, role: true }
          }
        }
      }),
      this.prisma.auditLog.count({ where })
    ]);

    return { events, total };
  }

  /**
   * Get security alerts for user
   */
  async getUserSecurityAlerts(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      status?: AlertStatus;
      severity?: AlertSeverity;
      alertType?: SecurityAlertType;
    } = {}
  ) {
    const where: any = { userId };

    if (options.status) where.status = options.status;
    if (options.severity) where.severity = options.severity;
    if (options.alertType) where.alertType = options.alertType;

    const [alerts, total] = await Promise.all([
      this.prisma.securityAlert.findMany({
        where,
        orderBy: { triggeredAt: 'desc' },
        take: options.limit || 20,
        skip: options.offset || 0,
        include: {
          user: {
            select: { id: true, email: true, role: true }
          }
        }
      }),
      this.prisma.securityAlert.count({ where })
    ]);

    return { alerts, total };
  }

  /**
   * Get login attempt history
   */
  async getLoginAttemptHistory(
    email: string,
    options: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
      result?: LoginResult;
      ipAddress?: string;
    } = {}
  ) {
    const where: any = { email };

    if (options.startDate || options.endDate) {
      where.attemptedAt = {};
      if (options.startDate) where.attemptedAt.gte = options.startDate;
      if (options.endDate) where.attemptedAt.lte = options.endDate;
    }

    if (options.result) where.result = options.result;
    if (options.ipAddress) where.ipAddress = options.ipAddress;

    const [attempts, total] = await Promise.all([
      this.prisma.loginAttempt.findMany({
        where,
        orderBy: { attemptedAt: 'desc' },
        take: options.limit || 50,
        skip: options.offset || 0,
        include: {
          user: {
            select: { id: true, email: true, role: true }
          }
        }
      }),
      this.prisma.loginAttempt.count({ where })
    ]);

    return { attempts, total };
  }

  /**
   * Get risk assessment history
   */
  async getRiskAssessmentHistory(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      assessmentType?: AssessmentType;
      minRiskScore?: number;
    } = {}
  ) {
    const where: any = { userId };

    if (options.assessmentType) where.assessmentType = options.assessmentType;
    if (options.minRiskScore) where.overallRiskScore = { gte: options.minRiskScore };

    const [assessments, total] = await Promise.all([
      this.prisma.riskAssessment.findMany({
        where,
        orderBy: { assessedAt: 'desc' },
        take: options.limit || 20,
        skip: options.offset || 0
      }),
      this.prisma.riskAssessment.count({ where })
    ]);

    return { assessments, total };
  }

  /**
   * Resolve security alert
   */
  async resolveSecurityAlert(
    alertId: string,
    resolvedBy: string,
    resolutionNotes?: string
  ): Promise<void> {
    await this.prisma.securityAlert.update({
      where: { id: alertId },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedBy,
        resolutionNotes
      }
    });

    await this.logSecurityEvent({
      userId: resolvedBy,
      action: 'ADMIN_ACTION',
      description: `Security alert resolved: ${alertId}`,
      metadata: {
        action: 'RESOLVE_ALERT',
        alertId,
        resolutionNotes
      }
    });
  }

  /**
   * Get audit statistics
   */
  async getAuditStatistics(
    userId?: string,
    timeframe: 'hour' | 'day' | 'week' | 'month' = 'day'
  ) {
    const now = new Date();
    const startDate = new Date();

    switch (timeframe) {
      case 'hour':
        startDate.setHours(now.getHours() - 1);
        break;
      case 'day':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
    }

    const where = userId ? { userId, createdAt: { gte: startDate } } : { createdAt: { gte: startDate } };

    const [
      totalEvents,
      authenticationEvents,
      securityEvents,
      failedLogins,
      activeAlerts,
      highRiskAssessments
    ] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.count({ 
        where: { ...where, category: AuditCategory.AUTHENTICATION } 
      }),
      this.prisma.auditLog.count({ 
        where: { ...where, category: AuditCategory.SECURITY } 
      }),
      this.prisma.loginAttempt.count({
        where: {
          ...(userId ? { userId } : {}),
          attemptedAt: { gte: startDate },
          result: { not: LoginResult.SUCCESS }
        }
      }),
      this.prisma.securityAlert.count({
        where: {
          ...(userId ? { userId } : {}),
          triggeredAt: { gte: startDate },
          status: AlertStatus.ACTIVE
        }
      }),
      this.prisma.riskAssessment.count({
        where: {
          ...(userId ? { userId } : {}),
          assessedAt: { gte: startDate },
          overallRiskScore: { gte: 70 }
        }
      })
    ]);

    return {
      timeframe,
      totalEvents,
      authenticationEvents,
      securityEvents,
      failedLogins,
      activeAlerts,
      highRiskAssessments,
      securityScore: this.calculateSecurityScore({
        authenticationEvents,
        failedLogins,
        activeAlerts,
        highRiskAssessments
      })
    };
  }

  /**
   * Private helper methods
   */
  private determineAuditCategory(action: string): AuditCategory {
    if (action.includes('LOGIN') || action.includes('AUTH') || action.includes('PASSWORD')) {
      return AuditCategory.AUTHENTICATION;
    }
    if (action.includes('SECURITY') || action.includes('RISK') || action.includes('ALERT')) {
      return AuditCategory.SECURITY;
    }
    if (action.includes('ADMIN')) {
      return AuditCategory.ADMINISTRATIVE;
    }
    return AuditCategory.GENERAL;
  }

  private calculateRiskLevel(score: number) {
    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 30) return 'MEDIUM';
    return 'LOW';
  }

  private mapAlertSeverityToAuditSeverity(alertSeverity: AlertSeverity): AuditSeverity {
    switch (alertSeverity) {
      case AlertSeverity.LOW:
        return AuditSeverity.INFO;
      case AlertSeverity.MEDIUM:
        return AuditSeverity.WARN;
      case AlertSeverity.HIGH:
        return AuditSeverity.ERROR;
      case AlertSeverity.CRITICAL:
        return AuditSeverity.CRITICAL;
      default:
        return AuditSeverity.INFO;
    }
  }

  private calculateSecurityScore(metrics: {
    authenticationEvents: number;
    failedLogins: number;
    activeAlerts: number;
    highRiskAssessments: number;
  }): number {
    let score = 100;

    // Deduct points for security issues
    score -= Math.min(metrics.failedLogins * 2, 30); // Up to 30 points for failed logins
    score -= Math.min(metrics.activeAlerts * 5, 40); // Up to 40 points for active alerts  
    score -= Math.min(metrics.highRiskAssessments * 3, 30); // Up to 30 points for high risk

    return Math.max(score, 0);
  }
}