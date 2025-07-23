import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface LoginAttemptResult {
  isLocked: boolean;
  remainingAttempts?: number;
  lockoutExpiresAt?: Date;
  canRetryAt?: Date;
}

@Injectable()
export class AccountLockoutService {
  private readonly maxFailedAttempts: number;
  private readonly lockoutDurationMs: number;
  private readonly attemptWindowMs: number;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.maxFailedAttempts = this.configService.get<number>(
      'AUTH_MAX_FAILED_ATTEMPTS',
      5,
    );
    this.lockoutDurationMs = this.configService.get<number>(
      'AUTH_LOCKOUT_DURATION_MS',
      15 * 60 * 1000, // 15 minutes
    );
    this.attemptWindowMs = this.configService.get<number>(
      'AUTH_ATTEMPT_WINDOW_MS',
      5 * 60 * 1000, // 5 minutes
    );
  }

  async checkAccountLockout(email: string): Promise<LoginAttemptResult> {
    const cacheKey = `lockout:${email}`;
    const now = new Date();

    // Check if account is currently locked
    const lockoutRecord = await this.getLockoutRecord(email);

    if (
      lockoutRecord &&
      lockoutRecord.lockedUntil &&
      lockoutRecord.lockedUntil > now
    ) {
      return {
        isLocked: true,
        lockoutExpiresAt: lockoutRecord.lockedUntil,
        canRetryAt: lockoutRecord.lockedUntil,
      };
    }

    // Get failed attempts within the window
    const windowStart = new Date(now.getTime() - this.attemptWindowMs);
    const failedAttempts = await this.getFailedAttemptsCount(
      email,
      windowStart,
    );

    const remainingAttempts = Math.max(
      0,
      this.maxFailedAttempts - failedAttempts,
    );

    return {
      isLocked: false,
      remainingAttempts,
    };
  }

  async recordFailedAttempt(
    email: string,
    ipAddress: string,
    userAgent: string,
    failureReason?: string,
  ): Promise<LoginAttemptResult> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.attemptWindowMs);

    // Record the failed attempt
    await this.prisma.loginAttempt.create({
      data: {
        email,
        result: 'FAILED_PASSWORD',
        ipAddress,
        userAgent,
        createdAt: now,
        resultMessage: failureReason,
      },
    });

    // Count failed attempts in window
    const failedAttempts = await this.getFailedAttemptsCount(
      email,
      windowStart,
    );

    // Check if lockout is needed
    if (failedAttempts >= this.maxFailedAttempts) {
      const lockoutExpiresAt = new Date(now.getTime() + this.lockoutDurationMs);

      await this.createOrUpdateLockout(email, lockoutExpiresAt);

      return {
        isLocked: true,
        lockoutExpiresAt,
        canRetryAt: lockoutExpiresAt,
      };
    }

    return {
      isLocked: false,
      remainingAttempts: this.maxFailedAttempts - failedAttempts,
    };
  }

  async recordSuccessfulAttempt(
    email: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    const now = new Date();

    // Record successful attempt
    await this.prisma.loginAttempt.create({
      data: {
        email,
        result: 'SUCCESS',
        ipAddress,
        userAgent,
        createdAt: now,
      },
    });

    // Clear any lockout
    await this.clearLockout(email);
  }

  async clearLockout(email: string): Promise<void> {
    await this.prisma.accountLockout.deleteMany({
      where: { email },
    });
  }

  private async getLockoutRecord(email: string) {
    return this.prisma.accountLockout.findFirst({
      where: { email },
      orderBy: { lockedUntil: 'desc' },
    });
  }

  private async getFailedAttemptsCount(
    email: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.loginAttempt.count({
      where: {
        email,
        result: { not: 'SUCCESS' },
        createdAt: {
          gte: since,
        },
      },
    });
  }

  private async createOrUpdateLockout(
    email: string,
    lockedUntil: Date,
  ): Promise<void> {
    await this.prisma.accountLockout.upsert({
      where: { email },
      update: {
        lockedUntil,
        updatedAt: new Date(),
      },
      create: {
        email,
        lockedUntil,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}
