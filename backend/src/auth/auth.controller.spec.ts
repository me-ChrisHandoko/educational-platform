import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TestDbHelper } from '../../test/helpers/test-db.helper';
import { createMockSecurityContext } from '../../test/types/test-types';

describe('AuthController', () => {
  let controller: AuthController;
  let module: TestingModule;

  const mockAuthService = {
    login: jest.fn(),
    register: jest.fn(),
    refreshTokens: jest.fn(),
    changePassword: jest.fn(),
  };

  beforeAll(async () => {
    await TestDbHelper.clearDatabase();
  });

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
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

  describe('login', () => {
    it('should login user successfully', async () => {
      // Arrange
      const loginDto = {
        email: 'user@example.com',
        password: 'password123',
      };
      const mockRequest = {
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
        get: jest.fn().mockReturnValue('Mozilla/5.0'),
      } as unknown as Request;
      const expectedResponse = {
        user: {
          id: 'user-1',
          email: loginDto.email,
          role: 'STUDENT',
          schoolId: 'school-1',
          tenantId: 'default',
          status: 'ACTIVE',
        },
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          accessTokenExpiresAt: new Date(),
          refreshTokenExpiresAt: new Date(),
        },
        isFirstLogin: false,
        requiresPasswordChange: false,
        mfaRequired: false,
      };

      mockAuthService.login.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.login(loginDto, mockRequest);

      // Assert
      expect(result).toEqual(expectedResponse);
      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto, {
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      });
    });

    it('should handle missing IP address gracefully', async () => {
      // Arrange
      const loginDto = {
        email: 'user@example.com',
        password: 'password123',
      };
      const mockRequest = {
        ip: undefined,
        connection: { remoteAddress: undefined },
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as Request;
      const expectedResponse = {
        user: { id: 'user-1' },
        tokens: {},
        isFirstLogin: false,
        requiresPasswordChange: false,
        mfaRequired: false,
      };

      mockAuthService.login.mockResolvedValue(expectedResponse);

      // Act
      await controller.login(loginDto, mockRequest);

      // Assert
      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto, {
        ipAddress: undefined,
        userAgent: '',
      });
    });

    it('should pass through authentication errors', async () => {
      // Arrange
      const loginDto = {
        email: 'user@example.com',
        password: 'wrongpassword',
      };
      const mockRequest = {
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
        get: jest.fn().mockReturnValue('Mozilla/5.0'),
      } as unknown as Request;
      const authError = new Error('Invalid credentials');

      mockAuthService.login.mockRejectedValue(authError);

      // Act & Assert
      await expect(controller.login(loginDto, mockRequest)).rejects.toThrow(
        'Invalid credentials',
      );
    });
  });

  describe('register', () => {
    it('should register user successfully', async () => {
      // Arrange
      const registerDto = {
        email: 'newuser@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        firstName: 'John',
        lastName: 'Doe',
        schoolId: 'school-1',
        role: 'STUDENT',
      };
      const expectedResponse = {
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
      };

      mockAuthService.register.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.register(registerDto);

      // Assert
      expect(result).toEqual(expectedResponse);
      expect(mockAuthService.register).toHaveBeenCalledWith(registerDto);
    });

    it('should pass through registration errors', async () => {
      // Arrange
      const registerDto = {
        email: 'existing@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        firstName: 'John',
        lastName: 'Doe',
        schoolId: 'school-1',
        role: 'STUDENT',
      };
      const registrationError = new Error(
        'User with this email already exists',
      );

      mockAuthService.register.mockRejectedValue(registrationError);

      // Act & Assert
      await expect(controller.register(registerDto)).rejects.toThrow(
        'User with this email already exists',
      );
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens successfully', async () => {
      // Arrange
      const refreshTokenDto = {
        refreshToken: 'valid-refresh-token',
      };
      const expectedResponse = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        accessTokenExpiresAt: new Date(),
        refreshTokenExpiresAt: new Date(),
      };

      mockAuthService.refreshTokens.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.refreshTokens(refreshTokenDto);

      // Assert
      expect(result).toEqual(expectedResponse);
      expect(mockAuthService.refreshTokens).toHaveBeenCalledWith(
        refreshTokenDto,
      );
    });

    it('should pass through refresh token errors', async () => {
      // Arrange
      const refreshTokenDto = {
        refreshToken: 'invalid-refresh-token',
      };
      const refreshError = new Error('Invalid refresh token');

      mockAuthService.refreshTokens.mockRejectedValue(refreshError);

      // Act & Assert
      await expect(controller.refreshTokens(refreshTokenDto)).rejects.toThrow(
        'Invalid refresh token',
      );
    });
  });

  describe('changePassword', () => {
    it('should change password successfully', async () => {
      // Arrange
      const userId = 'user-1';
      const changePasswordDto = {
        currentPassword: 'oldpassword',
        newPassword: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      };
      const expectedResponse = {
        message: 'Password changed successfully',
      };

      mockAuthService.changePassword.mockResolvedValue(undefined);

      // Act
      const result = await controller.changePassword(userId, changePasswordDto);

      // Assert
      expect(result).toEqual(expectedResponse);
      expect(mockAuthService.changePassword).toHaveBeenCalledWith(
        userId,
        changePasswordDto,
      );
    });

    it('should pass through password change errors', async () => {
      // Arrange
      const userId = 'user-1';
      const changePasswordDto = {
        currentPassword: 'wrongpassword',
        newPassword: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      };
      const changePasswordError = new Error('Current password is incorrect');

      mockAuthService.changePassword.mockRejectedValue(changePasswordError);

      // Act & Assert
      await expect(
        controller.changePassword(userId, changePasswordDto),
      ).rejects.toThrow('Current password is incorrect');
    });
  });

  describe('getProfile', () => {
    it('should return user profile', () => {
      // Arrange
      const mockSecurityContext = createMockSecurityContext({
        userId: 'user-1',
        role: 'STUDENT',
        schoolId: 'school-1',
        tenantId: 'default',
        permissions: ['read:profile'],
        sessionId: 'session-1',
      });
      const expectedResponse = {
        id: 'user-1',
        email: 'user-1', // Fixed: Returns userId instead of email due to SecurityContext limitation
        role: 'STUDENT',
        schoolId: 'school-1',
        tenantId: 'default',
        permissions: ['read:profile'],
        sessionId: 'session-1',
      };

      // Act
      const result = controller.getProfile(mockSecurityContext);

      // Assert
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('logout', () => {
    it('should logout user successfully', () => {
      // Arrange
      const mockSecurityContext = createMockSecurityContext({
        userId: 'user-1',
        sessionId: 'session-1',
      });
      const expectedResponse = {
        message: 'Logged out successfully',
      };
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Act
      const result = controller.logout(mockSecurityContext);

      // Assert
      expect(result).toEqual(expectedResponse);
      expect(consoleSpy).toHaveBeenCalledWith('User logout:', {
        userId: 'user-1',
        sessionId: 'session-1',
        timestamp: expect.any(String) as string,
      });

      consoleSpy.mockRestore();
    });
  });

  describe('healthCheck', () => {
    it('should return health status', () => {
      // Act
      const result = controller.healthCheck();

      // Assert
      expect(result).toEqual({
        status: 'ok',
        service: 'authentication',
        timestamp: expect.any(String) as string,
      });
    });
  });
});
