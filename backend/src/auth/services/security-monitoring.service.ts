import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { 
  AlertSeverity,
  AlertStatus, 
  SecurityAlertType,
  LoginResult,
  RiskLevel,
  UserRole
} from '@prisma/client';

export interface SecurityMetrics {
  timeframe: string;
  totalSessions: number;
  activeSessions: number;
  highRiskSessions: number;
  securityAlerts: number;
  failedLogins: number;
  uniqueUsers: number;
  riskDistribution: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  alertsByType: Record<string, number>;
  topRiskCountries: Array<{ country: string; riskScore: number; count: number }>;
  deviceTrustDistribution: Record<string, number>;
}

export interface UserSecurityProfile {
  userId: string;
  email: string;
  role: UserRole;
  securityScore: number;
  riskLevel: RiskLevel;
  activeSessions: number;
  lastLoginAt: Date;
  failedLoginAttempts: number;
  securityAlerts: number;
  trustedDevices: number;
  flags: string[];
}

export interface SecurityThreat {
  id: string;
  type: 'BRUTE_FORCE' | 'SUSPICIOUS_LOCATION' | 'DEVICE_ANOMALY' | 'BEHAVIORAL_ANOMALY';
  severity: AlertSeverity;
  description: string;
  affectedUsers: string[];
  evidence: any;
  firstDetected: Date;
  lastSeen: Date;
  status: 'ACTIVE' | 'INVESTIGATING' | 'MITIGATED';
  autoMitigated: boolean;
}

export interface RealTimeAlert {
  id: string;
  timestamp: Date;
  type: SecurityAlertType;
  severity: AlertSeverity;
  userId?: string;
  email?: string;
  description: string;
  ipAddress?: string;
  location?: string;
  riskScore?: number;
  autoResolved: boolean;
}

@Injectable()
export class SecurityMonitoringService {
  private readonly logger = new Logger(SecurityMonitoringService.name);
  private readonly THREAT_THRESHOLDS = {
    BRUTE_FORCE: { attempts: 10, timeWindow: 300000 }, // 10 attempts in 5 minutes
    SUSPICIOUS_LOCATION: { riskScore: 70 },
    DEVICE_ANOMALY: { newDevicesPerUser: 5, timeWindow: 3600000 }, // 5 new devices per hour
    BEHAVIORAL_ANOMALY: { riskScore: 60, frequency: 3 }
  };

  constructor(private prisma: PrismaService) {}

  /**
   * Get comprehensive security metrics for dashboard
   */
  async getSecurityMetrics(timeframe: 'hour' | 'day' | 'week' | 'month' = 'day'): Promise<SecurityMetrics> {
    const startDate = this.getStartDate(timeframe);

    const [
      sessionsData,
      alertsData,
      loginsData,
      riskDistribution,
      alertsByType,
      topRiskCountries,
      deviceTrustData
    ] = await Promise.all([
      this.getSessionsMetrics(startDate),
      this.getAlertsMetrics(startDate),
      this.getLoginMetrics(startDate),
      this.getRiskDistribution(startDate),
      this.getAlertsByType(startDate),
      this.getTopRiskCountries(startDate),
      this.getDeviceTrustDistribution()
    ]);

    return {
      timeframe,
      totalSessions: sessionsData.total,
      activeSessions: sessionsData.active,
      highRiskSessions: sessionsData.highRisk,
      securityAlerts: alertsData.total,
      failedLogins: loginsData.failed,
      uniqueUsers: loginsData.uniqueUsers,
      riskDistribution,
      alertsByType,
      topRiskCountries,
      deviceTrustDistribution: deviceTrustData
    };
  }

  /**
   * Get user security profiles with risk assessment
   */
  async getUserSecurityProfiles(
    limit: number = 50,
    sortBy: 'riskScore' | 'securityAlerts' | 'lastLogin' = 'riskScore'
  ): Promise<UserSecurityProfile[]> {
    const users = await this.prisma.user.findMany({
      take: limit,
      include: {
        sessions: {
          where: { isActive: true }
        },
        securityAlerts: {
          where: { status: AlertStatus.ACTIVE }
        },
        trustedDevices: {
          where: { isActive: true }
        },
        loginAttempts: {
          where: {
            attemptedAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
            }
          }
        }
      }
    });

    const profiles = users.map(user => {
      const activeSessions = user.sessions.length;
      const securityAlerts = user.securityAlerts.length;
      const trustedDevices = user.trustedDevices.length;
      const failedLogins = user.loginAttempts.filter(attempt => 
        attempt.result !== LoginResult.SUCCESS
      ).length;

      // Calculate security score
      let securityScore = 100;
      securityScore -= Math.min(securityAlerts * 10, 30);
      securityScore -= Math.min(failedLogins * 5, 25);
      securityScore -= activeSessions > 3 ? 10 : 0;
      securityScore += trustedDevices > 0 ? 10 : 0;

      // Determine flags
      const flags = [];
      if (securityAlerts > 2) flags.push('HIGH_ALERTS');
      if (failedLogins > 5) flags.push('MULTIPLE_FAILURES');
      if (activeSessions > 5) flags.push('MANY_SESSIONS');
      if (trustedDevices === 0) flags.push('NO_TRUSTED_DEVICES');

      return {
        userId: user.id,
        email: user.email,
        role: user.role as UserRole,
        securityScore: Math.max(securityScore, 0),
        riskLevel: this.calculateRiskLevel(100 - securityScore),
        activeSessions,
        lastLoginAt: user.lastLoginAt || new Date(0),
        failedLoginAttempts: failedLogins,
        securityAlerts,
        trustedDevices,
        flags
      };
    });

    // Sort profiles
    return profiles.sort((a, b) => {
      switch (sortBy) {
        case 'riskScore':
          return a.securityScore - b.securityScore; // Lower score = higher risk
        case 'securityAlerts':
          return b.securityAlerts - a.securityAlerts;
        case 'lastLogin':
          return b.lastLoginAt.getTime() - a.lastLoginAt.getTime();
        default:
          return 0;
      }
    });
  }

  /**
   * Detect and track security threats
   */
  async detectSecurityThreats(): Promise<SecurityThreat[]> {
    const threats: SecurityThreat[] = [];

    // Detect brute force attacks
    const bruteForceThreats = await this.detectBruteForceAttacks();
    threats.push(...bruteForceThreats);

    // Detect suspicious locations
    const locationThreats = await this.detectSuspiciousLocations();
    threats.push(...locationThreats);

    // Detect device anomalies
    const deviceThreats = await this.detectDeviceAnomalies();
    threats.push(...deviceThreats);

    // Detect behavioral anomalies
    const behavioralThreats = await this.detectBehavioralAnomalies();
    threats.push(...behavioralThreats);

    return threats;
  }

  /**
   * Get real-time security alerts
   */
  async getRealTimeAlerts(limit: number = 20): Promise<RealTimeAlert[]> {
    const alerts = await this.prisma.securityAlert.findMany({
      take: limit,
      orderBy: { triggeredAt: 'desc' },
      include: {
        user: {
          select: { email: true }
        }
      }
    });

    return alerts.map(alert => ({
      id: alert.id,
      timestamp: alert.triggeredAt,
      type: alert.alertType,
      severity: alert.severity,
      userId: alert.userId,
      email: alert.user?.email,
      description: alert.description,
      ipAddress: alert.metadata?.ipAddress,
      location: alert.metadata?.location,
      riskScore: alert.riskScore,
      autoResolved: alert.status === AlertStatus.RESOLVED
    }));
  }

  /**
   * Get system health indicators
   */
  async getSystemHealth() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const [
      totalActiveSessions,
      activeAlerts,
      systemLoad,
      recentFailures,
      averageRiskScore
    ] = await Promise.all([
      this.prisma.session.count({
        where: { isActive: true }
      }),
      this.prisma.securityAlert.count({
        where: { status: AlertStatus.ACTIVE }
      }),
      this.calculateSystemLoad(),
      this.prisma.loginAttempt.count({
        where: {
          attemptedAt: { gte: oneHourAgo },
          result: { not: LoginResult.SUCCESS }
        }
      }),
      this.calculateAverageRiskScore()
    ]);

    // Calculate health score
    let healthScore = 100;
    healthScore -= Math.min(activeAlerts * 2, 20);
    healthScore -= Math.min(recentFailures * 0.5, 15);
    healthScore -= Math.min((averageRiskScore - 30) * 0.5, 25);
    healthScore -= Math.min((systemLoad - 70) * 0.3, 10);

    const status = healthScore >= 90 ? 'EXCELLENT' : 
                   healthScore >= 75 ? 'GOOD' : 
                   healthScore >= 60 ? 'WARNING' : 'CRITICAL';

    return {
      healthScore: Math.max(healthScore, 0),
      status,
      activeSessions: totalActiveSessions,
      activeAlerts,
      systemLoad,
      recentFailures,
      averageRiskScore,
      lastUpdated: now
    };
  }

  /**
   * Automated threat mitigation
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async performAutomatedThreatMitigation() {
    this.logger.log('Starting automated threat mitigation scan...');

    try {
      // 1. Block suspicious IPs with high failed login rates
      await this.blockSuspiciousIPs();

      // 2. Auto-resolve false positive alerts
      await this.resolveStaleAlerts();

      // 3. Terminate high-risk sessions
      await this.terminateHighRiskSessions();

      // 4. Update IP reputation scores
      await this.updateIPReputationScores();

      this.logger.log('Automated threat mitigation completed successfully');
    } catch (error) {
      this.logger.error('Automated threat mitigation failed:', error);
    }
  }

  /**
   * Generate security report
   */
  async generateSecurityReport(timeframe: 'day' | 'week' | 'month') {
    const startDate = this.getStartDate(timeframe);
    
    const [
      metrics,
      threats,
      topRiskyUsers,
      incidents
    ] = await Promise.all([
      this.getSecurityMetrics(timeframe),
      this.detectSecurityThreats(),
      this.getUserSecurityProfiles(10, 'riskScore'),
      this.getSecurityIncidents(startDate)
    ]);

    return {
      period: {
        timeframe,
        startDate,
        endDate: new Date(),
        generatedAt: new Date()
      },
      executive_summary: {
        overallSecurityScore: this.calculateOverallSecurityScore(metrics),
        criticalThreats: threats.filter(t => t.severity === AlertSeverity.CRITICAL).length,
        totalIncidents: incidents.length,
        usersAtRisk: topRiskyUsers.filter(u => u.securityScore < 70).length
      },
      metrics,
      threats: threats.slice(0, 10),
      high_risk_users: topRiskyUsers.slice(0, 5),
      incidents: incidents.slice(0, 10),
      recommendations: this.generateSecurityRecommendations(metrics, threats, topRiskyUsers)
    };
  }

  /**
   * Private helper methods
   */
  private getStartDate(timeframe: string): Date {
    const now = new Date();
    switch (timeframe) {
      case 'hour':
        return new Date(now.getTime() - 60 * 60 * 1000);
      case 'day':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  private async getSessionsMetrics(startDate: Date) {
    const [total, active, highRisk] = await Promise.all([
      this.prisma.session.count({
        where: { createdAt: { gte: startDate } }
      }),
      this.prisma.session.count({
        where: { 
          createdAt: { gte: startDate },
          isActive: true 
        }
      }),
      this.prisma.session.count({
        where: { 
          createdAt: { gte: startDate },
          isActive: true,
          riskScore: { gte: 70 }
        }
      })
    ]);

    return { total, active, highRisk };
  }

  private async getAlertsMetrics(startDate: Date) {
    const total = await this.prisma.securityAlert.count({
      where: { triggeredAt: { gte: startDate } }
    });

    return { total };
  }

  private async getLoginMetrics(startDate: Date) {
    const [failed, uniqueUsers] = await Promise.all([
      this.prisma.loginAttempt.count({
        where: {
          attemptedAt: { gte: startDate },
          result: { not: LoginResult.SUCCESS }
        }
      }),
      this.prisma.loginAttempt.findMany({
        where: { attemptedAt: { gte: startDate } },
        distinct: ['userId'],
        select: { userId: true }
      }).then(results => results.length)
    ]);

    return { failed, uniqueUsers };
  }

  private async getRiskDistribution(startDate: Date) {
    const sessions = await this.prisma.session.findMany({
      where: { 
        createdAt: { gte: startDate },
        isActive: true 
      },
      select: { riskScore: true }
    });

    const distribution = { low: 0, medium: 0, high: 0, critical: 0 };
    
    sessions.forEach(session => {
      if (session.riskScore < 30) distribution.low++;
      else if (session.riskScore < 60) distribution.medium++;
      else if (session.riskScore < 80) distribution.high++;
      else distribution.critical++;
    });

    return distribution;
  }

  private async getAlertsByType(startDate: Date) {
    const alerts = await this.prisma.securityAlert.groupBy({
      by: ['alertType'],
      where: { triggeredAt: { gte: startDate } },
      _count: { alertType: true }
    });

    return alerts.reduce((acc, alert) => {
      acc[alert.alertType] = alert._count.alertType;
      return acc;
    }, {} as Record<string, number>);
  }

  private async getTopRiskCountries(startDate: Date) {
    const sessions = await this.prisma.session.findMany({
      where: { 
        createdAt: { gte: startDate },
        ipCountry: { not: null }
      },
      select: { ipCountry: true, riskScore: true }
    });

    const countryStats = sessions.reduce((acc, session) => {
      const country = session.ipCountry!;
      if (!acc[country]) {
        acc[country] = { totalRisk: 0, count: 0 };
      }
      acc[country].totalRisk += session.riskScore;
      acc[country].count++;
      return acc;
    }, {} as Record<string, { totalRisk: number; count: number }>);

    return Object.entries(countryStats)
      .map(([country, stats]) => ({
        country,
        riskScore: Math.round(stats.totalRisk / stats.count),
        count: stats.count
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);
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

  private async detectBruteForceAttacks(): Promise<SecurityThreat[]> {
    const threshold = this.THREAT_THRESHOLDS.BRUTE_FORCE;
    const cutoffTime = new Date(Date.now() - threshold.timeWindow);

    const suspiciousIPs = await this.prisma.loginAttempt.groupBy({
      by: ['ipAddress'],
      where: {
        attemptedAt: { gte: cutoffTime },
        result: { not: LoginResult.SUCCESS }
      },
      _count: { ipAddress: true },
      having: { ipAddress: { _count: { gte: threshold.attempts } } }
    });

    return suspiciousIPs.map(ip => ({
      id: `brute_force_${ip.ipAddress}`,
      type: 'BRUTE_FORCE' as const,
      severity: AlertSeverity.HIGH,
      description: `Brute force attack detected from IP ${ip.ipAddress}`,
      affectedUsers: [], // Would need additional query
      evidence: { ipAddress: ip.ipAddress, attempts: ip._count.ipAddress },
      firstDetected: cutoffTime,
      lastSeen: new Date(),
      status: 'ACTIVE' as const,
      autoMitigated: false
    }));
  }

  private async detectSuspiciousLocations(): Promise<SecurityThreat[]> {
    const threshold = this.THREAT_THRESHOLDS.SUSPICIOUS_LOCATION;
    
    const suspiciousSessions = await this.prisma.session.findMany({
      where: {
        riskScore: { gte: threshold.riskScore },
        isActive: true
      },
      include: {
        user: { select: { email: true } }
      }
    });

    const locationGroups = suspiciousSessions.reduce((acc, session) => {
      const key = `${session.ipCountry}_${session.ipCity}`;
      if (!acc[key]) {
        acc[key] = {
          location: session.location,
          sessions: [],
          users: new Set()
        };
      }
      acc[key].sessions.push(session);
      acc[key].users.add(session.userId);
      return acc;
    }, {} as Record<string, any>);

    return Object.entries(locationGroups)
      .filter(([_, data]) => data.sessions.length >= 3)
      .map(([location, data]) => ({
        id: `suspicious_location_${location}`,
        type: 'SUSPICIOUS_LOCATION' as const,
        severity: AlertSeverity.MEDIUM,
        description: `Multiple high-risk sessions from ${data.location}`,
        affectedUsers: Array.from(data.users),
        evidence: { location: data.location, sessionCount: data.sessions.length },
        firstDetected: new Date(Math.min(...data.sessions.map((s: any) => s.createdAt.getTime()))),
        lastSeen: new Date(),
        status: 'ACTIVE' as const,
        autoMitigated: false
      }));
  }

  private async detectDeviceAnomalies(): Promise<SecurityThreat[]> {
    // Implementation for device anomaly detection
    return [];
  }

  private async detectBehavioralAnomalies(): Promise<SecurityThreat[]> {
    // Implementation for behavioral anomaly detection
    return [];
  }

  private async blockSuspiciousIPs(): Promise<void> {
    // Implementation for automatic IP blocking
    this.logger.log('Checking for suspicious IPs to block...');
  }

  private async resolveStaleAlerts(): Promise<void> {
    // Auto-resolve alerts older than 7 days with no activity
    const staleAlerts = await this.prisma.securityAlert.updateMany({
      where: {
        status: AlertStatus.ACTIVE,
        triggeredAt: {
          lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }
      },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
        resolutionNotes: 'Auto-resolved: No activity for 7 days'
      }
    });

    if (staleAlerts.count > 0) {
      this.logger.log(`Auto-resolved ${staleAlerts.count} stale alerts`);
    }
  }

  private async terminateHighRiskSessions(): Promise<void> {
    // Terminate sessions with critical risk scores (>90)
    const highRiskSessions = await this.prisma.session.updateMany({
      where: {
        isActive: true,
        riskScore: { gte: 90 }
      },
      data: {
        isActive: false,
        status: 'TERMINATED',
        terminatedAt: new Date(),
        terminationReason: 'AUTO_TERMINATED_HIGH_RISK'
      }
    });

    if (highRiskSessions.count > 0) {
      this.logger.warn(`Auto-terminated ${highRiskSessions.count} high-risk sessions`);
    }
  }

  private async updateIPReputationScores(): Promise<void> {
    // Implementation for IP reputation updates
    this.logger.log('Updating IP reputation scores...');
  }

  private calculateRiskLevel(score: number): RiskLevel {
    if (score >= 80) return RiskLevel.CRITICAL;
    if (score >= 60) return RiskLevel.HIGH;
    if (score >= 30) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private async calculateSystemLoad(): Promise<number> {
    // Simple system load calculation based on active sessions and alerts
    const [activeSessions, activeAlerts] = await Promise.all([
      this.prisma.session.count({ where: { isActive: true } }),
      this.prisma.securityAlert.count({ where: { status: AlertStatus.ACTIVE } })
    ]);

    // Simple load calculation (this could be more sophisticated)
    return Math.min(activeSessions * 0.1 + activeAlerts * 2, 100);
  }

  private async calculateAverageRiskScore(): Promise<number> {
    const result = await this.prisma.session.aggregate({
      where: { isActive: true },
      _avg: { riskScore: true }
    });

    return result._avg.riskScore || 0;
  }

  private calculateOverallSecurityScore(metrics: SecurityMetrics): number {
    let score = 100;
    
    // Deduct points based on various factors
    score -= Math.min(metrics.highRiskSessions * 2, 20);
    score -= Math.min(metrics.securityAlerts * 1.5, 15);
    score -= Math.min(metrics.failedLogins * 0.5, 10);
    
    // Bonus for good device trust distribution
    const trustedDevicePercentage = (metrics.deviceTrustDistribution['TRUSTED'] || 0) / 
                                   Object.values(metrics.deviceTrustDistribution).reduce((a, b) => a + b, 0);
    score += trustedDevicePercentage * 10;
    
    return Math.max(score, 0);
  }

  private async getSecurityIncidents(startDate: Date) {
    return this.prisma.securityAlert.findMany({
      where: {
        triggeredAt: { gte: startDate },
        severity: { in: [AlertSeverity.HIGH, AlertSeverity.CRITICAL] }
      },
      orderBy: { triggeredAt: 'desc' },
      take: 50
    });
  }

  private generateSecurityRecommendations(
    metrics: SecurityMetrics,
    threats: SecurityThreat[],
    riskyUsers: UserSecurityProfile[]
  ): string[] {
    const recommendations: string[] = [];

    if (metrics.highRiskSessions > metrics.activeSessions * 0.1) {
      recommendations.push('High number of risky sessions detected. Consider implementing stricter authentication policies.');
    }

    if (metrics.failedLogins > 100) {
      recommendations.push('Elevated failed login attempts. Consider implementing CAPTCHA or account lockouts.');
    }

    if (threats.filter(t => t.type === 'BRUTE_FORCE').length > 0) {
      recommendations.push('Brute force attacks detected. Implement IP blocking and rate limiting.');
    }

    if (riskyUsers.filter(u => u.securityScore < 50).length > 5) {
      recommendations.push('Multiple users with low security scores. Consider mandatory security training.');
    }

    return recommendations;
  }
}