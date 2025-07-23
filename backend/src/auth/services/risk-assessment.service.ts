import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

export interface RiskAssessment {
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: RiskFactor[];
  recommendations: SecurityRecommendation[];
  requiresAdditionalVerification: boolean;
}

export interface RiskFactor {
  type: 'DEVICE' | 'LOCATION' | 'BEHAVIOR' | 'TIME' | 'PATTERN';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  score: number;
  evidence: any;
}

export interface SecurityRecommendation {
  type: 'BLOCK_LOGIN' | 'REQUIRE_MFA' | 'NOTIFY_USER' | 'MONITOR' | 'ALLOW';
  message: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface DeviceFingerprint {
  userAgent: string;
  screen: { width: number; height: number; colorDepth: number };
  timezone: string;
  language: string;
  platform: string;
  cookieEnabled: boolean;
  doNotTrack: boolean;
  hash: string; // Generated hash of all factors
}

@Injectable()
export class RiskAssessmentService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * Comprehensive risk assessment for login attempt
   */
  async assessLoginRisk(
    userId: string,
    loginContext: {
      ipAddress: string;
      userAgent: string;
      deviceFingerprint: DeviceFingerprint;
      location?: { country: string; city: string; lat?: number; lng?: number };
      timestamp: Date;
    }
  ): Promise<RiskAssessment> {
    const riskFactors: RiskFactor[] = [];

    // 1. Device Risk Assessment
    const deviceRisk = await this.assessDeviceRisk(userId, loginContext);
    riskFactors.push(...deviceRisk);

    // 2. Location Risk Assessment
    const locationRisk = await this.assessLocationRisk(userId, loginContext);
    riskFactors.push(...locationRisk);

    // 3. Behavioral Pattern Assessment
    const behaviorRisk = await this.assessBehavioralRisk(userId, loginContext);
    riskFactors.push(...behaviorRisk);

    // 4. Temporal Pattern Assessment
    const timeRisk = await this.assessTemporalRisk(userId, loginContext);
    riskFactors.push(...timeRisk);

    // 5. Threat Intelligence Assessment
    const threatRisk = await this.assessThreatIntelligence(loginContext);
    riskFactors.push(...threatRisk);

    // Calculate overall risk score
    const totalScore = riskFactors.reduce((sum, factor) => sum + factor.score, 0);
    const riskScore = Math.min(totalScore, 100);
    const riskLevel = this.calculateRiskLevel(riskScore);

    // Generate recommendations
    const recommendations = this.generateRecommendations(riskScore, riskFactors);
    const requiresAdditionalVerification = riskScore >= 50;

    return {
      riskScore,
      riskLevel,
      factors: riskFactors,
      recommendations,
      requiresAdditionalVerification
    };
  }

  /**
   * Device Risk Assessment
   */
  private async assessDeviceRisk(
    userId: string,
    context: any
  ): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];

    // Check if device is known
    const knownDevice = await this.prisma.trustedDevice.findFirst({
      where: {
        userId,
        deviceHash: context.deviceFingerprint.hash,
        isActive: true
      }
    });

    if (!knownDevice) {
      factors.push({
        type: 'DEVICE',
        severity: 'MEDIUM',
        description: 'Login from unknown device',
        score: 25,
        evidence: { deviceHash: context.deviceFingerprint.hash }
      });

      // Check for device fingerprint similarities
      const similarDevices = await this.findSimilarDevices(userId, context.deviceFingerprint);
      if (similarDevices.length === 0) {
        factors.push({
          type: 'DEVICE',
          severity: 'HIGH',
          description: 'Completely new device profile',
          score: 15,
          evidence: { similarDevicesCount: 0 }
        });
      }
    } else {
      // Check if device properties have changed significantly
      const deviceChanges = this.detectDeviceChanges(knownDevice, context.deviceFingerprint);
      if (deviceChanges.length > 0) {
        factors.push({
          type: 'DEVICE',
          severity: 'MEDIUM',
          description: 'Known device with changed properties',
          score: 10,
          evidence: { changes: deviceChanges }
        });
      }
    }

    // Check for suspicious user agent
    if (this.isSuspiciousUserAgent(context.userAgent)) {
      factors.push({
        type: 'DEVICE',
        severity: 'HIGH',
        description: 'Suspicious user agent detected',
        score: 30,
        evidence: { userAgent: context.userAgent }
      });
    }

    return factors;
  }

  /**
   * Location Risk Assessment
   */
  private async assessLocationRisk(
    userId: string,
    context: any
  ): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];

    if (!context.location) return factors;

    // Check historical locations
    const userLocations = await this.prisma.userSession.findMany({
      where: { userId },
      select: { ipAddress: true, location: true, createdAt: true },
      take: 50,
      orderBy: { createdAt: 'desc' }
    });

    const uniqueLocations = [...new Set(userLocations.map(l => l.location))];

    // New country/city
    const currentLocation = `${context.location.city}, ${context.location.country}`;
    if (!uniqueLocations.includes(currentLocation)) {
      factors.push({
        type: 'LOCATION',
        severity: 'MEDIUM',
        description: 'Login from new location',
        score: 20,
        evidence: { location: currentLocation, knownLocations: uniqueLocations.length }
      });

      // New country adds more risk
      const knownCountries = [...new Set(userLocations.map(l => l.location?.split(', ')[1]))];
      if (!knownCountries.includes(context.location.country)) {
        factors.push({
          type: 'LOCATION',
          severity: 'HIGH',
          description: 'Login from new country',
          score: 25,
          evidence: { country: context.location.country, knownCountries }
        });
      }
    }

    // Check for impossible travel
    const recentSessions = userLocations.filter(
      session => new Date(session.createdAt).getTime() > Date.now() - 2 * 60 * 60 * 1000 // Last 2 hours
    );

    if (recentSessions.length > 0) {
      const impossibleTravel = await this.detectImpossibleTravel(
        recentSessions[0],
        context.location,
        context.timestamp
      );

      if (impossibleTravel.isImpossible) {
        factors.push({
          type: 'LOCATION',
          severity: 'CRITICAL',
          description: 'Impossible travel detected',
          score: 50,
          evidence: impossibleTravel
        });
      }
    }

    // High-risk countries/regions
    if (await this.isHighRiskLocation(context.location)) {
      factors.push({
        type: 'LOCATION',
        severity: 'HIGH',
        description: 'Login from high-risk location',
        score: 30,
        evidence: { location: currentLocation }
      });
    }

    return factors;
  }

  /**
   * Behavioral Pattern Assessment
   */
  private async assessBehavioralRisk(
    userId: string,
    context: any
  ): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];

    // Check login frequency patterns
    const recentLogins = await this.prisma.auditLog.findMany({
      where: {
        userId,
        action: 'LOGIN_SUCCESS',
        timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      },
      orderBy: { timestamp: 'desc' }
    });

    // Too many login attempts
    if (recentLogins.length > 20) {
      factors.push({
        type: 'BEHAVIOR',
        severity: 'HIGH',
        description: 'Unusually high login frequency',
        score: 25,
        evidence: { loginCount: recentLogins.length, timeframe: '24h' }
      });
    }

    // Multiple failed attempts before success
    const recentFailures = await this.prisma.auditLog.findMany({
      where: {
        userId,
        action: 'LOGIN_FAILURE',
        timestamp: { gte: new Date(Date.now() - 30 * 60 * 1000) } // Last 30 minutes
      }
    });

    if (recentFailures.length > 3) {
      factors.push({
        type: 'BEHAVIOR',
        severity: 'MEDIUM',
        description: 'Multiple failed login attempts',
        score: 20,
        evidence: { failedAttempts: recentFailures.length }
      });
    }

    return factors;
  }

  /**
   * Temporal Pattern Assessment
   */
  private async assessTemporalRisk(
    userId: string,
    context: any
  ): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];

    // Check user's typical login times
    const historicalLogins = await this.prisma.auditLog.findMany({
      where: {
        userId,
        action: 'LOGIN_SUCCESS',
        timestamp: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
      }
    });

    if (historicalLogins.length > 10) {
      const typicalHours = this.analyzeTypicalLoginHours(historicalLogins);
      const currentHour = context.timestamp.getHours();

      if (!typicalHours.includes(currentHour)) {
        const riskScore = this.calculateTimeRiskScore(currentHour, typicalHours);
        factors.push({
          type: 'TIME',
          severity: riskScore > 20 ? 'MEDIUM' : 'LOW',
          description: 'Login at unusual time',
          score: riskScore,
          evidence: { currentHour, typicalHours }
        });
      }
    }

    return factors;
  }

  /**
   * Threat Intelligence Assessment
   */
  private async assessThreatIntelligence(context: any): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];

    // Check IP reputation
    const ipReputation = await this.checkIPReputation(context.ipAddress);
    if (ipReputation.isMalicious) {
      factors.push({
        type: 'PATTERN',
        severity: 'CRITICAL',
        description: 'IP address flagged as malicious',
        score: 60,
        evidence: ipReputation
      });
    }

    // Check for known attack patterns
    const attackPattern = await this.detectAttackPatterns(context);
    if (attackPattern.detected) {
      factors.push({
        type: 'PATTERN',
        severity: 'HIGH',
        description: 'Known attack pattern detected',
        score: 40,
        evidence: attackPattern
      });
    }

    return factors;
  }

  /**
   * Assess risk for ongoing operations (used by middleware)
   */
  async assessOperationRisk(
    userId: string,
    operationContext: {
      operation: string;
      ipAddress: string;
      userAgent: string;
      sessionId: string;
      currentRiskScore: number;
      timestamp: Date;
    }
  ): Promise<RiskAssessment> {
    const riskFactors: RiskFactor[] = [];

    // Check for rapid operations from different IPs
    const recentOperations = await this.prisma.auditLog.findMany({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }, // Last 15 minutes
        action: { not: 'LOGIN_SUCCESS' }
      },
      orderBy: { createdAt: 'desc' }
    });

    const uniqueIPs = [...new Set(recentOperations.map(op => op.ipAddress))];
    if (uniqueIPs.length > 2) {
      riskFactors.push({
        type: 'BEHAVIOR',
        severity: 'HIGH',
        description: 'Operations from multiple IP addresses',
        score: 30,
        evidence: { uniqueIPs: uniqueIPs.length, operation: operationContext.operation }
      });
    }

    // Check operation frequency
    const recentSimilarOps = recentOperations.filter(op => 
      op.action.includes(operationContext.operation.split(' ')[0])
    );

    if (recentSimilarOps.length > 10) {
      riskFactors.push({
        type: 'BEHAVIOR',
        severity: 'MEDIUM',
        description: 'High frequency of similar operations',
        score: 20,
        evidence: { operationCount: recentSimilarOps.length, operation: operationContext.operation }
      });
    }

    // Assess sensitive operation patterns
    if (this.isSensitiveOperation(operationContext.operation)) {
      const baseRiskIncrease = 15;
      riskFactors.push({
        type: 'PATTERN',
        severity: 'MEDIUM',
        description: 'Sensitive operation detected',
        score: baseRiskIncrease,
        evidence: { operation: operationContext.operation }
      });
    }

    // Calculate new risk score
    const additionalRisk = riskFactors.reduce((sum, factor) => sum + factor.score, 0);
    const newRiskScore = Math.min(operationContext.currentRiskScore + additionalRisk, 100);
    const riskLevel = this.calculateRiskLevel(newRiskScore);

    const recommendations = this.generateOperationRecommendations(newRiskScore, riskFactors);

    return {
      riskScore: newRiskScore,
      riskLevel,
      factors: riskFactors,
      recommendations,
      requiresAdditionalVerification: newRiskScore >= 70
    };
  }

  private isSensitiveOperation(operation: string): boolean {
    const sensitivePatterns = [
      /DELETE/i, /admin/i, /security/i, /user/i, /permission/i, /role/i
    ];
    return sensitivePatterns.some(pattern => pattern.test(operation));
  }

  private generateOperationRecommendations(
    riskScore: number,
    factors: RiskFactor[]
  ): SecurityRecommendation[] {
    const recommendations: SecurityRecommendation[] = [];

    if (riskScore >= 85) {
      recommendations.push({
        type: 'BLOCK_LOGIN',
        message: 'Block operation due to elevated risk',
        priority: 'CRITICAL'
      });
    } else if (riskScore >= 70) {
      recommendations.push({
        type: 'REQUIRE_MFA',
        message: 'Require additional verification for this operation',
        priority: 'HIGH'
      });
    } else if (riskScore >= 50) {
      recommendations.push({
        type: 'MONITOR',
        message: 'Increase monitoring for this session',
        priority: 'MEDIUM'
      });
    }

    return recommendations;
  }

  /**
   * Utility Methods
   */
  private calculateRiskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 30) return 'MEDIUM';
    return 'LOW';
  }

  private generateRecommendations(
    riskScore: number,
    factors: RiskFactor[]
  ): SecurityRecommendation[] {
    const recommendations: SecurityRecommendation[] = [];

    if (riskScore >= 80) {
      recommendations.push({
        type: 'BLOCK_LOGIN',
        message: 'Block login attempt due to critical risk factors',
        priority: 'CRITICAL'
      });
    } else if (riskScore >= 60) {
      recommendations.push({
        type: 'REQUIRE_MFA',
        message: 'Require multi-factor authentication',
        priority: 'HIGH'
      });
    } else if (riskScore >= 30) {
      recommendations.push({
        type: 'NOTIFY_USER',
        message: 'Send security notification to user',
        priority: 'MEDIUM'
      });
    } else {
      recommendations.push({
        type: 'ALLOW',
        message: 'Allow login with standard monitoring',
        priority: 'LOW'
      });
    }

    return recommendations;
  }

  private async findSimilarDevices(
    userId: string,
    fingerprint: DeviceFingerprint
  ): Promise<any[]> {
    // Implementation to find devices with similar characteristics
    return [];
  }

  private detectDeviceChanges(knownDevice: any, newFingerprint: DeviceFingerprint): string[] {
    const changes: string[] = [];
    // Compare device properties and detect significant changes
    return changes;
  }

  private isSuspiciousUserAgent(userAgent: string): boolean {
    const suspiciousPatterns = [
      /curl/i, /wget/i, /python/i, /bot/i, /crawler/i, /spider/i
    ];
    return suspiciousPatterns.some(pattern => pattern.test(userAgent));
  }

  private async detectImpossibleTravel(
    lastSession: any,
    currentLocation: any,
    currentTime: Date
  ): Promise<{ isImpossible: boolean; details: any }> {
    // Calculate if travel between locations is physically impossible
    // Based on distance and time difference
    return { isImpossible: false, details: {} };
  }

  private async isHighRiskLocation(location: any): Promise<boolean> {
    // Check against high-risk countries/regions database
    const highRiskCountries = ['Country1', 'Country2']; // Configure as needed
    return highRiskCountries.includes(location.country);
  }

  private analyzeTypicalLoginHours(logins: any[]): number[] {
    const hourCounts = new Array(24).fill(0);
    logins.forEach(login => {
      const hour = new Date(login.timestamp).getHours();
      hourCounts[hour]++;
    });

    // Return hours where user typically logs in (>10% of total logins)
    const threshold = logins.length * 0.1;
    return hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter(({ count }) => count >= threshold)
      .map(({ hour }) => hour);
  }

  private calculateTimeRiskScore(currentHour: number, typicalHours: number[]): number {
    // Calculate risk based on how far current hour is from typical hours
    if (typicalHours.length === 0) return 0;

    const distances = typicalHours.map(hour => Math.abs(currentHour - hour));
    const minDistance = Math.min(...distances);

    // Higher risk for times further from typical patterns
    return Math.min(minDistance * 3, 25);
  }

  private async checkIPReputation(ipAddress: string): Promise<any> {
    // Check IP against threat intelligence databases
    // This would integrate with services like VirusTotal, AbuseIPDB, etc.
    return { isMalicious: false, sources: [] };
  }

  private async detectAttackPatterns(context: any): Promise<any> {
    // Detect known attack patterns (credential stuffing, brute force, etc.)
    return { detected: false, patterns: [] };
  }
}