import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../services/permission.service';
import { TokenBlacklistService } from '../services/token-blacklist.service';
import { RedisService } from '../../redis/redis.service';
import { JwtPayload, SecurityContext } from '../interfaces/auth.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private permissionService: PermissionService,
    private tokenBlacklistService: TokenBlacklistService,
    private redisService: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: (() => {
        const secret = configService.get<string>('JWT_ACCESS_SECRET');
        if (!secret) {
          throw new Error(
            'JWT_ACCESS_SECRET is required but not configured. Please set the environment variable.',
          );
        }
        return secret;
      })(),
    });
  }

  async validate(payload: JwtPayload, request?: any): Promise<SecurityContext> {
    const { sub: userId, email, role, schoolId, tenantId, sessionId } = payload;

    // Extract the token from the request
    const token = this.extractTokenFromRequest(request);

    // Check if token is blacklisted
    if (token && (await this.tokenBlacklistService.isTokenBlacklisted(token))) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Check cached user status first
    let userStatus = await this.redisService.getUserStatus(userId);

    if (!userStatus) {
      // User status not cached, query database
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          status: true,
          role: true,
          schoolId: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Cache user status for 5 minutes
      userStatus = user.status;
      await this.redisService.setUserStatus(userId, userStatus, 300);

      // Verify email matches (in case of email change)
      if (user.email !== email) {
        throw new UnauthorizedException('Token invalid');
      }
    }

    if (userStatus !== 'ACTIVE') {
      throw new UnauthorizedException('User account is not active');
    }

    // Extract client information (will be available from request context)
    const ipAddress = 'unknown'; // Will be set by middleware
    const userAgent = 'unknown'; // Will be set by middleware

    // Check cached permissions first
    let permissions = await this.redisService.getUserPermissions(userId);

    if (!permissions) {
      // Permissions not cached, load from permission service
      const userPermissions = await this.permissionService.getUserPermissions(
        userId,
        role,
      );
      permissions = userPermissions.permissions;

      // Cache permissions for 10 minutes
      await this.redisService.cacheUserPermissions(userId, permissions, 600);
    }

    return {
      userId,
      tenantId,
      schoolId,
      role,
      permissions,
      sessionId,
      ipAddress,
      userAgent,
    };
  }

  private extractTokenFromRequest(request: any): string | null {
    if (!request || !request.headers) {
      return null;
    }

    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }
}
