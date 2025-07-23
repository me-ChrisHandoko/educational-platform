import { Injectable, UnauthorizedException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { v7 as uuidv7 } from 'uuid';
import { JwtService } from '@nestjs/jwt';
import { 
  DeviceType, 
  DeviceTrustLevel, 
  SessionStatus, 
  RiskLevel, 
  LocationPolicy,
  UserRole
} from '@prisma/client';

export interface EnterpriseSessionContext {
  deviceFingerprint: string;
  ipAddress: string;
  userAgent: string;
  location?: {
    country?: string;
    city?: string;
    coordinates?: { lat: number; lng: number };
  };
  timezone?: string;
  language?: string;
}

export interface SessionCreationResult {
  sessionId: string;
  shouldTerminateOthers: boolean;
  warningMessage?: string;
  riskScore: number;
  deviceTrusted: boolean;
}

export interface ActiveSession {
  id: string;
  userId: string;
  sessionId: string;
  deviceFingerprint: string;
  deviceName: string;
  deviceType: DeviceType;
  deviceTrustLevel: DeviceTrustLevel;
  ipAddress: string;
  location: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  isActive: boolean;
  riskScore: number;
  riskLevel: RiskLevel;
  status: SessionStatus;
}

@Injectable()
export class EnterpriseSessionService {
  private readonly logger = new Logger(EnterpriseSessionService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Create enterprise session with comprehensive security assessment
   */
  async createSession(
    userId: string,
    userRole: UserRole,
    context: EnterpriseSessionContext
  ): Promise<SessionCreationResult> {
    this.logger.log(`Creating session for user ${userId} with role ${userRole}`);

    try {
      // 1. Get or create session policy
      const policy = await this.getSessionPolicy(userRole);
      
      // 2. Assess risk
      const riskAssessment = await this.assessRisk(userId, context);
      
      // 3. Check if login should be blocked
      if (riskAssessment.riskScore >= policy.riskThreshold) {
        throw new HttpException({
          message: 'Login blocked due to high security risk',
          riskScore: riskAssessment.riskScore,
          riskLevel: riskAssessment.riskLevel,
          factors: riskAssessment.factors
        }, HttpStatus.FORBIDDEN);
      }

      // 4. Handle device trust
      const deviceTrust = await this.handleDeviceTrust(userId, context);

      // 5. Check active sessions and enforce limits
      const sessionManagement = await this.manageActiveSessions(userId, policy, context);

      // 6. Create session
      const sessionId = uuidv7();
      const tokenFamily = uuidv7();
      
      await this.createSessionRecord(
        userId, 
        sessionId, 
        tokenFamily,
        context, 
        policy, 
        riskAssessment,
        deviceTrust
      );

      // 7. Log session creation
      await this.logSessionEvent(userId, sessionId, 'SESSION_CREATED', {
        riskScore: riskAssessment.riskScore,
        deviceTrustLevel: deviceTrust.trustLevel,
        policyName: policy.name,
        terminatedSessions: sessionManagement.terminatedCount
      });

      return {
        sessionId,
        shouldTerminateOthers: sessionManagement.terminatedCount > 0,
        warningMessage: sessionManagement.warningMessage,
        riskScore: riskAssessment.riskScore,
        deviceTrusted: deviceTrust.trustLevel !== DeviceTrustLevel.UNKNOWN
      };

    } catch (error) {
      this.logger.error(`Failed to create session for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Validate session and return session info
   */
  async validateSession(sessionId: string): Promise<ActiveSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { 
        sessionId,
        isActive: true,
        status: SessionStatus.ACTIVE
      },
      include: {
        user: {
          select: { id: true, email: true, role: true, status: true }
        }
      }
    });

    if (!session || !session.user) {
      return null;
    }

    // Check expiration
    if (session.expiresAt < new Date()) {
      await this.terminateSession(sessionId, 'EXPIRED');
      return null;
    }

    // Check user status
    if (session.user.status !== 'ACTIVE') {
      await this.terminateSession(sessionId, 'USER_INACTIVE');
      return null;
    }

    // Update activity
    await this.updateSessionActivity(sessionId);

    return this.mapSessionToActiveSession(session);
  }

  /**
   * Terminate session with reason
   */
  async terminateSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.update({
      where: { sessionId },
      data: {
        isActive: false,
        status: SessionStatus.TERMINATED,
        terminatedAt: new Date(),
        terminationReason: reason
      }
    });

    await this.logSessionEvent('', sessionId, 'SESSION_TERMINATED', { reason });
  }

  /**
   * Get active sessions for user
   */
  async getActiveSessions(userId: string): Promise<ActiveSession[]> {
    const sessions = await this.prisma.session.findMany({
      where: { 
        userId,
        isActive: true,
        status: SessionStatus.ACTIVE
      },
      orderBy: { lastActivityAt: 'desc' }
    });

    return sessions.map(session => this.mapSessionToActiveSession(session));
  }

  /**
   * Terminate all sessions for user (admin action)
   */
  async terminateAllUserSessions(userId: string, reason: string = 'ADMIN_ACTION'): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, isActive: true },
      data: {
        isActive: false,
        status: SessionStatus.TERMINATED,
        terminatedAt: new Date(),
        terminationReason: reason
      }
    });

    await this.logSessionEvent(userId, '', 'ALL_SESSIONS_TERMINATED', { 
      reason,
      terminatedCount: result.count
    });

    return result.count;
  }

  /**
   * Update session activity timestamp
   */
  async updateSessionActivity(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { sessionId },
      data: { lastActivityAt: new Date() }
    });
  }

  /**
   * Get session statistics for monitoring
   */
  async getSessionStatistics(userId?: string) {
    const whereClause = userId ? { userId } : {};

    const [totalSessions, activeSessions, highRiskSessions] = await Promise.all([
      this.prisma.session.count({ where: whereClause }),
      this.prisma.session.count({ 
        where: { ...whereClause, isActive: true, status: SessionStatus.ACTIVE } 
      }),
      this.prisma.session.count({
        where: { ...whereClause, isActive: true, riskScore: { gte: 70 } }
      })
    ]);

    return {
      totalSessions,
      activeSessions,
      highRiskSessions,
      riskPercentage: activeSessions > 0 ? (highRiskSessions / activeSessions) * 100 : 0
    };
  }

  /**
   * Private helper methods
   */
  private async getSessionPolicy(userRole: UserRole) {
    let policy = await this.prisma.sessionPolicy.findUnique({
      where: { userRole }
    });

    if (!policy) {
      // Create default policy if not exists
      policy = await this.createDefaultSessionPolicy(userRole);
    }

    return policy;
  }

  private async createDefaultSessionPolicy(userRole: UserRole) {
    const policyConfigs = {
      [UserRole.STUDENT]: {
        name: 'STUDENT_POLICY',
        maxConcurrentSessions: 3,
        sessionTimeoutMinutes: 480, // 8 hours
        deviceTrustRequired: DeviceTrustLevel.UNKNOWN,
        locationPolicy: LocationPolicy.GLOBAL,
        riskThreshold: 80
      },
      [UserRole.INSTRUCTOR]: {
        name: 'INSTRUCTOR_POLICY', 
        maxConcurrentSessions: 5,
        sessionTimeoutMinutes: 720, // 12 hours
        deviceTrustRequired: DeviceTrustLevel.KNOWN,
        locationPolicy: LocationPolicy.MONITORED,
        riskThreshold: 70
      },
      [UserRole.ADMIN]: {
        name: 'ADMIN_POLICY',
        maxConcurrentSessions: 2,
        sessionTimeoutMinutes: 240, // 4 hours
        deviceTrustRequired: DeviceTrustLevel.VERIFIED,
        locationPolicy: LocationPolicy.RESTRICTED,
        requireMFA: true,
        riskThreshold: 60
      },
      [UserRole.SUPER_ADMIN]: {
        name: 'SUPER_ADMIN_POLICY',
        maxConcurrentSessions: 1,
        sessionTimeoutMinutes: 120, // 2 hours
        deviceTrustRequired: DeviceTrustLevel.TRUSTED,
        locationPolicy: LocationPolicy.RESTRICTED,
        requireMFA: true,
        requireHardwareToken: true,
        forceUniqueSession: true,
        riskThreshold: 50
      }
    };

    const config = policyConfigs[userRole] || policyConfigs[UserRole.STUDENT];

    return await this.prisma.sessionPolicy.create({
      data: {
        ...config,
        userRole
      }
    });
  }

  private async assessRisk(userId: string, context: EnterpriseSessionContext) {
    let riskScore = 0;
    const factors: string[] = [];

    // Device risk
    const deviceRisk = await this.assessDeviceRisk(userId, context);
    riskScore += deviceRisk.score;
    factors.push(...deviceRisk.factors);

    // Location risk
    const locationRisk = await this.assessLocationRisk(userId, context);
    riskScore += locationRisk.score;
    factors.push(...locationRisk.factors);

    // Behavioral risk
    const behaviorRisk = await this.assessBehaviorRisk(userId, context);
    riskScore += behaviorRisk.score;
    factors.push(...behaviorRisk.factors);

    // Time-based risk
    const timeRisk = this.assessTimeRisk();
    riskScore += timeRisk.score;
    factors.push(...timeRisk.factors);

    const finalRiskScore = Math.min(riskScore, 100);
    const riskLevel = this.calculateRiskLevel(finalRiskScore);

    return {
      riskScore: finalRiskScore,
      riskLevel,
      factors
    };
  }

  private async assessDeviceRisk(userId: string, context: EnterpriseSessionContext) {
    let score = 0;
    const factors: string[] = [];

    // Check if device is known
    const knownDevice = await this.prisma.trustedDevice.findFirst({
      where: {
        userId,
        deviceFingerprint: context.deviceFingerprint,
        isActive: true
      }
    });

    if (!knownDevice) {
      score += 30;
      factors.push('Unknown device');

      // Check for similar devices
      const similarDevices = await this.prisma.trustedDevice.count({
        where: { userId, isActive: true }
      });

      if (similarDevices === 0) {
        score += 20;
        factors.push('First device for user');
      }
    }

    // Check user agent for suspicious patterns
    if (this.isSuspiciousUserAgent(context.userAgent)) {
      score += 25;
      factors.push('Suspicious user agent');
    }

    return { score, factors };
  }

  private async assessLocationRisk(userId: string, context: EnterpriseSessionContext) {
    let score = 0;
    const factors: string[] = [];

    if (!context.location?.country) {
      return { score, factors };
    }

    // Check historical locations
    const userSessions = await this.prisma.session.findMany({
      where: { userId },
      select: { ipCountry: true, ipCity: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const knownCountries = new Set(userSessions.map(s => s.ipCountry).filter(Boolean));
    const knownCities = new Set(userSessions.map(s => s.ipCity).filter(Boolean));

    // New country
    if (!knownCountries.has(context.location.country)) {
      score += 25;
      factors.push('New country');
    }

    // New city
    if (context.location.city && !knownCities.has(context.location.city)) {
      score += 15;
      factors.push('New city');
    }

    return { score, factors };
  }

  private async assessBehaviorRisk(userId: string, context: EnterpriseSessionContext) {
    let score = 0;
    const factors: string[] = [];

    // Check recent login frequency
    const recentLogins = await this.prisma.session.count({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }
    });

    if (recentLogins > 10) {
      score += 20;
      factors.push('High login frequency');
    }

    // Check for rapid logins from different IPs
    const recentSessions = await this.prisma.session.findMany({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }
      },
      select: { ipAddress: true }
    });

    const uniqueIPs = new Set(recentSessions.map(s => s.ipAddress));
    if (uniqueIPs.size > 3) {
      score += 30;
      factors.push('Multiple recent IPs');
    }

    return { score, factors };
  }

  private assessTimeRisk() {
    let score = 0;
    const factors: string[] = [];

    const hour = new Date().getHours();
    
    // Unusual hours (2AM-6AM)
    if (hour >= 2 && hour <= 6) {
      score += 15;
      factors.push('Unusual time');
    }

    return { score, factors };
  }

  private calculateRiskLevel(score: number): RiskLevel {
    if (score >= 80) return RiskLevel.CRITICAL;
    if (score >= 60) return RiskLevel.HIGH;
    if (score >= 30) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private async handleDeviceTrust(userId: string, context: EnterpriseSessionContext) {
    let trustedDevice = await this.prisma.trustedDevice.findFirst({
      where: {
        userId,
        deviceFingerprint: context.deviceFingerprint
      }
    });

    if (!trustedDevice) {
      // Create new device entry
      trustedDevice = await this.prisma.trustedDevice.create({
        data: {
          userId,
          deviceFingerprint: context.deviceFingerprint,
          deviceName: this.extractDeviceName(context.userAgent),
          deviceType: this.detectDeviceType(context.userAgent),
          trustLevel: DeviceTrustLevel.UNKNOWN,
          fingerprintData: {
            userAgent: context.userAgent,
            timezone: context.timezone,
            language: context.language
          }
        }
      });
    } else {
      // Update device activity
      await this.prisma.trustedDevice.update({
        where: { id: trustedDevice.id },
        data: {
          lastSeenAt: new Date(),
          seenCount: { increment: 1 }
        }
      });
    }

    return trustedDevice;
  }

  private async manageActiveSessions(userId: string, policy: any, context: EnterpriseSessionContext) {
    const activeSessions = await this.getActiveSessions(userId);
    let terminatedCount = 0;
    let warningMessage: string | undefined;

    // Check for existing session on same device
    const existingDeviceSession = activeSessions.find(
      session => session.deviceFingerprint === context.deviceFingerprint
    );

    if (existingDeviceSession) {
      // Terminate existing session from same device
      await this.terminateSession(existingDeviceSession.sessionId, 'NEW_LOGIN_SAME_DEVICE');
      terminatedCount = 1;
      warningMessage = 'Previous session from this device was terminated';
    } else if (activeSessions.length >= policy.maxConcurrentSessions) {
      // Enforce session limits
      if (policy.forceUniqueSession) {
        // Terminate all other sessions
        for (const session of activeSessions) {
          await this.terminateSession(session.sessionId, 'UNIQUE_SESSION_POLICY');
        }
        terminatedCount = activeSessions.length;
        warningMessage = 'All other sessions terminated due to unique session policy';
      } else {
        // Terminate oldest sessions
        const sessionsToTerminate = activeSessions
          .sort((a, b) => a.lastActivityAt.getTime() - b.lastActivityAt.getTime())
          .slice(0, activeSessions.length - policy.maxConcurrentSessions + 1);

        for (const session of sessionsToTerminate) {
          await this.terminateSession(session.sessionId, 'SESSION_LIMIT_EXCEEDED');
        }
        terminatedCount = sessionsToTerminate.length;
        warningMessage = `Terminated ${terminatedCount} older session(s) due to session limit`;
      }
    }

    return { terminatedCount, warningMessage };
  }

  private async createSessionRecord(
    userId: string,
    sessionId: string, 
    tokenFamily: string,
    context: EnterpriseSessionContext,
    policy: any,
    riskAssessment: any,
    deviceTrust: any
  ) {
    const expiresAt = new Date(Date.now() + policy.sessionTimeoutMinutes * 60 * 1000);

    await this.prisma.session.create({
      data: {
        userId,
        sessionId,
        tokenFamily,
        deviceFingerprint: context.deviceFingerprint,
        deviceName: this.extractDeviceName(context.userAgent),
        deviceType: this.detectDeviceType(context.userAgent),
        deviceTrustLevel: deviceTrust.trustLevel,
        ipAddress: context.ipAddress,
        ipCountry: context.location?.country,
        ipCity: context.location?.city,
        location: this.formatLocation(context.location),
        coordinates: context.location?.coordinates,
        userAgent: context.userAgent,
        browserName: this.extractBrowserName(context.userAgent),
        osName: this.extractOSName(context.userAgent),
        isMobile: this.isMobileDevice(context.userAgent),
        timezone: context.timezone,
        language: context.language,
        expiresAt,
        riskScore: riskAssessment.riskScore,
        riskLevel: riskAssessment.riskLevel,
        riskFactors: riskAssessment.factors,
        policyId: policy.id,
        maxIdleTime: policy.idleTimeoutMinutes,
        requiresMFA: policy.requireMFA || false
      }
    });
  }

  private mapSessionToActiveSession(session: any): ActiveSession {
    return {
      id: session.id,
      userId: session.userId,
      sessionId: session.sessionId,
      deviceFingerprint: session.deviceFingerprint,
      deviceName: session.deviceName || 'Unknown Device',
      deviceType: session.deviceType,
      deviceTrustLevel: session.deviceTrustLevel,
      ipAddress: session.ipAddress,
      location: session.location || 'Unknown Location',
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
      isActive: session.isActive,
      riskScore: session.riskScore,
      riskLevel: session.riskLevel,
      status: session.status
    };
  }

  private async logSessionEvent(
    userId: string,
    sessionId: string,
    event: string,
    metadata: any
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: userId || null,
        sessionId: sessionId || null,
        action: event,
        entity: 'SESSION',
        entityId: sessionId,
        category: 'SECURITY',
        metadata,
        createdAt: new Date()
      }
    });
  }

  // Utility methods
  private extractDeviceName(userAgent: string): string {
    if (userAgent.includes('iPhone')) return 'iPhone';
    if (userAgent.includes('iPad')) return 'iPad';
    if (userAgent.includes('Android')) return 'Android Device';
    if (userAgent.includes('Windows')) return 'Windows PC';
    if (userAgent.includes('Macintosh')) return 'Mac';
    return 'Unknown Device';
  }

  private detectDeviceType(userAgent: string): DeviceType {
    if (userAgent.includes('iPhone') || userAgent.includes('Android')) {
      return DeviceType.MOBILE;
    }
    if (userAgent.includes('iPad') || userAgent.includes('Tablet')) {
      return DeviceType.TABLET;
    }
    if (userAgent.includes('Windows') || userAgent.includes('Macintosh') || userAgent.includes('Linux')) {
      return DeviceType.DESKTOP;
    }
    return DeviceType.UNKNOWN;
  }

  private extractBrowserName(userAgent: string): string {
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown';
  }

  private extractOSName(userAgent: string): string {
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Macintosh')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('iOS')) return 'iOS';
    if (userAgent.includes('Android')) return 'Android';
    return 'Unknown';
  }

  private isMobileDevice(userAgent: string): boolean {
    return /iPhone|iPad|iPod|Android|BlackBerry|Windows Phone/i.test(userAgent);
  }

  private isSuspiciousUserAgent(userAgent: string): boolean {
    const suspiciousPatterns = [
      /curl/i, /wget/i, /python/i, /bot/i, /crawler/i, /spider/i, /scraper/i
    ];
    return suspiciousPatterns.some(pattern => pattern.test(userAgent));
  }

  private formatLocation(location?: { country?: string; city?: string }): string {
    if (!location) return 'Unknown Location';
    if (location.city && location.country) {
      return `${location.city}, ${location.country}`;
    }
    return location.country || location.city || 'Unknown Location';
  }
}