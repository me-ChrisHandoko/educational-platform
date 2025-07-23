import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import {
  AuthUser,
  AuthTokens,
  LoginResponse,
  JwtPayload,
  RefreshTokenPayload,
  LoginAttempt,
} from './interfaces/auth.interface';
import {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  ChangePasswordDto,
} from './dto/auth.dto';
import { AccountLockoutService } from './services/account-lockout.service';
import { MetricsService } from '../common/services/metrics.service';
import { AuditService } from '../common/services/audit.service';
import { CacheService } from '../common/services/cache.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly argon2Options = {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3,
    parallelism: 1,
  };

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private accountLockoutService: AccountLockoutService,
    private metricsService: MetricsService,
    private auditService: AuditService,
    private cacheService: CacheService,
  ) {}

  async validateUser(
    email: string,
    password: string,
    tenantId?: string,
    context?: {
      ipAddress: string;
      userAgent: string;
      deviceFingerprint?: string;
    },
  ): Promise<AuthUser | null> {
    const startTime = Date.now();
    
    try {
      this.logger.debug(`Validating user: ${email}`);
      
      // Check account lockout first
      const lockoutResult = await this.accountLockoutService.checkAccountLockout(email);
      if (lockoutResult.isLocked) {
        this.metricsService.incrementCounter('auth.login.locked');
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: 'Account is locked due to too many failed attempts',
            retryAfter: lockoutResult.canRetryAt?.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Check user cache first
      const cacheKey = `user:${email}`;
      let user = await this.cacheService.get(cacheKey);

      if (!user) {
        user = await this.prisma.user.findUnique({
          where: { email },
          include: {
            profile: {
              select: {
                firstName: true,
                lastName: true,
                avatar: true,
                displayName: true,
              },
            },
            school: {
              select: {
                id: true,
                tenantId: true,
                name: true,
                status: true,
              },
            },
          },
        });

        if (user) {
          // Cache user data for 5 minutes
          await this.cacheService.set(cacheKey, user, 300);
        }
      }

      if (!user) {
        this.logger.warn(`Login attempt for non-existent user: ${email}`);
        await this.handleFailedLogin(email, context, 'USER_NOT_FOUND');
        return null;
      }

      // Validate tenant if provided
      if (tenantId && user.school?.tenantId !== tenantId) {
        this.logger.warn(`Tenant mismatch for user: ${email}`);
        await this.handleFailedLogin(email, context, 'TENANT_MISMATCH');
        return null;
      }

      // Check if user account is active
      if (user.status !== 'ACTIVE') {
        await this.handleFailedLogin(email, context, 'ACCOUNT_INACTIVE');
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          message: 'Account is not active',
          code: 'ACCOUNT_INACTIVE',
        });
      }

      // Check school status
      if (user.school && user.school.status !== 'ACTIVE') {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          message: 'School is not active',
          code: 'SCHOOL_INACTIVE',
        });
      }

      // Verify password
      const isPasswordValid = await argon2.verify(user.password, password);
      
      if (!isPasswordValid) {
        this.logger.warn(`Invalid password for user: ${email}`);
        await this.handleFailedLogin(email, context, 'INVALID_PASSWORD');
        return null;
      }

      // Successful login
      await this.handleSuccessfulLogin(email, context);

      // Update last login timestamp
      await this.prisma.user.update({
        where: { id: user.id },
        data: { 
          lastLoginAt: new Date(),
          lastLoginIp: context?.ipAddress,
        },
      });

      // Clear user cache to ensure fresh data
      await this.cacheService.delete(cacheKey);

      // Record metrics
      const duration = Date.now() - startTime;
      this.metricsService.recordHistogram('auth.login.duration', duration);
      this.metricsService.incrementCounter('auth.login.success');

      return {
        id: user.id,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId,
        tenantId: user.school?.tenantId || 'default',
        status: user.status,
        profile: user.profile
          ? {
              firstName: user.profile.firstName,
              lastName: user.profile.lastName,
              avatar: user.profile.avatar || undefined,
              displayName: user.profile.displayName,
            }
          : undefined,
        lastLoginAt: new Date(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metricsService.recordHistogram('auth.login.duration', duration);
      this.metricsService.incrementCounter('auth.login.error');

      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Authentication error', error.stack);
      throw new UnauthorizedException('Authentication failed');
    }
  }

  async login(loginDto: LoginDto, context: any): Promise<LoginResponse> {
    const user = await this.validateUser(
      loginDto.email,
      loginDto.password,
      loginDto.tenantId,
      {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceFingerprint: loginDto.deviceFingerprint,
      },
    );

    if (!user) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        error: 'Unauthorized',
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
      });
    }

    const sessionId = uuidv7();
    const tokens = await this.generateTokens(user, sessionId);

    // Store session information
    await this.storeSession(user.id, sessionId, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceFingerprint: loginDto.deviceFingerprint,
    });

    // Check if first login or password change required
    const isFirstLogin = !user.lastLoginAt;
    const requiresPasswordChange = await this.checkPasswordExpiry(user.id);

    return {
      user,
      tokens,
      isFirstLogin,
      requiresPasswordChange,
      mfaRequired: false, // Will be implemented in MFA story
    };
  }

  async register(registerDto: RegisterDto): Promise<AuthUser> {
    const startTime = Date.now();

    try {
      // Validate password confirmation
      if (registerDto.password !== registerDto.confirmPassword) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: 'Password confirmation does not match',
          code: 'PASSWORD_MISMATCH',
        });
      }

      // Validate password strength
      this.validatePasswordStrength(registerDto.password);

      // Check if user already exists
      const existingUser = await this.prisma.user.findUnique({
        where: { email: registerDto.email },
      });

      if (existingUser) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'User with this email already exists',
          code: 'USER_EXISTS',
        });
      }

      // Verify school exists and is active
      const school = await this.prisma.school.findUnique({
        where: { id: registerDto.schoolId },
      });

      if (!school) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: 'Invalid school ID',
          code: 'INVALID_SCHOOL',
        });
      }

      if (school.status !== 'ACTIVE') {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          message: 'School is not active',
          code: 'SCHOOL_INACTIVE',
        });
      }

      // Hash password
      const hashedPassword = await argon2.hash(registerDto.password, this.argon2Options);

      // Create user and profile in transaction
      const result = await this.prisma.$transaction(async (tx) => {
        // Create user
        const user = await tx.user.create({
          data: {
            email: registerDto.email,
            password: hashedPassword,
            role: registerDto.role as any,
            schoolId: registerDto.schoolId,
            phoneNumber: registerDto.phoneNumber,
            status: 'ACTIVE',
            passwordChangedAt: new Date(),
          },
        });

        // Create user profile
        await tx.userProfile.create({
          data: {
            userId: user.id,
            firstName: registerDto.firstName,
            lastName: registerDto.lastName,
            displayName: `${registerDto.firstName} ${registerDto.lastName}`,
          },
        });

        // Create audit log
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'USER_REGISTERED',
            entityType: 'USER',
            entityId: user.id,
            metadata: {
              email: user.email,
              role: user.role,
              schoolId: user.schoolId,
            },
          },
        });

        return user;
      });

      // Record metrics
      const duration = Date.now() - startTime;
      this.metricsService.recordHistogram('auth.register.duration', duration);
      this.metricsService.incrementCounter('auth.register.success');

      this.logger.log(`New user registered: ${result.email}`);

      return {
        id: result.id,
        email: result.email,
        role: result.role,
        schoolId: result.schoolId,
        tenantId: school.tenantId,
        status: result.status,
        profile: {
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
          displayName: `${registerDto.firstName} ${registerDto.lastName}`,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metricsService.recordHistogram('auth.register.duration', duration);
      this.metricsService.incrementCounter('auth.register.error');

      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Registration error', error.stack);
      throw new UnauthorizedException('Registration failed');
    }
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto): Promise<AuthTokens> {
    try {
      const payload = this.jwtService.verify<RefreshTokenPayload>(
        refreshTokenDto.refreshToken,
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        },
      );

      // Validate session
      const session = await this.getSession(payload.sub, payload.sessionId);
      if (!session) {
        throw new UnauthorizedException('Invalid session');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          school: {
            select: {
              tenantId: true,
            },
          },
        },
      });

      if (!user || user.status !== 'ACTIVE') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const authUser: AuthUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId,
        tenantId: user.school?.tenantId || 'default',
        status: user.status,
      };

      // Check for token family reuse
      await this.checkTokenFamily(payload.sub, payload.tokenFamily);

      const newTokens = await this.generateTokens(authUser, payload.sessionId);

      // Update token family
      await this.updateTokenFamily(payload.sub, payload.tokenFamily);

      this.metricsService.incrementCounter('auth.refresh.success');

      return newTokens;
    } catch (error) {
      this.metricsService.incrementCounter('auth.refresh.error');
      
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Invalid refresh token');
      }
      
      throw error;
    }
  }

  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<void> {
    if (changePasswordDto.newPassword !== changePasswordDto.confirmPassword) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Password confirmation does not match',
        code: 'PASSWORD_MISMATCH',
      });
    }

    // Validate password strength
    this.validatePasswordStrength(changePasswordDto.newPassword);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await argon2.verify(
      user.password,
      changePasswordDto.currentPassword,
    );

    if (!isCurrentPasswordValid) {
      this.metricsService.incrementCounter('auth.password_change.invalid_current');
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        error: 'Unauthorized',
        message: 'Current password is incorrect',
        code: 'INVALID_CURRENT_PASSWORD',
      });
    }

    // Check password history
    await this.checkPasswordHistory(userId, changePasswordDto.newPassword);

    // Hash new password
    const hashedPassword = await argon2.hash(
      changePasswordDto.newPassword,
      this.argon2Options,
    );

    // Update password and log change
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          passwordChangedAt: new Date(),
        },
      });

      // Store in password history
      await tx.passwordHistory.create({
        data: {
          userId,
          password: hashedPassword,
        },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId,
          action: 'PASSWORD_CHANGED',
          entityType: 'USER',
          entityId: userId,
          metadata: {
            reason: changePasswordDto.reason || 'User initiated',
          },
        },
      });
    });

    // Invalidate all sessions
    await this.invalidateAllSessions(userId);

    this.metricsService.incrementCounter('auth.password_change.success');
    this.logger.log(`Password changed for user: ${userId}`);
  }

  async generateTokens(
    user: AuthUser,
    sessionId: string,
  ): Promise<AuthTokens> {
    const jwtPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId,
      tenantId: user.tenantId,
      sessionId,
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sessionId,
      tokenFamily: uuidv7(),
    };

    const accessTokenExpiresIn = this.configService.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
      '15m',
    );
    const refreshTokenExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(jwtPayload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTokenExpiresIn,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTokenExpiresIn,
      }),
    ]);

    const accessTokenExpiresAt = new Date(
      Date.now() + this.parseExpiresIn(accessTokenExpiresIn),
    );
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.parseExpiresIn(refreshTokenExpiresIn),
    );

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    };
  }

  private async handleFailedLogin(
    email: string,
    context: any,
    reason: string,
  ): Promise<void> {
    await this.accountLockoutService.recordFailedAttempt(
      email,
      context?.ipAddress || 'unknown',
      context?.userAgent || 'unknown',
      reason,
    );

    await this.auditService.logLoginAttempt({
      email,
      success: false,
      failureReason: reason,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      deviceFingerprint: context?.deviceFingerprint,
    });
  }

  private async handleSuccessfulLogin(
    email: string,
    context: any,
  ): Promise<void> {
    await this.accountLockoutService.recordSuccessfulAttempt(
      email,
      context?.ipAddress || 'unknown',
      context?.userAgent || 'unknown',
    );

    await this.auditService.logLoginAttempt({
      email,
      success: true,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      deviceFingerprint: context?.deviceFingerprint,
    });
  }

  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    if (!/[A-Z]/.test(password)) {
      throw new BadRequestException('Password must contain at least one uppercase letter');
    }

    if (!/[a-z]/.test(password)) {
      throw new BadRequestException('Password must contain at least one lowercase letter');
    }

    if (!/[0-9]/.test(password)) {
      throw new BadRequestException('Password must contain at least one number');
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      throw new BadRequestException('Password must contain at least one special character');
    }
  }

  private async checkPasswordHistory(
    userId: string,
    newPassword: string,
  ): Promise<void> {
    const history = await this.prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5, // Check last 5 passwords
    });

    for (const entry of history) {
      const isReused = await argon2.verify(entry.password, newPassword);
      if (isReused) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: 'Password has been used recently. Please choose a different password.',
          code: 'PASSWORD_REUSED',
        });
      }
    }
  }

  private async checkPasswordExpiry(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true },
    });

    if (!user?.passwordChangedAt) {
      return true; // No password change date, require change
    }

    const passwordMaxAge = this.configService.get<number>('PASSWORD_MAX_AGE_DAYS', 90);
    const daysSinceChange = Math.floor(
      (Date.now() - user.passwordChangedAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    return daysSinceChange >= passwordMaxAge;
  }

  private async storeSession(
    userId: string,
    sessionId: string,
    context: any,
  ): Promise<void> {
    const sessionKey = `session:${userId}:${sessionId}`;
    const sessionData = {
      userId,
      sessionId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceFingerprint: context.deviceFingerprint,
      createdAt: new Date().toISOString(),
    };

    await this.cacheService.set(
      sessionKey,
      sessionData,
      7 * 24 * 60 * 60, // 7 days
    );
  }

  private async getSession(userId: string, sessionId: string): Promise<any> {
    const sessionKey = `session:${userId}:${sessionId}`;
    return this.cacheService.get(sessionKey);
  }

  private async invalidateAllSessions(userId: string): Promise<void> {
    // Get all sessions for user
    const pattern = `session:${userId}:*`;
    const keys = await this.cacheService.keys(pattern);
    
    if (keys.length > 0) {
      await this.cacheService.deleteMany(keys);
    }
  }

  private async checkTokenFamily(userId: string, tokenFamily: string): Promise<void> {
    const familyKey = `token_family:${userId}:${tokenFamily}`;
    const exists = await this.cacheService.exists(familyKey);

    if (exists) {
      // Token family reuse detected - possible token theft
      await this.invalidateAllSessions(userId);
      this.logger.error(`Token family reuse detected for user: ${userId}`);
      throw new UnauthorizedException('Token security violation detected');
    }
  }

  private async updateTokenFamily(userId: string, tokenFamily: string): Promise<void> {
    const familyKey = `token_family:${userId}:${tokenFamily}`;
    await this.cacheService.set(familyKey, true, 7 * 24 * 60 * 60); // 7 days
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error(`Invalid expiresIn format: ${expiresIn}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return value * multipliers[unit];
  }
}
