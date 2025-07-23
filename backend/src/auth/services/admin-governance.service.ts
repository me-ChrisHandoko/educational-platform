import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseSessionService } from './enterprise-session.service';
import { AuditTrailService } from './audit-trail.service';
import { SecurityMonitoringService } from './security-monitoring.service';
import { 
  UserRole, 
  SessionStatus, 
  AlertStatus, 
  AlertSeverity,
  SecurityAlertType,
  DeviceTrustLevel,
  RiskLevel
} from '@prisma/client';

export interface AdminDashboardMetrics {
  overview: {
    totalUsers: number;
    activeUsers: number;
    adminUsers: number;
    suspendedUsers: number;
  };
  sessions: {
    totalActiveSessions: number;
    highRiskSessions: number;
    sessionsByRole: Record<string, number>;
    deviceTrustDistribution: Record<string, number>;
  };
  security: {
    activeAlerts: number;
    criticalAlerts: number;
    riskAssessments: number;
    failedLogins: number;
  };
  system: {
    healthScore: number;
    averageRiskScore: number;
    systemLoad: number;
    lastUpdated: Date;
  };
}

export interface UserManagementSummary {
  userId: string;
  email: string;
  role: UserRole;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  activeSessions: number;
  securityScore: number;
  riskLevel: RiskLevel;
  totalFailedLogins: number;
  trustedDevices: number;
  activeAlerts: number;
  flags: string[];
}

export interface SecurityIncident {
  id: string;
  type: SecurityAlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  userId?: string;
  userEmail?: string;
  affectedUsers: number;
  status: AlertStatus;
  triggeredAt: Date;
  riskScore: number;
  metadata: any;
  recommendations: string[];
}

export interface ComplianceReport {
  period: {
    startDate: Date;
    endDate: Date;
    generatedAt: Date;
  };
  metrics: {
    totalAuditEvents: number;
    securityIncidents: number;
    dataAccessRequests: number;
    privilegedOperations: number;
    failedAuthentications: number;
  };
  compliance: {
    dataRetention: {
      compliant: boolean;
      retentionPeriodDays: number;
      oldestRecord: Date;
    };
    accessControl: {
      privilegedAccess: number;
      roleCompliance: number;
      unusedAccounts: number;
    };
    monitoring: {
      alertResponseTime: number;
      incidentResolutionTime: number;
      auditCoverage: number;
    };
  };
  recommendations: string[];
}

@Injectable()
export class AdminGovernanceService {
  private readonly logger = new Logger(AdminGovernanceService.name);

  constructor(
    private prisma: PrismaService,
    private enterpriseSessionService: EnterpriseSessionService,
    private auditTrailService: AuditTrailService,
    private securityMonitoringService: SecurityMonitoringService,
  ) {}

  /**
   * Get comprehensive admin dashboard metrics
   */
  async getDashboardMetrics(): Promise<AdminDashboardMetrics> {
    const [
      userMetrics,
      sessionMetrics,
      securityMetrics,
      systemHealth
    ] = await Promise.all([
      this.getUserMetrics(),
      this.getSessionMetrics(),
      this.getSecurityMetrics(),
      this.securityMonitoringService.getSystemHealth()
    ]);

    return {
      overview: userMetrics,
      sessions: sessionMetrics,
      security: securityMetrics,
      system: {
        healthScore: systemHealth.healthScore,
        averageRiskScore: systemHealth.averageRiskScore,
        systemLoad: systemHealth.systemLoad,
        lastUpdated: new Date()
      }
    };
  }

  /**
   * Get comprehensive user management data
   */
  async getUserManagementData(
    page: number = 1,
    limit: number = 50,
    role?: UserRole,
    riskLevel?: RiskLevel,
    sortBy: 'securityScore' | 'lastLogin' | 'riskLevel' = 'securityScore'
  ): Promise<{ users: UserManagementSummary[]; total: number; page: number; limit: number }> {
    const offset = (page - 1) * limit;
    const whereClause: any = {};

    if (role) whereClause.role = role;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        take: limit,
        skip: offset,
        include: {
          sessions: {
            where: { isActive: true, status: SessionStatus.ACTIVE }
          },
          securityAlerts: {
            where: { status: AlertStatus.ACTIVE }
          },
          trustedDevices: {
            where: { isActive: true }
          },
          loginAttempts: {
            where: {
              attemptedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              result: { not: 'SUCCESS' }
            }
          }
        }
      }),
      this.prisma.user.count({ where: whereClause })
    ]);

    const userSummaries = await Promise.all(
      users.map(async (user) => {
        const securityScore = this.calculateUserSecurityScore(user);
        const userRiskLevel = this.calculateUserRiskLevel(securityScore);
        const flags = this.generateUserFlags(user, securityScore);

        return {
          userId: user.id,
          email: user.email,
          role: user.role as UserRole,
          status: user.status,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          activeSessions: user.sessions.length,
          securityScore,
          riskLevel: userRiskLevel,
          totalFailedLogins: user.loginAttempts.length,
          trustedDevices: user.trustedDevices.length,
          activeAlerts: user.securityAlerts.length,
          flags
        };
      })
    );

    // Sort users based on criteria
    userSummaries.sort((a, b) => {
      switch (sortBy) {
        case 'securityScore':
          return a.securityScore - b.securityScore; // Lower score = higher risk
        case 'riskLevel':
          const riskOrder = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
          return riskOrder[b.riskLevel] - riskOrder[a.riskLevel];
        case 'lastLogin':
          return (b.lastLoginAt?.getTime() || 0) - (a.lastLoginAt?.getTime() || 0);
        default:
          return 0;
      }
    });

    return {
      users: userSummaries,
      total,
      page,
      limit
    };
  }

  /**
   * Get security incidents requiring admin attention
   */
  async getSecurityIncidents(
    severity?: AlertSeverity,
    status?: AlertStatus,
    limit: number = 20
  ): Promise<SecurityIncident[]> {
    const whereClause: any = {};
    if (severity) whereClause.severity = severity;
    if (status) whereClause.status = status;

    const alerts = await this.prisma.securityAlert.findMany({
      where: whereClause,
      orderBy: [
        { severity: 'desc' },
        { triggeredAt: 'desc' }
      ],
      take: limit,
      include: {
        user: {
          select: { email: true }
        }
      }
    });

    return alerts.map(alert => ({
      id: alert.id,
      type: alert.alertType,
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
      userId: alert.userId,
      userEmail: alert.user?.email,
      affectedUsers: 1, // Could be calculated differently for system-wide incidents
      status: alert.status,
      triggeredAt: alert.triggeredAt,
      riskScore: alert.riskScore,
      metadata: alert.metadata,
      recommendations: this.generateIncidentRecommendations(alert)
    }));
  }

  /**
   * Force terminate user sessions (admin action)
   */
  async forceTerminateUserSessions(
    userId: string,
    adminUserId: string,
    reason: string = 'ADMIN_ACTION'
  ): Promise<number> {
    const terminatedCount = await this.enterpriseSessionService.terminateAllUserSessions(userId, reason);

    await this.auditTrailService.logSecurityEvent({
      userId: adminUserId,
      action: 'ADMIN_ACTION',
      description: `Admin terminated all sessions for user ${userId}`,
      metadata: {
        action: 'FORCE_TERMINATE_SESSIONS',
        targetUserId: userId,
        terminatedSessions: terminatedCount,
        reason
      }
    });

    return terminatedCount;
  }

  /**
   * Suspend user account
   */
  async suspendUser(userId: string, adminUserId: string, reason: string): Promise<void> {
    // Update user status
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'SUSPENDED',
        // Note: User model only has status field
        // Suspension details would need to be tracked in separate table
      }
    });

    // Terminate all active sessions
    await this.forceTerminateUserSessions(userId, adminUserId, 'USER_SUSPENDED');

    // Create security alert
    await this.auditTrailService.createSecurityAlert({
      userId,
      alertType: SecurityAlertType.ACCOUNT_SUSPENDED,
      severity: AlertSeverity.HIGH,
      title: 'User Account Suspended',
      description: `Account suspended by admin: ${reason}`,
      metadata: {
        suspendedBy: adminUserId,
        reason
      }
    });

    await this.auditTrailService.logSecurityEvent({
      userId: adminUserId,
      action: 'ADMIN_ACTION',
      description: `Admin suspended user account ${userId}`,
      metadata: {
        action: 'SUSPEND_USER',
        targetUserId: userId,
        reason
      }
    });
  }

  /**
   * Reactivate suspended user
   */
  async reactivateUser(userId: string, adminUserId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'ACTIVE',
        suspendedAt: null,
        suspendedBy: null,
        suspensionReason: null,
        reactivatedAt: new Date(),
        reactivatedBy: adminUserId
      }
    });

    await this.auditTrailService.logSecurityEvent({
      userId: adminUserId,
      action: 'ADMIN_ACTION',
      description: `Admin reactivated user account ${userId}`,
      metadata: {
        action: 'REACTIVATE_USER',
        targetUserId: userId
      }
    });
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceReport> {
    const [metrics, complianceData] = await Promise.all([
      this.getComplianceMetrics(startDate, endDate),
      this.getComplianceData(startDate, endDate)
    ]);

    const report: ComplianceReport = {
      period: {
        startDate,
        endDate,
        generatedAt: new Date()
      },
      metrics,
      compliance: complianceData,
      recommendations: this.generateComplianceRecommendations(metrics, complianceData)
    };

    // Log report generation
    await this.auditTrailService.logSecurityEvent({
      userId: 'system',
      action: 'COMPLIANCE_REPORT_GENERATED',
      description: 'Compliance report generated for admin review',
      metadata: {
        reportPeriod: { startDate, endDate },
        metricsCount: Object.keys(metrics).length
      }
    });

    return report;
  }

  /**
   * Bulk user operations
   */
  async bulkUserOperation(
    operation: 'suspend' | 'reactivate' | 'terminate_sessions',
    userIds: string[],
    adminUserId: string,
    reason?: string
  ): Promise<{ success: string[]; failed: string[]; errors: Record<string, string> }> {
    const results = { success: [], failed: [], errors: {} };

    for (const userId of userIds) {
      try {
        switch (operation) {
          case 'suspend':
            await this.suspendUser(userId, adminUserId, reason || 'Bulk operation');
            results.success.push(userId);
            break;
          case 'reactivate':
            await this.reactivateUser(userId, adminUserId);
            results.success.push(userId);
            break;
          case 'terminate_sessions':
            await this.forceTerminateUserSessions(userId, adminUserId, 'BULK_ADMIN_ACTION');
            results.success.push(userId);
            break;
        }
      } catch (error) {
        results.failed.push(userId);
        results.errors[userId] = error.message;
      }
    }

    await this.auditTrailService.logSecurityEvent({
      userId: adminUserId,
      action: 'ADMIN_ACTION',
      description: `Bulk ${operation} operation performed`,
      metadata: {
        operation,
        totalUsers: userIds.length,
        successCount: results.success.length,
        failedCount: results.failed.length,
        reason
      }
    });

    return results;
  }

  /**
   * Private helper methods
   */
  private async getUserMetrics() {
    const [totalUsers, activeUsers, adminUsers, suspendedUsers] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ 
        where: { 
          role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
          status: 'ACTIVE'
        } 
      }),
      this.prisma.user.count({ where: { status: 'SUSPENDED' } })
    ]);

    return { totalUsers, activeUsers, adminUsers, suspendedUsers };
  }

  private async getSessionMetrics() {
    const [totalActiveSessions, highRiskSessions, sessionsByRole, deviceTrustData] = await Promise.all([
      this.prisma.session.count({ 
        where: { isActive: true, status: SessionStatus.ACTIVE } 
      }),
      this.prisma.session.count({
        where: { 
          isActive: true, 
          status: SessionStatus.ACTIVE,
          riskScore: { gte: 70 }
        }
      }),
      this.getSessionsByRole(),
      this.getDeviceTrustDistribution()
    ]);

    return {
      totalActiveSessions,
      highRiskSessions,
      sessionsByRole,
      deviceTrustDistribution: deviceTrustData
    };
  }

  private async getSecurityMetrics() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const [activeAlerts, criticalAlerts, riskAssessments, failedLogins] = await Promise.all([
      this.prisma.securityAlert.count({ where: { status: AlertStatus.ACTIVE } }),
      this.prisma.securityAlert.count({ 
        where: { 
          status: AlertStatus.ACTIVE,
          severity: AlertSeverity.CRITICAL
        } 
      }),
      this.prisma.riskAssessment.count({
        where: { assessedAt: { gte: oneHourAgo } }
      }),
      this.prisma.loginAttempt.count({
        where: {
          attemptedAt: { gte: oneHourAgo },
          result: { not: 'SUCCESS' }
        }
      })
    ]);

    return { activeAlerts, criticalAlerts, riskAssessments, failedLogins };
  }

  private async getSessionsByRole() {
    const sessions = await this.prisma.session.findMany({
      where: { isActive: true, status: SessionStatus.ACTIVE },
      include: { user: { select: { role: true } } }
    });

    return sessions.reduce((acc, session) => {
      const role = session.user.role;
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private async getDeviceTrustDistribution() {
    const devices = await this.prisma.trustedDevice.groupBy({
      by: ['trustLevel'],
      where: { isActive: true },
      _count: { trustLevel: true }
    });

    return devices.reduce((acc, device) => {
      acc[device.trustLevel] = device._count.trustLevel;
      return acc;
    }, {} as Record<string, number>);
  }

  private calculateUserSecurityScore(user: any): number {
    let score = 100;

    // Deduct for security issues
    score -= Math.min(user.securityAlerts.length * 10, 30);
    score -= Math.min(user.loginAttempts.length * 2, 20);
    score -= user.sessions.length > 3 ? 10 : 0;

    // Add for positive security factors
    score += user.trustedDevices.length > 0 ? 10 : 0;
    score += user.lastLoginAt && user.lastLoginAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) ? 5 : 0;

    return Math.max(score, 0);
  }

  private calculateUserRiskLevel(securityScore: number): RiskLevel {
    if (securityScore < 50) return RiskLevel.CRITICAL;
    if (securityScore < 70) return RiskLevel.HIGH;
    if (securityScore < 85) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private generateUserFlags(user: any, securityScore: number): string[] {
    const flags = [];

    if (securityScore < 50) flags.push('CRITICAL_RISK');
    if (user.securityAlerts.length > 2) flags.push('MULTIPLE_ALERTS');
    if (user.loginAttempts.length > 5) flags.push('FAILED_LOGINS');
    if (user.sessions.length > 5) flags.push('MANY_SESSIONS');
    if (user.trustedDevices.length === 0) flags.push('NO_TRUSTED_DEVICES');
    if (!user.lastLoginAt || user.lastLoginAt < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) {
      flags.push('INACTIVE');
    }

    return flags;
  }

  private generateIncidentRecommendations(alert: any): string[] {
    const recommendations = [];

    switch (alert.alertType) {
      case SecurityAlertType.HIGH_RISK_LOGIN:
        recommendations.push('Review user activity patterns');
        recommendations.push('Consider requiring additional verification');
        break;
      case SecurityAlertType.BRUTE_FORCE_ATTEMPT:
        recommendations.push('Temporarily block the source IP address');
        recommendations.push('Increase monitoring for this user account');
        break;
      case SecurityAlertType.NEW_DEVICE:
        recommendations.push('Verify device ownership with user');
        recommendations.push('Consider device verification workflow');
        break;
      default:
        recommendations.push('Investigate the security event');
        recommendations.push('Review related user activity');
    }

    return recommendations;
  }

  private async getComplianceMetrics(startDate: Date, endDate: Date) {
    const [
      totalAuditEvents,
      securityIncidents,
      dataAccessRequests,
      privilegedOperations,
      failedAuthentications
    ] = await Promise.all([
      this.prisma.auditLog.count({
        where: { createdAt: { gte: startDate, lte: endDate } }
      }),
      this.prisma.securityAlert.count({
        where: { triggeredAt: { gte: startDate, lte: endDate } }
      }),
      this.prisma.auditLog.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          action: { contains: 'DATA_ACCESS' }
        }
      }),
      this.prisma.auditLog.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          category: 'ADMINISTRATIVE'
        }
      }),
      this.prisma.loginAttempt.count({
        where: {
          attemptedAt: { gte: startDate, lte: endDate },
          result: { not: 'SUCCESS' }
        }
      })
    ]);

    return {
      totalAuditEvents,
      securityIncidents,
      dataAccessRequests,
      privilegedOperations,
      failedAuthentications
    };
  }

  private async getComplianceData(startDate: Date, endDate: Date) {
    // This would implement actual compliance checks
    return {
      dataRetention: {
        compliant: true,
        retentionPeriodDays: 365,
        oldestRecord: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      },
      accessControl: {
        privilegedAccess: 5,
        roleCompliance: 98,
        unusedAccounts: 2
      },
      monitoring: {
        alertResponseTime: 15, // minutes
        incidentResolutionTime: 120, // minutes
        auditCoverage: 95 // percentage
      }
    };
  }

  private generateComplianceRecommendations(metrics: any, compliance: any): string[] {
    const recommendations = [];

    if (compliance.accessControl.unusedAccounts > 0) {
      recommendations.push(`Review and disable ${compliance.accessControl.unusedAccounts} unused accounts`);
    }

    if (metrics.securityIncidents > 10) {
      recommendations.push('High number of security incidents - review security policies');
    }

    if (compliance.monitoring.alertResponseTime > 30) {
      recommendations.push('Improve alert response times - current average exceeds 30 minutes');
    }

    if (compliance.monitoring.auditCoverage < 90) {
      recommendations.push('Increase audit coverage to meet compliance requirements');
    }

    return recommendations;
  }
}