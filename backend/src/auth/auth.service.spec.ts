import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestDbHelper } from '../../test/helpers/test-db.helper';
import { createMockUser } from '../../test/types/test-types';
import * as argon2 from 'argon2';

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let module: TestingModule;

  beforeAll(async () => {
    await TestDbHelper.clearDatabase();
  });

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            userProfile: {
              create: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
            verify: jest.fn(),
          },
        },
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
              return config[key as keyof typeof config];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await TestDbHelper.disconnect();
    if (module) {
      await module.close();
    }
  });

  describe('validateUser', () => {
    it('should return null when user does not exist', async () => {
      // Arrange
      const email = 'nonexistent@example.com';
      const password = 'password123';
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);
      const logSpy = jest
        .spyOn(service as any, 'logLoginAttempt')
        .mockResolvedValue(undefined);

      // Act
      const result = await service.validateUser(email, password);

      // Assert
      expect(result).toBeNull();
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email },
        include: {
          profile: {
            select: {
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
        },
      });
      expect(logSpy).toHaveBeenCalledWith(
        email,
        false,
        'User not found',
        undefined,
      );
    });

    it('should throw ForbiddenException when user status is not ACTIVE', async () => {
      // Arrange
      const email = 'inactive@example.com';
      const password = 'password123';
      const inactiveUser = createMockUser({
        id: 'user-1',
        email,
        password: await argon2.hash('password123'),
        status: 'INACTIVE',
        role: 'STUDENT',
        schoolId: 'school-1',
        profile: null,
      });
      jest
        .spyOn(prismaService.user, 'findUnique')
        .mockResolvedValue(inactiveUser);
      const logSpy = jest
        .spyOn(service as any, 'logLoginAttempt')
        .mockResolvedValue(undefined);

      // Act & Assert
      await expect(service.validateUser(email, password)).rejects.toThrow(
        ForbiddenException,
      );
      expect(logSpy).toHaveBeenCalledWith(
        email,
        false,
        'Account not active',
        undefined,
      );
    });

    it('should return null when password is invalid', async () => {
      // Arrange
      const email = 'user@example.com';
      const password = 'wrongpassword';
      const user = createMockUser({
        id: 'user-1',
        email,
        password: await argon2.hash('correctpassword'),
        status: 'ACTIVE',
        role: 'STUDENT',
        schoolId: 'school-1',
        profile: null,
      });
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(user);
      const logSpy = jest
        .spyOn(service as any, 'logLoginAttempt')
        .mockResolvedValue(undefined);

      // Act
      const result = await service.validateUser(email, password);

      // Assert
      expect(result).toBeNull();
      expect(logSpy).toHaveBeenCalledWith(
        email,
        false,
        'Invalid password',
        undefined,
      );
    });

    it('should return AuthUser when credentials are valid', async () => {
      // Arrange
      const email = 'user@example.com';
      const password = 'correctpassword';
      const hashedPassword = await argon2.hash(password);
      const user = createMockUser({
        id: 'user-1',
        email,
        password: hashedPassword,
        status: 'ACTIVE',
        role: 'STUDENT',
        schoolId: 'school-1',
        lastLoginAt: new Date('2023-01-01'),
        profile: {
          firstName: 'John',
          lastName: 'Doe',
          avatar: null,
        },
      });
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(user);
      jest
        .spyOn(prismaService.user, 'update')
        .mockResolvedValue({ ...user, lastLoginAt: new Date() });
      const logSpy = jest
        .spyOn(service as any, 'logLoginAttempt')
        .mockResolvedValue(undefined);

      // Act
      const result = await service.validateUser(email, password);

      // Assert
      expect(result).toMatchObject({
        id: 'user-1',
        email,
        role: 'STUDENT',
        schoolId: 'school-1',
        tenantId: 'default',
        status: 'ACTIVE',
        profile: {
          firstName: 'John',
          lastName: 'Doe',
        },
      });
      expect(logSpy).toHaveBeenCalledWith(email, true, undefined, undefined);
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { lastLoginAt: expect.any(Date) as Date },
      });
    });

    it('should handle context information for logging', async () => {
      // Arrange
      const email = 'user@example.com';
      const password = 'password123';
      const context = {
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        deviceFingerprint: 'device123',
      };
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);
      const logSpy = jest
        .spyOn(service as any, 'logLoginAttempt')
        .mockResolvedValue(undefined);

      // Act
      await service.validateUser(email, password, undefined, context);

      // Assert
      expect(logSpy).toHaveBeenCalledWith(
        email,
        false,
        'User not found',
        context,
      );
    });
  });

  describe('register', () => {
    it('should throw BadRequestException when passwords do not match', async () => {
      // Arrange
      const registerDto = {
        email: 'user@example.com',
        password: 'password123',
        confirmPassword: 'differentpassword',
        firstName: 'John',
        lastName: 'Doe',
        schoolId: 'school-1',
        role: 'STUDENT',
      };

      // Act & Assert
      await expect(service.register(registerDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.register(registerDto)).rejects.toThrow(
        'Password confirmation does not match',
      );
    });

    it('should throw ConflictException when user already exists', async () => {
      // Arrange
      const registerDto = {
        email: 'existing@example.com',
        password: 'password123',
        confirmPassword: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        schoolId: 'school-1',
        role: 'STUDENT',
      };
      const existingUser = createMockUser({
        id: 'user-1',
        email: registerDto.email,
      });
      jest
        .spyOn(prismaService.user, 'findUnique')
        .mockResolvedValue(existingUser);

      // Act & Assert
      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.register(registerDto)).rejects.toThrow(
        'User with this email already exists',
      );
    });

    it('should create user and profile successfully', async () => {
      // Arrange
      const registerDto = {
        email: 'newuser@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        firstName: 'John',
        lastName: 'Doe',
        schoolId: 'school-1',
        role: 'STUDENT',
        phoneNumber: '+1234567890',
      };
      const createdUser = {
        id: 'user-1',
        email: registerDto.email,
        role: registerDto.role,
        schoolId: registerDto.schoolId,
        status: 'ACTIVE',
      };

      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback) => {
          return callback({
            user: {
              create: jest.fn().mockResolvedValue(createdUser),
            },
            userProfile: {
              create: jest.fn().mockResolvedValue({}),
            },
          });
        });

      // Act
      const result = await service.register(registerDto);

      // Assert
      expect(result).toMatchObject({
        id: 'user-1',
        email: registerDto.email,
        role: registerDto.role,
        schoolId: registerDto.schoolId,
        tenantId: 'default',
        status: 'ACTIVE',
        profile: {
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
        },
      });
    });
  });

  describe('login', () => {
    it('should throw UnauthorizedException when user validation fails', async () => {
      // Arrange
      const loginDto = {
        email: 'user@example.com',
        password: 'wrongpassword',
      };
      const context = {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      };
      jest.spyOn(service, 'validateUser').mockResolvedValue(null);

      // Act & Assert
      await expect(service.login(loginDto, context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login(loginDto, context)).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('should return login response when user validation succeeds', async () => {
      // Arrange
      const loginDto = {
        email: 'user@example.com',
        password: 'password123',
      };
      const context = {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      };
      const validUser = {
        id: 'user-1',
        email: loginDto.email,
        role: 'STUDENT',
        schoolId: 'school-1',
        tenantId: 'default',
        status: 'ACTIVE',
        lastLoginAt: new Date('2023-01-01'),
      };
      const mockTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(),
        refreshTokenExpiresAt: new Date(),
      };

      jest.spyOn(service, 'validateUser').mockResolvedValue(validUser);
      jest
        .spyOn(service as any, 'generateTokens')
        .mockResolvedValue(mockTokens);

      // Act
      const result = await service.login(loginDto, context);

      // Assert
      expect(result).toMatchObject({
        user: validUser,
        tokens: mockTokens,
        isFirstLogin: false,
        requiresPasswordChange: false,
        mfaRequired: false,
      });
    });

    it('should detect first login correctly', async () => {
      // Arrange
      const loginDto = {
        email: 'user@example.com',
        password: 'password123',
      };
      const context = {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      };
      const firstTimeUser = {
        id: 'user-1',
        email: loginDto.email,
        role: 'STUDENT',
        schoolId: 'school-1',
        tenantId: 'default',
        status: 'ACTIVE',
        lastLoginAt: null, // First login
      };
      const mockTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(),
        refreshTokenExpiresAt: new Date(),
      };

      jest.spyOn(service, 'validateUser').mockResolvedValue(firstTimeUser);
      jest
        .spyOn(service as any, 'generateTokens')
        .mockResolvedValue(mockTokens);

      // Act
      const result = await service.login(loginDto, context);

      // Assert
      expect(result.isFirstLogin).toBe(true);
    });
  });

  describe('refreshTokens', () => {
    it('should throw UnauthorizedException when refresh token is invalid', async () => {
      // Arrange
      const refreshTokenDto = {
        refreshToken: 'invalid-token',
      };
      jest.spyOn(jwtService, 'verify').mockImplementation(() => {
        throw new Error('Invalid token');
      });

      // Act & Assert
      await expect(service.refreshTokens(refreshTokenDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshTokens(refreshTokenDto)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('should throw UnauthorizedException when user is not found or inactive', async () => {
      // Arrange
      const refreshTokenDto = {
        refreshToken: 'valid-token',
      };
      const payload = {
        sub: 'user-1',
        sessionId: 'session-1',
      };
      jest.spyOn(jwtService, 'verify').mockReturnValue(payload);
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);

      // Act & Assert
      await expect(service.refreshTokens(refreshTokenDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshTokens(refreshTokenDto)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('should return new tokens when refresh token is valid', async () => {
      // Arrange
      const refreshTokenDto = {
        refreshToken: 'valid-refresh-token',
      };
      const payload = {
        sub: 'user-1',
        sessionId: 'session-1',
      };
      const user = createMockUser({
        id: 'user-1',
        email: 'user@example.com',
        role: 'STUDENT',
        schoolId: 'school-1',
        status: 'ACTIVE',
      });
      const newTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        accessTokenExpiresAt: new Date(),
        refreshTokenExpiresAt: new Date(),
      };

      jest.spyOn(jwtService, 'verify').mockReturnValue(payload);
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(user);
      jest.spyOn(service as any, 'generateTokens').mockResolvedValue(newTokens);

      // Act
      const result = await service.refreshTokens(refreshTokenDto);

      // Assert
      expect(result).toEqual(newTokens);
      expect(jwtService.verify).toHaveBeenCalledWith(
        refreshTokenDto.refreshToken,
        { secret: 'test-refresh-secret' },
      );
    });
  });

  describe('changePassword', () => {
    it('should throw BadRequestException when password confirmation does not match', async () => {
      // Arrange
      const userId = 'user-1';
      const changePasswordDto = {
        currentPassword: 'oldpassword',
        newPassword: 'newpassword',
        confirmPassword: 'differentpassword',
      };

      // Act & Assert
      await expect(
        service.changePassword(userId, changePasswordDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.changePassword(userId, changePasswordDto),
      ).rejects.toThrow('Password confirmation does not match');
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      // Arrange
      const userId = 'nonexistent-user';
      const changePasswordDto = {
        currentPassword: 'oldpassword',
        newPassword: 'newpassword',
        confirmPassword: 'newpassword',
      };
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.changePassword(userId, changePasswordDto),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.changePassword(userId, changePasswordDto),
      ).rejects.toThrow('User not found');
    });

    it('should throw UnauthorizedException when current password is incorrect', async () => {
      // Arrange
      const userId = 'user-1';
      const changePasswordDto = {
        currentPassword: 'wrongpassword',
        newPassword: 'newpassword',
        confirmPassword: 'newpassword',
      };
      const user = createMockUser({
        id: userId,
        password: await argon2.hash('correctpassword'),
      });
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(user);

      // Act & Assert
      await expect(
        service.changePassword(userId, changePasswordDto),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.changePassword(userId, changePasswordDto),
      ).rejects.toThrow('Current password is incorrect');
    });

    it('should update password successfully', async () => {
      // Arrange
      const userId = 'user-1';
      const currentPassword = 'currentpassword';
      const newPassword = 'newpassword123';
      const changePasswordDto = {
        currentPassword,
        newPassword,
        confirmPassword: newPassword,
      };
      const user = createMockUser({
        id: userId,
        password: await argon2.hash(currentPassword),
      });

      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(user);
      jest
        .spyOn(prismaService.user, 'update')
        .mockResolvedValue({ ...user, password: 'new-hashed-password' });

      // Act
      await service.changePassword(userId, changePasswordDto);

      // Assert
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          password: expect.any(String) as string,
        },
      });
    });
  });

  describe('parseExpiresIn', () => {
    it('should parse seconds correctly', () => {
      // Act
      const result = (service as any).parseExpiresIn('30s') as number;

      // Assert
      expect(result).toBe(30000);
    });

    it('should parse minutes correctly', () => {
      // Act
      const result = (service as any).parseExpiresIn('15m') as number;

      // Assert
      expect(result).toBe(15 * 60 * 1000);
    });

    it('should parse hours correctly', () => {
      // Act
      const result = (service as any).parseExpiresIn('2h') as number;

      // Assert
      expect(result).toBe(2 * 60 * 60 * 1000);
    });

    it('should parse days correctly', () => {
      // Act
      const result = (service as any).parseExpiresIn('7d') as number;

      // Assert
      expect(result).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should throw error for invalid format', () => {
      // Act & Assert
      expect(
        () => (service as any).parseExpiresIn('invalid') as number,
      ).toThrow('Invalid expiresIn format: invalid');
    });
  });
});
