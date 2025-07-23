import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TestDbHelper } from './test-db.helper';

export class AuthTestHelper {
  private static jwtService: JwtService;
  private static authService: AuthService;
  private static module: TestingModule;

  static async getAuthModule(): Promise<TestingModule> {
    if (!this.module) {
      this.module = await Test.createTestingModule({
        providers: [
          AuthService,
          JwtService,
          PrismaService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config = {
                  JWT_ACCESS_SECRET: 'test-access-secret',
                  JWT_REFRESH_SECRET: 'test-refresh-secret',
                  JWT_ACCESS_EXPIRES_IN: '15m',
                  JWT_REFRESH_EXPIRES_IN: '7d',
                };
                return config[key];
              }),
            },
          },
        ],
      }).compile();

      this.jwtService = this.module.get<JwtService>(JwtService);
      this.authService = this.module.get<AuthService>(AuthService);
    }

    return this.module;
  }

  static async generateValidJwtToken(payload: any = {}): Promise<string> {
    await this.getAuthModule();

    const defaultPayload = {
      sub: 'test-user-id',
      email: 'test@example.com',
      role: 'STUDENT',
      schoolId: 'test-school-id',
      tenantId: 'default',
      sessionId: 'test-session-id',
      ...payload,
    };

    return this.jwtService.sign(defaultPayload, {
      secret: 'test-access-secret',
      expiresIn: '15m',
    });
  }

  static async generateExpiredJwtToken(payload: any = {}): Promise<string> {
    await this.getAuthModule();

    const defaultPayload = {
      sub: 'test-user-id',
      email: 'test@example.com',
      role: 'STUDENT',
      schoolId: 'test-school-id',
      tenantId: 'default',
      sessionId: 'test-session-id',
      ...payload,
    };

    return this.jwtService.sign(defaultPayload, {
      secret: 'test-access-secret',
      expiresIn: '-1h', // Already expired
    });
  }

  static async generateRefreshToken(payload: any = {}): Promise<string> {
    await this.getAuthModule();

    const defaultPayload = {
      sub: 'test-user-id',
      sessionId: 'test-session-id',
      tokenFamily: 'test-token-family',
      ...payload,
    };

    return this.jwtService.sign(defaultPayload, {
      secret: 'test-refresh-secret',
      expiresIn: '7d',
    });
  }

  static async loginTestUser(
    email: string = 'test@example.com',
    password: string = 'TestPassword123!',
  ): Promise<{
    user: any;
    tokens: any;
  }> {
    await this.getAuthModule();

    // Create test user in database
    const testUser = await TestDbHelper.createTestUser({
      email,
      password: await this.hashPassword(password),
    });

    // Simulate login
    const loginResult = await this.authService.login(
      { email, password },
      {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      },
    );

    return loginResult;
  }

  static async hashPassword(password: string): Promise<string> {
    const argon2 = require('argon2');
    return await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3,
      parallelism: 1,
    });
  }

  static getAuthHeaders(token: string): { Authorization: string } {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  static async createTestUserWithTokens(userOverrides: any = {}): Promise<{
    user: any;
    accessToken: string;
    refreshToken: string;
  }> {
    const user = await TestDbHelper.createTestUser(userOverrides);
    const accessToken = await this.generateValidJwtToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId,
      tenantId: 'default',
    });
    const refreshToken = await this.generateRefreshToken({
      sub: user.id,
      sessionId: 'test-session',
    });

    return {
      user,
      accessToken,
      refreshToken,
    };
  }

  static async verifyJwtToken(token: string): Promise<any> {
    await this.getAuthModule();

    try {
      return this.jwtService.verify(token, {
        secret: 'test-access-secret',
      });
    } catch (error) {
      throw new Error(`Invalid token: ${error.message}`);
    }
  }

  static generateSecurityContext(overrides: any = {}): any {
    return {
      userId: 'test-user-id',
      tenantId: 'default',
      schoolId: 'test-school-id',
      role: 'STUDENT',
      permissions: [],
      sessionId: 'test-session-id',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      ...overrides,
    };
  }

  static async cleanup(): Promise<void> {
    if (this.module) {
      await this.module.close();
    }
  }
}
