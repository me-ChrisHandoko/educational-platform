import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SecurityContext } from '../../auth/interfaces/auth.interface';

export enum AdminRole {
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum AdminPermission {
  MANAGE_SECURITY = 'MANAGE_SECURITY',
  VIEW_SECURITY = 'VIEW_SECURITY',
  EMERGENCY_OVERRIDE = 'EMERGENCY_OVERRIDE',
  BULK_OPERATIONS = 'BULK_OPERATIONS',
  USER_MANAGEMENT = 'USER_MANAGEMENT',
  SYSTEM_CONFIG = 'SYSTEM_CONFIG',
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: SecurityContext = request.user;

    // Check if user is authenticated
    if (!user) {
      throw new UnauthorizedException(
        'Authentication required for admin access',
      );
    }

    // Check required admin role
    const requiredRole = this.reflector.getAllAndOverride<AdminRole>(
      'adminRole',
      [context.getHandler(), context.getClass()],
    );

    if (requiredRole && !this.hasAdminRole(user, requiredRole)) {
      throw new ForbiddenException(`${requiredRole} role required`);
    }

    // Check required admin permissions
    const requiredPermissions = this.reflector.getAllAndOverride<
      AdminPermission[]
    >('adminPermissions', [context.getHandler(), context.getClass()]);

    if (
      requiredPermissions &&
      !this.hasAdminPermissions(user, requiredPermissions)
    ) {
      throw new ForbiddenException(
        `Required permissions: ${requiredPermissions.join(', ')}`,
      );
    }

    // Basic admin role check if no specific requirements
    if (!requiredRole && !requiredPermissions && !this.isAdmin(user)) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }

  private isAdmin(user: SecurityContext): boolean {
    return user.role === AdminRole.ADMIN || user.role === AdminRole.SUPER_ADMIN;
  }

  private hasAdminRole(
    user: SecurityContext,
    requiredRole: AdminRole,
  ): boolean {
    if (requiredRole === AdminRole.SUPER_ADMIN) {
      return user.role === AdminRole.SUPER_ADMIN;
    }

    return user.role === AdminRole.ADMIN || user.role === AdminRole.SUPER_ADMIN;
  }

  private hasAdminPermissions(
    user: SecurityContext,
    requiredPermissions: AdminPermission[],
  ): boolean {
    if (!user.permissions || user.permissions.length === 0) {
      return false;
    }

    // Super admin has all permissions
    if (user.role === AdminRole.SUPER_ADMIN) {
      return true;
    }

    // Check if user has all required permissions
    return requiredPermissions.every((permission) =>
      user.permissions.includes(permission),
    );
  }
}

// Decorators for admin access control
export const RequireAdminRole = (role: AdminRole) => {
  return (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ) => {
    Reflect.defineMetadata(
      'adminRole',
      role,
      descriptor ? descriptor.value : target,
    );
  };
};

export const RequireAdminPermissions = (...permissions: AdminPermission[]) => {
  return (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ) => {
    Reflect.defineMetadata(
      'adminPermissions',
      permissions,
      descriptor ? descriptor.value : target,
    );
  };
};
