/**
 * Example usage of improved authentication and authorization system
 * This file demonstrates how to use the new security features
 */

import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Roles } from '../decorators/roles.decorator';
import {
  RequirePermissions,
  Permission,
} from '../decorators/permissions.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('examples')
@UseGuards(JwtAuthGuard)
export class AuthExampleController {
  /**
   * Example 1: Role-based access
   * Only ADMIN and SUPER_ADMIN can access
   */
  @Get('admin-only')
  @Roles('ADMIN', 'SUPER_ADMIN')
  adminOnlyEndpoint() {
    return { message: 'This is admin-only content' };
  }

  /**
   * Example 2: Permission-based access
   * Requires specific permission regardless of role
   */
  @Get('user-management')
  @RequirePermissions(Permission.USER_READ, Permission.USER_UPDATE)
  userManagementEndpoint() {
    return { message: 'User management interface' };
  }

  /**
   * Example 3: Combined role and permission check
   * Must be TEACHER or higher AND have course creation permission
   */
  @Post('courses')
  @Roles('TEACHER', 'ADMIN', 'SUPER_ADMIN')
  @RequirePermissions(Permission.COURSE_CREATE)
  createCourse(@CurrentUser() user: any) {
    return {
      message: `Course creation initiated by ${user.email}`,
      permissions: user.permissions,
    };
  }

  /**
   * Example 4: Rate limited endpoint
   * Different limits for different operations
   */
  @Post('sensitive-operation')
  @Throttle({ short: { limit: 2, ttl: 60000 } }) // 2 per minute
  @RequirePermissions(Permission.SYSTEM_CONFIG)
  sensitiveOperation() {
    return { message: 'Sensitive operation completed' };
  }

  /**
   * Example 5: Getting current user context
   * Shows how to access user information in controllers
   */
  @Get('profile')
  getUserProfile(@CurrentUser() user: any) {
    return {
      userId: user.userId,
      role: user.role,
      permissions: user.permissions,
      tenantId: user.tenantId,
      schoolId: user.schoolId,
    };
  }

  /**
   * Example 6: Permission-based data filtering
   * Different data based on user permissions
   */
  @Get('analytics')
  @RequirePermissions(Permission.ANALYTICS_VIEW)
  getAnalytics(@CurrentUser() user: any) {
    const canViewSystem = user.permissions.includes(Permission.SYSTEM_MONITOR);

    return {
      userAnalytics: 'Always visible with ANALYTICS_VIEW',
      systemAnalytics: canViewSystem ? 'System-wide data' : 'Not authorized',
    };
  }
}

/**
 * Example middleware usage for additional security
 */
export const authExampleUsage = {
  // How to check permissions programmatically
  checkUserPermissions: async (
    permissionService: any,
    userId: string,
    role: string,
  ) => {
    const permissions = await permissionService.getUserPermissions(
      userId,
      role,
    );

    const canManageUsers = await permissionService.hasPermission(
      userId,
      role,
      Permission.USER_CREATE,
    );
    const canAccessAnalytics = await permissionService.hasAnyPermission(
      userId,
      role,
      [Permission.ANALYTICS_VIEW, Permission.REPORTS_GENERATE],
    );

    return { permissions, canManageUsers, canAccessAnalytics };
  },

  // How to handle account lockouts
  handleLoginAttempt: async (
    lockoutService: any,
    email: string,
    success: boolean,
    context: any,
  ) => {
    if (success) {
      await lockoutService.recordSuccessfulAttempt(
        email,
        context.ipAddress,
        context.userAgent,
      );
    } else {
      const lockoutResult = await lockoutService.recordFailedAttempt(
        email,
        context.ipAddress,
        context.userAgent,
      );

      if (lockoutResult.isLocked) {
        throw new Error(
          `Account locked until ${lockoutResult.lockoutExpiresAt}`,
        );
      }

      console.log(`${lockoutResult.remainingAttempts} attempts remaining`);
    }
  },

  // Security best practices
  securityGuidelines: {
    rateLimit: 'Use @Throttle decorator on sensitive endpoints',
    permissions: 'Always use granular permissions over role checks',
    logging: 'Log all authentication and authorization events',
    validation: 'Validate all input data with class-validator',
    encryption: 'Use Argon2 for password hashing',
    tokens: 'Keep JWT tokens short-lived (15min) with refresh tokens',
    lockout: 'Implement progressive lockout delays',
    monitoring: 'Monitor failed login attempts and suspicious activities',
  },
};
