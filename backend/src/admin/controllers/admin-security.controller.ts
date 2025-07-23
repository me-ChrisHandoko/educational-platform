import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  AdminGuard,
  RequireAdminRole,
  RequireAdminPermissions,
  AdminRole,
  AdminPermission,
} from '../guards/admin.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SecurityContext } from '../../auth/interfaces/auth.interface';
import { AdminSecurityService } from '../services/admin-security.service';
import {
  UnlockUserDto,
  UnlockIpDto,
  BulkUnlockDto,
  SecurityEventQueryDto,
  EmergencyActionDto,
  MaintenanceModeDto,
  SecurityStatusResponseDto,
  UnlockResponseDto,
  BulkUnlockResponseDto,
} from '../dto/admin-security.dto';

@ApiTags('Admin Security Management')
@ApiBearerAuth()
@Controller('admin/security')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSecurityController {
  constructor(private adminSecurityService: AdminSecurityService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get comprehensive security overview' })
  @ApiResponse({
    status: 200,
    description: 'Security status retrieved',
    type: SecurityStatusResponseDto,
  })
  @RequireAdminPermissions(AdminPermission.VIEW_SECURITY)
  async getSecurityStatus(
    @CurrentUser() admin: SecurityContext,
  ): Promise<SecurityStatusResponseDto> {
    const overview = await this.adminSecurityService.getSecurityOverview();

    return {
      activeLockouts: overview.activeLockouts.length,
      rateLimitViolations: overview.rateLimitViolations.length,
      securityEvents: overview.securityEvents.reduce(
        (sum, event) => sum + event.count,
        0,
      ),
      suspiciousIps: overview.suspiciousIps.map((ip) => ip.ip),
      systemHealth: overview.systemHealth,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('locked-users')
  @ApiOperation({ summary: 'Get list of currently locked user accounts' })
  @ApiResponse({ status: 200, description: 'Locked users retrieved' })
  @RequireAdminPermissions(AdminPermission.VIEW_SECURITY)
  async getLockedUsers(@CurrentUser() admin: SecurityContext) {
    const overview = await this.adminSecurityService.getSecurityOverview();
    return {
      lockedUsers: overview.activeLockouts,
      total: overview.activeLockouts.length,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('rate-limits')
  @ApiOperation({ summary: 'Get current rate limit violations' })
  @ApiResponse({ status: 200, description: 'Rate limit data retrieved' })
  @RequireAdminPermissions(AdminPermission.VIEW_SECURITY)
  async getRateLimitViolations(@CurrentUser() admin: SecurityContext) {
    const overview = await this.adminSecurityService.getSecurityOverview();
    return {
      violations: overview.rateLimitViolations,
      total: overview.rateLimitViolations.length,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('events')
  @ApiOperation({ summary: 'Get security events with pagination' })
  @ApiResponse({ status: 200, description: 'Security events retrieved' })
  @RequireAdminPermissions(AdminPermission.VIEW_SECURITY)
  async getSecurityEvents(
    @Query(ValidationPipe) query: SecurityEventQueryDto,
    @CurrentUser() admin: SecurityContext,
  ) {
    // This is a simplified implementation - could be enhanced with actual pagination
    const overview = await this.adminSecurityService.getSecurityOverview();

    let events = overview.securityEvents;

    // Apply filters
    if (query.type) {
      events = events.filter((event) => event.type.includes(query.type!));
    }

    // Simple pagination
    const page = query.page || 1;
    const limit = query.limit || 20;
    const start = (page - 1) * limit;
    const end = start + limit;

    return {
      events: events.slice(start, end),
      pagination: {
        page,
        limit,
        total: events.length,
        pages: Math.ceil(events.length / limit),
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('recommendations')
  @ApiOperation({
    summary: 'Get unlock recommendations based on user behavior analysis',
  })
  @ApiResponse({ status: 200, description: 'Unlock recommendations retrieved' })
  @RequireAdminPermissions(AdminPermission.VIEW_SECURITY)
  async getUnlockRecommendations(@CurrentUser() admin: SecurityContext) {
    const recommendations =
      await this.adminSecurityService.getUnlockRecommendations();
    return {
      recommendations,
      total: recommendations.length,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('unlock-user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock a specific user account' })
  @ApiResponse({
    status: 200,
    description: 'User unlocked successfully',
    type: UnlockResponseDto,
  })
  @RequireAdminPermissions(AdminPermission.MANAGE_SECURITY)
  async unlockUser(
    @Body(ValidationPipe) dto: UnlockUserDto,
    @CurrentUser() admin: SecurityContext,
  ): Promise<UnlockResponseDto> {
    const result = await this.adminSecurityService.unlockUser(
      dto.email,
      admin.userId,
      dto.reason,
    );

    if (result.action === 'error') {
      return {
        message: result.message,
        unlockedBy: admin.userId,
        timestamp: new Date().toISOString(),
        metadata: { error: true },
      };
    }

    return {
      message: result.message,
      unlockedBy: admin.userId,
      timestamp: new Date().toISOString(),
      metadata: {
        email: result.email,
        clearedKeys: result.clearedKeys?.length || 0,
        timeToAutoUnlock: result.timeToAutoUnlock,
      },
    };
  }

  @Post('unlock-ip')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock a specific IP address' })
  @ApiResponse({
    status: 200,
    description: 'IP unlocked successfully',
    type: UnlockResponseDto,
  })
  @RequireAdminPermissions(AdminPermission.MANAGE_SECURITY)
  async unlockIp(
    @Body(ValidationPipe) dto: UnlockIpDto,
    @CurrentUser() admin: SecurityContext,
  ): Promise<UnlockResponseDto> {
    const result = await this.adminSecurityService.unlockIp(
      dto.ip,
      admin.userId,
      dto.reason,
    );

    if (result.action === 'error') {
      return {
        message: result.message,
        unlockedBy: admin.userId,
        timestamp: new Date().toISOString(),
        metadata: { error: true },
      };
    }

    return {
      message: result.message,
      unlockedBy: admin.userId,
      timestamp: new Date().toISOString(),
      metadata: {
        ip: result.ip,
        clearedKeys: result.clearedKeys?.length || 0,
      },
    };
  }

  @Post('bulk-unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk unlock users and IPs' })
  @ApiResponse({
    status: 200,
    description: 'Bulk unlock completed',
    type: BulkUnlockResponseDto,
  })
  @RequireAdminPermissions(AdminPermission.BULK_OPERATIONS)
  async bulkUnlock(
    @Body(ValidationPipe) dto: BulkUnlockDto,
    @CurrentUser() admin: SecurityContext,
  ): Promise<BulkUnlockResponseDto> {
    const results = await this.adminSecurityService.bulkUnlock(
      dto.emails || [],
      dto.ips || [],
      admin.userId,
      dto.reason,
    );

    return {
      message: 'Bulk unlock operation completed',
      results,
      processedBy: admin.userId,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('emergency/unlock-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Emergency unlock all users and IPs (requires SUPER_ADMIN)',
  })
  @ApiResponse({ status: 200, description: 'Emergency unlock completed' })
  @RequireAdminRole(AdminRole.SUPER_ADMIN)
  @RequireAdminPermissions(AdminPermission.EMERGENCY_OVERRIDE)
  async emergencyUnlockAll(
    @Body(ValidationPipe) dto: EmergencyActionDto,
    @CurrentUser() admin: SecurityContext,
  ) {
    const result = await this.adminSecurityService.emergencyUnlockAll(
      admin.userId,
      dto.confirmationCode,
      dto.reason,
    );

    return {
      message: 'Emergency unlock completed - ALL security restrictions cleared',
      ...result,
      executedBy: admin.userId,
      requiresSecurityReview: dto.requiresReview,
      timestamp: new Date().toISOString(),
      severity: 'CRITICAL',
    };
  }

  @Post('maintenance/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable system maintenance mode' })
  @ApiResponse({ status: 200, description: 'Maintenance mode enabled' })
  @RequireAdminRole(AdminRole.SUPER_ADMIN)
  @RequireAdminPermissions(AdminPermission.SYSTEM_CONFIG)
  async enableMaintenanceMode(
    @Body(ValidationPipe) dto: MaintenanceModeDto,
    @CurrentUser() admin: SecurityContext,
  ) {
    const result = await this.adminSecurityService.setMaintenanceMode(
      true,
      admin.userId,
      dto.reason,
      dto.durationMinutes,
    );

    return {
      message: 'Maintenance mode enabled',
      status: result.status,
      duration: `${dto.durationMinutes} minutes`,
      expiresAt: result.expiresAt?.toISOString(),
      reason: dto.reason,
      enabledBy: admin.userId,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('maintenance/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable system maintenance mode' })
  @ApiResponse({ status: 200, description: 'Maintenance mode disabled' })
  @RequireAdminRole(AdminRole.SUPER_ADMIN)
  @RequireAdminPermissions(AdminPermission.SYSTEM_CONFIG)
  async disableMaintenanceMode(
    @Body() body: { reason: string },
    @CurrentUser() admin: SecurityContext,
  ) {
    const result = await this.adminSecurityService.setMaintenanceMode(
      false,
      admin.userId,
      body.reason,
    );

    return {
      message: 'Maintenance mode disabled',
      status: result.status,
      disabledBy: admin.userId,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('suspicious-ips')
  @ApiOperation({ summary: 'Get list of suspicious IP addresses' })
  @ApiResponse({ status: 200, description: 'Suspicious IPs retrieved' })
  @RequireAdminPermissions(AdminPermission.VIEW_SECURITY)
  async getSuspiciousIps(@CurrentUser() admin: SecurityContext) {
    const overview = await this.adminSecurityService.getSecurityOverview();
    return {
      suspiciousIps: overview.suspiciousIps,
      total: overview.suspiciousIps.length,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('system-health')
  @ApiOperation({ summary: 'Get system health status' })
  @ApiResponse({ status: 200, description: 'System health retrieved' })
  @RequireAdminPermissions(AdminPermission.VIEW_SECURITY)
  async getSystemHealth(@CurrentUser() admin: SecurityContext) {
    const overview = await this.adminSecurityService.getSecurityOverview();
    return {
      systemHealth: overview.systemHealth,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('audit/recent')
  @ApiOperation({ summary: 'Get recent admin actions for audit trail' })
  @ApiResponse({ status: 200, description: 'Recent admin actions retrieved' })
  @RequireAdminPermissions(AdminPermission.VIEW_SECURITY)
  async getRecentAdminActions(
    @CurrentUser() admin: SecurityContext,
    @Query('hours') hours: string = '24',
    @Query('adminId') adminId?: string,
  ) {
    // Only super admins can view other admins' actions
    const targetAdminId =
      admin.role === AdminRole.SUPER_ADMIN ? adminId : admin.userId;

    const actions = await this.adminSecurityService.getUnlockRecommendations(); // Placeholder
    return {
      actions: [], // Would be implemented with actual audit service
      filters: {
        hours: parseInt(hours),
        adminId: targetAdminId,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
