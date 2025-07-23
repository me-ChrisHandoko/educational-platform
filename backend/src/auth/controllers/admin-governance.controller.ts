import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  ParseArrayPipe,
  ValidationPipe,
  BadRequestException
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { SecurityContext } from '../interfaces/auth.interface';
import { AdminGovernanceService } from '../services/admin-governance.service';
import { SecurityMonitoringService } from '../services/security-monitoring.service';
import { UserRole, AlertSeverity, AlertStatus, RiskLevel } from '@prisma/client';
import { IsString, IsOptional, IsArray, IsEnum, IsDateString, MinLength } from 'class-validator';

// DTOs for request validation
export class SuspendUserDto {
  @IsString()
  @MinLength(10, { message: 'Suspension reason must be at least 10 characters' })
  reason: string;
}

export class BulkUserOperationDto {
  @IsArray()
  @IsString({ each: true })
  userIds: string[];

  @IsEnum(['suspend', 'reactivate', 'terminate_sessions'])
  operation: 'suspend' | 'reactivate' | 'terminate_sessions';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ComplianceReportDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}

@Controller('admin/governance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminGovernanceController {
  private readonly logger = new Logger(AdminGovernanceController.name);

  constructor(
    private adminGovernanceService: AdminGovernanceService,
    private securityMonitoringService: SecurityMonitoringService,
  ) {}

  /**
   * Get comprehensive admin dashboard metrics
   */
  @Get('dashboard')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  async getDashboard(@CurrentUser() admin: SecurityContext) {
    this.logger.log(`Admin ${admin.userId} accessed governance dashboard`);

    const metrics = await this.adminGovernanceService.getDashboardMetrics();

    return {
      success: true,
      data: metrics,
      meta: {
        requestedBy: admin.userId,
        timestamp: new Date(),
        accessLevel: admin.role
      }
    };
  }

  /**
   * Get user management data with filtering and pagination
   */
  @Get('users')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 requests per minute
  async getUserManagement(
    @CurrentUser() admin: SecurityContext,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('role') role?: UserRole,
    @Query('riskLevel') riskLevel?: RiskLevel,
    @Query('sortBy') sortBy: 'securityScore' | 'lastLogin' | 'riskLevel' = 'securityScore'
  ) {
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    const result = await this.adminGovernanceService.getUserManagementData(
      pageNum,
      limitNum,
      role,
      riskLevel,
      sortBy
    );

    this.logger.log(`Admin ${admin.userId} accessed user management (page ${pageNum}, ${result.users.length} users)`);

    return {
      success: true,
      data: result,
      meta: {
        requestedBy: admin.userId,
        filters: { role, riskLevel, sortBy },
        timestamp: new Date()
      }
    };
  }

  /**
   * Get security incidents requiring attention
   */
  @Get('incidents')
  @Throttle({ default: { limit: 15, ttl: 60000 } }) // 15 requests per minute
  async getSecurityIncidents(
    @CurrentUser() admin: SecurityContext,
    @Query('severity') severity?: AlertSeverity,
    @Query('status') status?: AlertStatus,
    @Query('limit') limit: string = '20'
  ) {
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    const incidents = await this.adminGovernanceService.getSecurityIncidents(
      severity,
      status,
      limitNum
    );

    this.logger.log(`Admin ${admin.userId} accessed security incidents (${incidents.length} incidents)`);

    return {
      success: true,
      data: {
        incidents,
        total: incidents.length,
        filters: { severity, status }
      },
      meta: {
        requestedBy: admin.userId,
        timestamp: new Date()
      }
    };
  }

  /**
   * Force terminate all sessions for a user
   */
  @Post('users/:userId/terminate-sessions')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  async terminateUserSessions(
    @CurrentUser() admin: SecurityContext,
    @Param('userId') userId: string,
    @Body('reason') reason: string = 'Admin terminated sessions'
  ) {
    if (!userId || userId === admin.userId) {
      throw new BadRequestException('Cannot terminate own sessions or invalid user ID');
    }

    const terminatedCount = await this.adminGovernanceService.forceTerminateUserSessions(
      userId,
      admin.userId,
      reason
    );

    this.logger.warn(`Admin ${admin.userId} terminated ${terminatedCount} sessions for user ${userId}`);

    return {
      success: true,
      data: {
        userId,
        terminatedSessions: terminatedCount,
        reason,
        terminatedBy: admin.userId,
        timestamp: new Date()
      }
    };
  }

  /**
   * Suspend user account
   */
  @Post('users/:userId/suspend')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 300000 } }) // 3 requests per 5 minutes
  async suspendUser(
    @CurrentUser() admin: SecurityContext,
    @Param('userId') userId: string,
    @Body(new ValidationPipe()) suspendDto: SuspendUserDto
  ) {
    if (!userId || userId === admin.userId) {
      throw new BadRequestException('Cannot suspend own account or invalid user ID');
    }

    // Super admins cannot be suspended by regular admins
    if (admin.role === UserRole.ADMIN) {
      const targetUser = await this.adminGovernanceService['prisma'].user.findUnique({
        where: { id: userId },
        select: { role: true }
      });

      if (targetUser?.role === UserRole.ADMIN) {
        throw new BadRequestException('Insufficient privileges to suspend super admin');
      }
    }

    await this.adminGovernanceService.suspendUser(userId, admin.userId, suspendDto.reason);

    this.logger.warn(`Admin ${admin.userId} suspended user ${userId}: ${suspendDto.reason}`);

    return {
      success: true,
      data: {
        userId,
        status: 'SUSPENDED',
        reason: suspendDto.reason,
        suspendedBy: admin.userId,
        timestamp: new Date()
      }
    };
  }

  /**
   * Reactivate suspended user
   */
  @Post('users/:userId/reactivate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5 requests per 5 minutes
  async reactivateUser(
    @CurrentUser() admin: SecurityContext,
    @Param('userId') userId: string
  ) {
    if (!userId) {
      throw new BadRequestException('Invalid user ID');
    }

    await this.adminGovernanceService.reactivateUser(userId, admin.userId);

    this.logger.log(`Admin ${admin.userId} reactivated user ${userId}`);

    return {
      success: true,
      data: {
        userId,
        status: 'ACTIVE',
        reactivatedBy: admin.userId,
        timestamp: new Date()
      }
    };
  }

  /**
   * Bulk user operations
   */
  @Post('users/bulk-operation')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 2, ttl: 300000 } }) // 2 requests per 5 minutes
@Roles(UserRole.ADMIN) // Only admins can do bulk operations
  async bulkUserOperation(
    @CurrentUser() admin: SecurityContext,
    @Body(new ValidationPipe()) bulkDto: BulkUserOperationDto
  ) {
    if (bulkDto.userIds.length === 0) {
      throw new BadRequestException('No user IDs provided');
    }

    if (bulkDto.userIds.length > 50) {
      throw new BadRequestException('Cannot perform bulk operations on more than 50 users at once');
    }

    // Prevent admin from affecting their own account
    if (bulkDto.userIds.includes(admin.userId)) {
      throw new BadRequestException('Cannot include own account in bulk operations');
    }

    const result = await this.adminGovernanceService.bulkUserOperation(
      bulkDto.operation,
      bulkDto.userIds,
      admin.userId,
      bulkDto.reason
    );

    this.logger.warn(`Admin ${admin.userId} performed bulk ${bulkDto.operation} on ${bulkDto.userIds.length} users`);

    return {
      success: true,
      data: {
        operation: bulkDto.operation,
        results: result,
        totalUsers: bulkDto.userIds.length,
        successCount: result.success.length,
        failedCount: result.failed.length,
        performedBy: admin.userId,
        timestamp: new Date()
      }
    };
  }

  /**
   * Generate compliance report
   */
  @Post('reports/compliance')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // 3 requests per hour
  async generateComplianceReport(
    @CurrentUser() admin: SecurityContext,
    @Body(new ValidationPipe()) reportDto: ComplianceReportDto
  ) {
    const startDate = new Date(reportDto.startDate);
    const endDate = new Date(reportDto.endDate);

    // Validate date range
    if (startDate >= endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    if (endDate.getTime() - startDate.getTime() > 90 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Date range cannot exceed 90 days');
    }

    const report = await this.adminGovernanceService.generateComplianceReport(startDate, endDate);

    this.logger.log(`Admin ${admin.userId} generated compliance report for ${startDate.toISOString()} to ${endDate.toISOString()}`);

    return {
      success: true,
      data: report,
      meta: {
        generatedBy: admin.userId,
        generatedAt: new Date()
      }
    };
  }

  /**
   * Get real-time security monitoring data
   */
  @Get('monitoring/realtime')
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute
  async getRealTimeMonitoring(@CurrentUser() admin: SecurityContext) {
    const [
      systemHealth,
      securityMetrics,
      realtimeAlerts,
      userProfiles
    ] = await Promise.all([
      this.securityMonitoringService.getSystemHealth(),
      this.securityMonitoringService.getSecurityMetrics('hour'),
      this.securityMonitoringService.getRealTimeAlerts(10),
      this.securityMonitoringService.getUserSecurityProfiles(10, 'riskScore')
    ]);

    return {
      success: true,
      data: {
        systemHealth,
        metrics: securityMetrics,
        alerts: realtimeAlerts,
        riskiestUsers: userProfiles,
        lastUpdated: new Date()
      },
      meta: {
        requestedBy: admin.userId,
        timestamp: new Date()
      }
    };
  }

  /**
   * Get security analytics and trends
   */
  @Get('analytics')
  @Throttle({ default: { limit: 10, ttl: 300000 } }) // 10 requests per 5 minutes
  async getSecurityAnalytics(
    @CurrentUser() admin: SecurityContext,
    @Query('timeframe') timeframe: 'day' | 'week' | 'month' = 'day'
  ) {
    const [
      securityReport,
      threatAnalysis
    ] = await Promise.all([
      this.securityMonitoringService.generateSecurityReport(timeframe),
      this.securityMonitoringService.detectSecurityThreats()
    ]);

    this.logger.log(`Admin ${admin.userId} accessed security analytics (${timeframe})`);

    return {
      success: true,
      data: {
        report: securityReport,
        threats: threatAnalysis,
        timeframe
      },
      meta: {
        requestedBy: admin.userId,
        timestamp: new Date()
      }
    };
  }

  /**
   * Export audit logs (filtered)
   */
  @Get('audit/export')
  @Throttle({ default: { limit: 2, ttl: 3600000 } }) // 2 requests per hour
@Roles(UserRole.ADMIN) // Only admins can export audit logs
  async exportAuditLogs(
    @CurrentUser() admin: SecurityContext,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('userId') userId?: string,
    @Query('category') category?: string
  ) {
    // This would implement actual audit log export functionality
    // For now, just log the request and return a placeholder

    this.logger.warn(`Admin ${admin.userId} requested audit log export with filters: ${JSON.stringify({
      startDate, endDate, userId, category
    })}`);

    return {
      success: true,
      data: {
        message: 'Audit log export functionality not yet implemented',
        requestedBy: admin.userId,
        filters: { startDate, endDate, userId, category },
        timestamp: new Date()
      }
    };
  }
}