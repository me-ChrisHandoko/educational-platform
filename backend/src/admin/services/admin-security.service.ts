import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AccountLockoutService } from '../../auth/services/account-lockout.service';
import { SecurityConfigService } from '../../common/services/security-config.service';
import { AuditService } from '../../common/services/audit.service';

export interface SecurityOverview {
  activeLockouts: Array<{
    email: string;
    lockedUntil: Date;
    createdAt: Date;
  }>;
  rateLimitViolations: Array<{
    key: string;
    count: number;
    resetTime: number;
    type: 'ip' | 'user';
  }>;
  securityEvents: Array<{
    type: string;
    count: number;
    lastOccurrence: Date;
  }>;
  suspiciousIps: Array<{
    ip: string;
    eventCount: number;
    riskScore: number;
    lastActivity: Date;
  }>;
  systemHealth: {
    redis: { status: 'healthy' | 'unhealthy'; latency?: number };
    database: { status: 'healthy' | 'unhealthy'; latency?: number };
  };
}

export interface UnlockResult {
  email?: string;
  ip?: string;
  action: 'unlocked' | 'already_unlocked' | 'error';
  message: string;
  clearedKeys?: string[];
  timeToAutoUnlock?: number;
}

@Injectable()
export class AdminSecurityService {
  private readonly logger = new Logger(AdminSecurityService.name);

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private accountLockoutService: AccountLockoutService,
    private securityConfig: SecurityConfigService,
    private auditService: AuditService,
  ) {}

  /**
   * Get comprehensive security overview
   */
  async getSecurityOverview(): Promise<SecurityOverview> {
    try {
      const [
        activeLockouts,
        rateLimitViolations,
        securityEvents,
        suspiciousIps,
        systemHealth,
      ] = await Promise.all([
        this.getActiveLockouts(),
        this.getRateLimitViolations(),
        this.getRecentSecurityEvents(),
        this.getSuspiciousIps(),
        this.getSystemHealth(),
      ]);

      return {
        activeLockouts,
        rateLimitViolations,
        securityEvents,
        suspiciousIps,
        systemHealth,
      };
    } catch (error) {
      this.logger.error('Error getting security overview:', error);
      throw error;
    }
  }

  /**
   * Unlock specific user account
   */
  async unlockUser(
    email: string,
    adminId: string,
    reason?: string,
  ): Promise<UnlockResult> {
    try {
      // Check if user exists
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new NotFoundException(`User with email ${email} not found`);
      }

      // Check current lockout status
      const lockoutStatus =
        await this.accountLockoutService.checkAccountLockout(email);

      if (!lockoutStatus.isLocked) {
        return {
          email,
          action: 'already_unlocked',
          message: 'User account is not currently locked',
        };
      }

      // Calculate time to auto-unlock
      const timeToAutoUnlock = lockoutStatus.lockoutExpiresAt
        ? lockoutStatus.lockoutExpiresAt.getTime() - Date.now()
        : 0;

      // Clear account lockout
      await this.accountLockoutService.clearLockout(email);

      // Clear user's rate limits across all IPs (optional enhancement)
      const clearedKeys = await this.clearUserRateLimits(email);

      // Log admin action
      await this.auditService.logAdminAction({
        adminId,
        action: 'UNLOCK_USER',
        targetEmail: email,
        reason: reason || 'Manual unlock requested',
        metadata: {
          timeToAutoUnlock,
          clearedRateLimitKeys: clearedKeys.length,
        },
      });

      this.logger.log(`User ${email} unlocked by admin ${adminId}`);

      return {
        email,
        action: 'unlocked',
        message: 'User account unlocked successfully',
        clearedKeys,
        timeToAutoUnlock,
      };
    } catch (error) {
      this.logger.error(`Error unlocking user ${email}:`, error);
      return {
        email,
        action: 'error',
        message: error.message || 'Failed to unlock user',
      };
    }
  }

  /**
   * Unlock specific IP address
   */
  async unlockIp(
    ip: string,
    adminId: string,
    reason?: string,
  ): Promise<UnlockResult> {
    try {
      // Clear all rate limits for IP
      const clearedKeys = await this.clearIpRateLimits(ip);

      if (clearedKeys.length === 0) {
        return {
          ip,
          action: 'already_unlocked',
          message: 'No active rate limits found for this IP',
        };
      }

      // Log admin action
      await this.auditService.logAdminAction({
        adminId,
        action: 'UNLOCK_IP',
        targetIp: ip,
        reason: reason || 'Manual IP unlock requested',
        metadata: {
          clearedKeys: clearedKeys.length,
          keysList: clearedKeys,
        },
      });

      this.logger.log(
        `IP ${ip} unlocked by admin ${adminId}, cleared ${clearedKeys.length} keys`,
      );

      return {
        ip,
        action: 'unlocked',
        message: `IP unlocked successfully, cleared ${clearedKeys.length} rate limit keys`,
        clearedKeys,
      };
    } catch (error) {
      this.logger.error(`Error unlocking IP ${ip}:`, error);
      return {
        ip,
        action: 'error',
        message: error.message || 'Failed to unlock IP',
      };
    }
  }

  /**
   * Bulk unlock operations
   */
  async bulkUnlock(
    emails: string[] = [],
    ips: string[] = [],
    adminId: string,
    reason: string,
  ): Promise<{
    users: {
      successful: string[];
      failed: Array<{ email: string; error: string }>;
      skipped: string[];
    };
    ips: {
      successful: string[];
      failed: Array<{ ip: string; error: string }>;
      skipped: string[];
    };
  }> {
    const results = {
      users: {
        successful: [] as string[],
        failed: [] as Array<{ email: string; error: string }>,
        skipped: [] as string[],
      },
      ips: {
        successful: [] as string[],
        failed: [] as Array<{ ip: string; error: string }>,
        skipped: [] as string[],
      },
    };

    // Process user unlocks
    for (const email of emails) {
      try {
        const result = await this.unlockUser(email, adminId, reason);

        if (result.action === 'unlocked') {
          results.users.successful.push(email);
        } else if (result.action === 'already_unlocked') {
          results.users.skipped.push(email);
        } else {
          results.users.failed.push({ email, error: result.message });
        }
      } catch (error) {
        results.users.failed.push({ email, error: error.message });
      }
    }

    // Process IP unlocks
    for (const ip of ips) {
      try {
        const result = await this.unlockIp(ip, adminId, reason);

        if (result.action === 'unlocked') {
          results.ips.successful.push(ip);
        } else if (result.action === 'already_unlocked') {
          results.ips.skipped.push(ip);
        } else {
          results.ips.failed.push({ ip, error: result.message });
        }
      } catch (error) {
        results.ips.failed.push({ ip, error: error.message });
      }
    }

    // Log bulk operation
    await this.auditService.logAdminAction({
      adminId,
      action: 'BULK_UNLOCK',
      reason,
      metadata: {
        totalUsers: emails.length,
        totalIps: ips.length,
        results,
      },
    });

    return results;
  }

  /**
   * Emergency unlock all (use with extreme caution)
   */
  async emergencyUnlockAll(
    adminId: string,
    confirmationCode: string,
    reason: string,
  ): Promise<{ clearedLockouts: number; clearedRateLimits: number }> {
    // Verify emergency code
    const expectedCode = process.env.EMERGENCY_UNLOCK_CODE || 'EMERGENCY_2024';
    if (confirmationCode !== expectedCode) {
      throw new BadRequestException('Invalid emergency confirmation code');
    }

    try {
      // Clear all account lockouts
      const lockoutCount = await this.prisma.accountLockout.count();
      await this.prisma.accountLockout.deleteMany({});

      // Clear all rate limits
      const rateLimitKeys = await this.redisService.keys('rate_limit:*');
      await Promise.all(rateLimitKeys.map((key) => this.redisService.del(key)));

      // Log critical action
      await this.auditService.logCriticalAction({
        adminId,
        action: 'EMERGENCY_UNLOCK_ALL',
        reason,
        metadata: {
          clearedLockouts: lockoutCount,
          clearedRateLimits: rateLimitKeys.length,
          timestamp: new Date().toISOString(),
        },
        severity: 'CRITICAL',
        requiresReview: true,
      });

      this.logger.warn(
        `EMERGENCY UNLOCK ALL executed by admin ${adminId}: ${lockoutCount} lockouts, ${rateLimitKeys.length} rate limits cleared`,
      );

      return {
        clearedLockouts: lockoutCount,
        clearedRateLimits: rateLimitKeys.length,
      };
    } catch (error) {
      this.logger.error('Error in emergency unlock all:', error);
      throw error;
    }
  }

  /**
   * Enable/disable maintenance mode
   */
  async setMaintenanceMode(
    enabled: boolean,
    adminId: string,
    reason: string,
    durationMinutes?: number,
  ): Promise<{ status: string; expiresAt?: Date }> {
    const ttl = enabled && durationMinutes ? durationMinutes * 60 : undefined;
    const expiresAt = ttl ? new Date(Date.now() + ttl * 1000) : undefined;

    await this.redisService.set(
      'system:maintenance_mode',
      {
        enabled,
        enabledBy: adminId,
        reason,
        enabledAt: new Date(),
        expiresAt,
      },
      ttl,
    );

    await this.auditService.logAdminAction({
      adminId,
      action: enabled ? 'ENABLE_MAINTENANCE_MODE' : 'DISABLE_MAINTENANCE_MODE',
      reason,
      metadata: {
        durationMinutes,
        expiresAt: expiresAt?.toISOString(),
      },
    });

    return {
      status: enabled ? 'enabled' : 'disabled',
      expiresAt,
    };
  }

  /**
   * Get unlock recommendations based on user behavior analysis
   */
  async getUnlockRecommendations(): Promise<
    Array<{
      email: string;
      reason: string;
      timeToAutoUnlock: number;
      confidence: number;
      suggestedAction: 'MANUAL_UNLOCK' | 'WAIT' | 'INVESTIGATE';
    }>
  > {
    const lockedUsers = await this.getActiveLockouts();
    const recommendations: Array<{
      email: string;
      reason: string;
      timeToAutoUnlock: number;
      confidence: number;
      suggestedAction: 'MANUAL_UNLOCK' | 'WAIT' | 'INVESTIGATE';
    }> = [];

    for (const user of lockedUsers) {
      const analysis = await this.analyzeUserBehavior(user.email);
      const timeToAutoUnlock = user.lockedUntil.getTime() - Date.now();

      let suggestedAction: 'MANUAL_UNLOCK' | 'WAIT' | 'INVESTIGATE' = 'WAIT';
      let reason = 'Standard lockout procedure';

      if (analysis.isLegitimateUser && timeToAutoUnlock > 300000) {
        // > 5 minutes
        suggestedAction = 'MANUAL_UNLOCK';
        reason = 'Legitimate user with long wait time';
      } else if (analysis.suspiciousActivity) {
        suggestedAction = 'INVESTIGATE';
        reason = 'Suspicious activity pattern detected';
      }

      recommendations.push({
        email: user.email,
        reason,
        timeToAutoUnlock,
        confidence: analysis.legitimacyScore,
        suggestedAction,
      });
    }

    return recommendations;
  }

  // Private helper methods

  private async getActiveLockouts() {
    return this.prisma.accountLockout.findMany({
      where: {
        lockedUntil: {
          gt: new Date(),
        },
      },
      select: {
        email: true,
        lockedUntil: true,
        createdAt: true,
      },
    });
  }

  private async getRateLimitViolations() {
    try {
      const keys = await this.redisService.keys('rate_limit:*');
      const violations: Array<{
        key: string;
        count: number;
        resetTime: number;
        type: 'ip' | 'user';
      }> = [];

      for (const key of keys) {
        const data = await this.redisService.getRateLimit(key);
        if (data && data.count > 0) {
          violations.push({
            key,
            count: data.count,
            resetTime: data.resetTime,
            type: key.includes(':ip:') ? ('ip' as const) : ('user' as const),
          });
        }
      }

      return violations;
    } catch (error) {
      this.logger.warn('Error getting rate limit violations:', error);
      return [];
    }
  }

  private async getRecentSecurityEvents() {
    try {
      const events = await this.redisService.keys('security_event:*');
      const eventCounts = new Map<string, number>();

      for (const eventKey of events) {
        const event = await this.redisService.get(eventKey);
        if (event && typeof event === 'object' && 'type' in event) {
          const type = (event as any).type;
          eventCounts.set(type, (eventCounts.get(type) || 0) + 1);
        }
      }

      return Array.from(eventCounts.entries()).map(([type, count]) => ({
        type,
        count,
        lastOccurrence: new Date(), // Simplified - could track actual timestamps
      }));
    } catch (error) {
      this.logger.warn('Error getting security events:', error);
      return [];
    }
  }

  private async getSuspiciousIps() {
    // Simplified implementation - could be enhanced with more sophisticated analysis
    try {
      const violations = await this.getRateLimitViolations();
      const ipViolations = violations.filter((v) => v.type === 'ip');

      return ipViolations
        .map((v) => {
          const ip = v.key.split(':')[2]; // Extract IP from rate_limit:ip:x.x.x.x:route
          return {
            ip,
            eventCount: v.count,
            riskScore: Math.min(v.count * 10, 100), // Simple risk scoring
            lastActivity: new Date(v.resetTime),
          };
        })
        .filter((ip) => ip.riskScore > 50); // Only return high-risk IPs
    } catch (error) {
      this.logger.warn('Error getting suspicious IPs:', error);
      return [];
    }
  }

  private async getSystemHealth() {
    const [redisHealth, dbHealth] = await Promise.all([
      this.redisService.healthCheck(),
      this.checkDatabaseHealth(),
    ]);

    return {
      redis: redisHealth,
      database: dbHealth,
    };
  }

  private async checkDatabaseHealth(): Promise<{
    status: 'healthy' | 'unhealthy';
    latency?: number;
  }> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;

      return { status: 'healthy', latency };
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      return { status: 'unhealthy' };
    }
  }

  private async clearUserRateLimits(email: string): Promise<string[]> {
    try {
      // This is a simplified approach - in a real implementation,
      // you might track user sessions to find their IPs
      const userKeys = await this.redisService.keys(
        `rate_limit:user:*:${email}:*`,
      );
      await Promise.all(userKeys.map((key) => this.redisService.del(key)));
      return userKeys;
    } catch (error) {
      this.logger.warn('Error clearing user rate limits:', error);
      return [];
    }
  }

  private async clearIpRateLimits(ip: string): Promise<string[]> {
    try {
      const ipKeys = await this.redisService.keys(`rate_limit:*:${ip}:*`);
      await Promise.all(ipKeys.map((key) => this.redisService.del(key)));
      return ipKeys;
    } catch (error) {
      this.logger.warn('Error clearing IP rate limits:', error);
      return [];
    }
  }

  private async analyzeUserBehavior(email: string): Promise<{
    isLegitimateUser: boolean;
    suspiciousActivity: boolean;
    legitimacyScore: number;
  }> {
    try {
      // Get user's login history
      const recentAttempts = await this.prisma.loginAttempt.findMany({
        where: {
          email,
          attemptedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
        orderBy: { attemptedAt: 'desc' },
        take: 50,
      });

      const successfulLogins = recentAttempts.filter(
        (attempt) => attempt.result === 'SUCCESS',
      );
      const failedAttempts = recentAttempts.filter(
        (attempt) => attempt.result !== 'SUCCESS',
      );

      // Simple heuristics for user legitimacy
      const successRate =
        recentAttempts.length > 0
          ? successfulLogins.length / recentAttempts.length
          : 0;
      const hasRecentSuccess = successfulLogins.some(
        (attempt) =>
          attempt.attemptedAt > new Date(Date.now() - 24 * 60 * 60 * 1000),
      );

      const legitimacyScore = Math.round(
        successRate * 50 + // Success rate contributes up to 50 points
          (hasRecentSuccess ? 30 : 0) + // Recent success adds 30 points
          (recentAttempts.length > 5 ? 20 : 0), // Regular usage adds 20 points
      );

      return {
        isLegitimateUser: legitimacyScore > 60,
        suspiciousActivity: successRate < 0.1 && failedAttempts.length > 10,
        legitimacyScore,
      };
    } catch (error) {
      this.logger.warn(`Error analyzing user behavior for ${email}:`, error);
      return {
        isLegitimateUser: false,
        suspiciousActivity: false,
        legitimacyScore: 0,
      };
    }
  }
}
