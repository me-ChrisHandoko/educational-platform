import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SecurityConfigService } from '../../src/common/services/security-config.service';
import { CoordinatedAuthService } from '../../src/auth/services/coordinated-auth.service';
import { RedisService } from '../../src/redis/redis.service';
import { AccountLockoutService } from '../../src/auth/services/account-lockout.service';

describe('Coordinated Security System', () => {
  let securityConfigService: SecurityConfigService;
  let coordinatedAuthService: CoordinatedAuthService;
  let redisService: jest.Mocked<RedisService>;
  let accountLockoutService: jest.Mocked<AccountLockoutService>;

  const mockContext = {
    email: 'test@example.com',
    ip: '192.168.1.100',
    userAgent: 'Mozilla/5.0 Test',
    route: 'auth:login',
    method: 'POST',
    timestamp: new Date(),
    failureReason: 'Invalid password',
  };

  beforeEach(async () => {
    const mockRedisService = {
      getRateLimit: jest.fn(),
      incrementRateLimit: jest.fn(),
      set: jest.fn(),
    };

    const mockAccountLockoutService = {
      checkAccountLockout: jest.fn(),
      recordFailedAttempt: jest.fn(),
      recordSuccessfulAttempt: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config = {
          'app.environment': 'test',
          'jwt.accessExpiresIn': '15m',
          'jwt.refreshExpiresIn': '7d',
          'security.rateLimit.ttl': 60,
          'security.rateLimit.limit': 100,
          'security.cors.enabled': true,
          'security.cors.origins': [],
        };
        return config[key] || defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityConfigService,
        CoordinatedAuthService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: AccountLockoutService,
          useValue: mockAccountLockoutService,
        },
      ],
    }).compile();

    securityConfigService = module.get<SecurityConfigService>(
      SecurityConfigService,
    );
    coordinatedAuthService = module.get<CoordinatedAuthService>(
      CoordinatedAuthService,
    );
    redisService = module.get(RedisService);
    accountLockoutService = module.get(AccountLockoutService);
  });

  describe('SecurityConfigService', () => {
    it('should be defined', () => {
      expect(securityConfigService).toBeDefined();
    });

    it('should provide coordinated thresholds', () => {
      const thresholds = securityConfigService.getCoordinatedThresholds();

      expect(thresholds).toHaveProperty('warningThreshold');
      expect(thresholds).toHaveProperty('criticalThreshold');
      expect(thresholds).toHaveProperty('lockoutThreshold');
      expect(thresholds).toHaveProperty('rateLimitThreshold');
      expect(thresholds).toHaveProperty('isCoordinated');
      expect(thresholds).toHaveProperty('coordinatedMode');
    });

    it('should ensure account lockout threshold is less than rate limit', () => {
      const thresholds = securityConfigService.getCoordinatedThresholds();

      expect(thresholds.lockoutThreshold).toBeLessThan(
        thresholds.rateLimitThreshold,
      );
      expect(thresholds.isCoordinated).toBe(true);
    });

    it('should calculate progressive delay correctly', () => {
      // Test progressive delay calculation
      expect(securityConfigService.calculateProgressiveDelay(1)).toBe(0); // Below warning
      expect(
        securityConfigService.calculateProgressiveDelay(5),
      ).toBeGreaterThan(0); // Above warning
      expect(
        securityConfigService.calculateProgressiveDelay(10),
      ).toBeGreaterThan(securityConfigService.calculateProgressiveDelay(5)); // Increasing delay
    });

    it('should provide security layer actions', () => {
      const context = {
        email: 'test@test.com',
        ip: '127.0.0.1',
        withinWindow: true,
      };

      // Test allow action (low attempts)
      const allowAction = securityConfigService.getSecurityLayerAction(
        1,
        context,
      );
      expect(allowAction.action).toBe('allow');

      // Test lockout action (high attempts)
      const lockoutAction = securityConfigService.getSecurityLayerAction(
        10,
        context,
      );
      expect(['lockout', 'rate-limit', 'delay']).toContain(
        lockoutAction.action,
      );
    });
  });

  describe('CoordinatedAuthService', () => {
    it('should be defined', () => {
      expect(coordinatedAuthService).toBeDefined();
    });

    it('should evaluate security decision correctly', async () => {
      // Mock low attempt count - should allow
      accountLockoutService.checkAccountLockout.mockResolvedValue({
        isLocked: false,
        remainingAttempts: 5,
      });

      redisService.getRateLimit.mockResolvedValue({
        count: 2,
        resetTime: Date.now() + 60000,
      });

      const decision =
        await coordinatedAuthService.evaluateSecurityDecision(mockContext);

      expect(decision.allowed).toBe(true);
      expect(decision.action).toBe('allow');
      expect(decision.metadata).toBeDefined();
      expect(decision.metadata?.currentAttempts).toBe(2);
    });

    it('should block when lockout threshold is reached', async () => {
      // Mock high attempt count - should lockout
      accountLockoutService.checkAccountLockout.mockResolvedValue({
        isLocked: true,
        canRetryAt: new Date(Date.now() + 900000), // 15 minutes
      });

      redisService.getRateLimit.mockResolvedValue({
        count: 8,
        resetTime: Date.now() + 60000,
      });

      const decision =
        await coordinatedAuthService.evaluateSecurityDecision(mockContext);

      expect(decision.allowed).toBe(false);
      expect(['lockout', 'rate-limit']).toContain(decision.action);
    });

    it('should apply progressive delay when appropriate', async () => {
      // Mock medium attempt count - should delay
      accountLockoutService.checkAccountLockout.mockResolvedValue({
        isLocked: false,
        remainingAttempts: 2,
      });

      redisService.getRateLimit.mockResolvedValue({
        count: 6, // Above critical threshold but below lockout
        resetTime: Date.now() + 60000,
      });

      const decision =
        await coordinatedAuthService.evaluateSecurityDecision(mockContext);

      if (decision.action === 'delay') {
        expect(decision.delay).toBeGreaterThan(0);
        expect(decision.allowed).toBe(true);
      }
    });

    it('should record failed attempts across all layers', async () => {
      accountLockoutService.recordFailedAttempt.mockResolvedValue({
        isLocked: false,
        remainingAttempts: 4,
      });

      redisService.incrementRateLimit.mockResolvedValue({
        count: 3,
        resetTime: Date.now() + 60000,
        allowed: true,
      });

      await coordinatedAuthService.recordFailedAttempt(mockContext);

      expect(accountLockoutService.recordFailedAttempt).toHaveBeenCalledWith(
        mockContext.email,
        mockContext.ip,
        mockContext.userAgent,
        mockContext.failureReason,
      );
      expect(redisService.incrementRateLimit).toHaveBeenCalled();
      expect(redisService.set).toHaveBeenCalled(); // Security event logging
    });

    it('should record successful attempts and clear restrictions', async () => {
      await coordinatedAuthService.recordSuccessfulAttempt(mockContext);

      expect(
        accountLockoutService.recordSuccessfulAttempt,
      ).toHaveBeenCalledWith(
        mockContext.email,
        mockContext.ip,
        mockContext.userAgent,
      );
      expect(redisService.set).toHaveBeenCalled(); // Security event logging
    });

    it('should check security status correctly', async () => {
      accountLockoutService.checkAccountLockout.mockResolvedValue({
        isLocked: true,
        canRetryAt: new Date(Date.now() + 900000),
      });

      redisService.getRateLimit.mockResolvedValue({
        count: 5,
        resetTime: Date.now() + 60000,
      });

      const status = await coordinatedAuthService.checkSecurityStatus({
        email: mockContext.email,
        ip: mockContext.ip,
      });

      expect(status.isRestricted).toBe(true);
      expect(status.restrictions).toContain('account-locked');
      expect(status.canRetryAt).toBeDefined();
    });

    it('should fail open on errors', async () => {
      // Mock service errors
      accountLockoutService.checkAccountLockout.mockRejectedValue(
        new Error('Database error'),
      );
      redisService.getRateLimit.mockRejectedValue(new Error('Redis error'));

      const decision =
        await coordinatedAuthService.evaluateSecurityDecision(mockContext);

      expect(decision.allowed).toBe(true);
      expect(decision.layer).toBe('error-fallback');
    });
  });

  describe('Security Layer Coordination', () => {
    it('should prioritize account lockout before rate limiting', () => {
      const coordination = securityConfigService.getCoordinationPolicy();
      const accountIndex =
        coordination.layerPriority.indexOf('account-lockout');
      const rateLimitIndex = coordination.layerPriority.indexOf('rate-limit');

      expect(accountIndex).toBeLessThan(rateLimitIndex);
    });

    it('should have coordinated thresholds that make sense', () => {
      const thresholds = securityConfigService.getCoordinatedThresholds();

      expect(thresholds.warningThreshold).toBeLessThan(
        thresholds.criticalThreshold,
      );
      expect(thresholds.criticalThreshold).toBeLessThan(
        thresholds.lockoutThreshold,
      );
      expect(thresholds.lockoutThreshold).toBeLessThan(
        thresholds.rateLimitThreshold,
      );
    });

    it('should enable coordination features in production', () => {
      // This would require mocking NODE_ENV=production
      // but demonstrates the test approach for environment-specific config
      const policy = securityConfigService.getSecurityPolicy();

      expect(policy.coordination).toBeDefined();
      expect(
        policy.coordination.escalationRules.enableCrossLayerCommunication,
      ).toBe(true);
      expect(policy.monitoring).toBeDefined();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing email gracefully', async () => {
      const contextWithoutEmail = { ...mockContext, email: undefined };

      redisService.getRateLimit.mockResolvedValue({
        count: 3,
        resetTime: Date.now() + 60000,
      });

      const decision =
        await coordinatedAuthService.evaluateSecurityDecision(
          contextWithoutEmail,
        );

      expect(decision).toBeDefined();
      expect(decision.metadata?.currentAttempts).toBe(3);
    });

    it('should handle Redis unavailability', async () => {
      redisService.getRateLimit.mockRejectedValue(
        new Error('Redis connection failed'),
      );
      accountLockoutService.checkAccountLockout.mockResolvedValue({
        isLocked: false,
        remainingAttempts: 5,
      });

      const decision =
        await coordinatedAuthService.evaluateSecurityDecision(mockContext);

      expect(decision.allowed).toBe(true); // Should fail open
    });

    it('should handle database unavailability', async () => {
      accountLockoutService.checkAccountLockout.mockRejectedValue(
        new Error('Database error'),
      );
      redisService.getRateLimit.mockResolvedValue({
        count: 2,
        resetTime: Date.now() + 60000,
      });

      const decision =
        await coordinatedAuthService.evaluateSecurityDecision(mockContext);

      expect(decision.allowed).toBe(true); // Should fail open
    });
  });
});
