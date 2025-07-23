import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface LoginAttemptData {
  email: string;
  success: boolean;
  failureReason?: string;
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
}

export interface AuditLogData {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async logLoginAttempt(data: LoginAttemptData): Promise<void> {
    try {
      const user = data.email
        ? await this.prisma.user.findUnique({
            where: { email: data.email },
            select: { id: true },
          })
        : null;

      await this.prisma.auditLog.create({
        data: {
          userId: user?.id,
          action: data.success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILURE',
          entityType: 'AUTH',
          entityId: user?.id || 'UNKNOWN',
          metadata: {
            email: data.email,
            success: data.success,
            failureReason: data.failureReason,
            ipAddress: data.ipAddress,
            userAgent: data.userAgent,
            deviceFingerprint: data.deviceFingerprint,
            timestamp: new Date().toISOString(),
          },
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
        },
      });
    } catch (error) {
      // Don't throw errors from audit logging
      this.logger.error('Failed to log login attempt', error);
    }
  }

  async createAuditLog(data: AuditLogData): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: data.userId,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          metadata: data.metadata || {},
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
        },
      });

      this.logger.debug(
        `Audit log created: ${data.action} on ${data.entityType}:${data.entityId} by user ${data.userId}`,
      );
    } catch (error) {
      this.logger.error('Failed to create audit log', error);
    }
  }

  async getAuditLogs(filters: {
    userId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const where: any = {};

    if (filters.userId) where.userId = filters.userId;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.action) where.action = filters.action;

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit || 50,
      skip: filters.offset || 0,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });
  }

  async getLoginHistory(
    userId: string,
    limit: number = 10,
  ): Promise<any[]> {
    return this.prisma.auditLog.findMany({
      where: {
        userId,
        action: {
          in: ['LOGIN_SUCCESS', 'LOGIN_FAILURE'],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getSecurityEvents(
    userId: string,
    days: number = 30,
  ): Promise<any[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.prisma.auditLog.findMany({
      where: {
        userId,
        action: {
          in: [
            'LOGIN_SUCCESS',
            'LOGIN_FAILURE',
            'PASSWORD_CHANGED',
            'PASSWORD_RESET',
            'MFA_ENABLED',
            'MFA_DISABLED',
            'ACCOUNT_LOCKED',
            'ACCOUNT_UNLOCKED',
          ],
        },
        createdAt: {
          gte: startDate,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cleanOldAuditLogs(retentionDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      const result = await this.prisma.auditLog.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate,
          },
        },
      });

      this.logger.log(
        `Cleaned ${result.count} audit logs older than ${retentionDays} days`,
      );

      return result.count;
    } catch (error) {
      this.logger.error('Failed to clean old audit logs', error);
      return 0;
    }
  }
}
