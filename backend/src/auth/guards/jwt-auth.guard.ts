import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if the route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Validate JWT token
    const canActivate = await super.canActivate(context);
    if (!canActivate) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = (request as any).user;

    if (!user) {
      throw new UnauthorizedException('User not found in token');
    }

    // Check roles if specified
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.includes(user.role);
      if (!hasRole) {
        throw new ForbiddenException('Insufficient role permissions');
      }
    }

    // Check permissions if specified
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredPermissions && requiredPermissions.length > 0) {
      const hasPermission = requiredPermissions.every((permission) =>
        user.permissions?.includes(permission),
      );
      if (!hasPermission) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    // Update request context with user info
    if ((request as any).context) {
      (request as any).context.userId = user.userId;
      (request as any).context.userRole = user.role;
      (request as any).context.tenantId = user.tenantId;
    }

    return true;
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token has expired');
      }
      if (info?.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid token format');
      }
      if (info?.name === 'NotBeforeError') {
        throw new UnauthorizedException('Token not active yet');
      }
      throw err || new UnauthorizedException('Authentication failed');
    }
    return user;
  }
}
