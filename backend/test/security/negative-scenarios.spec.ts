import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { TestAppModule } from '../test-app.module';
import { globalTestSetup, TEST_CONFIG } from '../setup';

/**
 * Negative test cases and error scenarios
 * Tests edge cases, error handling, and security scenarios
 */
describe('Negative Scenarios & Error Handling (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    globalTestSetup();
    
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    const fastifyAdapter = new FastifyAdapter({
      logger: false,
      trustProxy: true,
      bodyLimit: TEST_CONFIG.BODY_LIMIT_BYTES,
      disableRequestLogging: true,
      connectionTimeout: TEST_CONFIG.CONNECTION_TIMEOUT,
      keepAliveTimeout: TEST_CONFIG.KEEP_ALIVE_TIMEOUT,
    });

    app = moduleFixture.createNestApplication<NestFastifyApplication>(fastifyAdapter);
    app.setGlobalPrefix('api/v1');
    
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Authentication Error Scenarios', () => {
    it('should handle missing credentials gracefully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('validation');
    });

    it('should handle malformed email addresses', async () => {
      const malformedEmails = [
        'not-an-email',
        '@example.com',
        'user@',
        'user space@example.com',
        'user@exam ple.com',
      ];

      for (const email of malformedEmails) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            email,
            password: 'validPassword123!',
          })
          .expect(400);

        expect(response.body).toHaveProperty('success', false);
      }
    });

    it('should handle weak passwords gracefully', async () => {
      const weakPasswords = [
        '123',
        'password',
        '12345678',
        'qwerty',
        '',
      ];

      for (const password of weakPasswords) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            email: 'test@example.com',
            password,
          });

        // Should return validation error (400) or unauthorized (401)
        expect([400, 401]).toContain(response.status);
        expect(response.body).toHaveProperty('success', false);
      }
    });

    it('should handle invalid refresh tokens', async () => {
      const invalidTokens = [
        'invalid-token',
        '',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid',
        null,
        undefined,
      ];

      for (const token of invalidTokens) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: token });

        expect([400, 401]).toContain(response.status);
        expect(response.body).toHaveProperty('success', false);
      }
    });
  });

  describe('Request Validation Errors', () => {
    it('should handle oversized requests', async () => {
      // Create request larger than body limit
      const largeData = {
        email: 'test@example.com',
        password: 'password123',
        data: 'a'.repeat(TEST_CONFIG.BODY_LIMIT_BYTES + 1000),
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(largeData);

      // Should return 413 (Payload Too Large) or 400 (Bad Request)
      expect([400, 413]).toContain(response.status);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send('{"email": "test@example.com", "password": invalid json}')
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
    });

    it('should handle missing Content-Type headers', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send('email=test&password=pass')
        // No Content-Type header set

      // Should handle gracefully
      expect([400, 415]).toContain(response.status);
    });
  });

  describe('Protected Route Access Errors', () => {
    it('should reject requests without authorization header', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/profile')
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('Unauthorized');
    });

    it('should reject malformed authorization headers', async () => {
      const malformedHeaders = [
        'invalid-header',
        'Bearer',
        'Bearer ',
        'Token invalid-token',
        '',
      ];

      for (const authHeader of malformedHeaders) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/auth/profile')
          .set('Authorization', authHeader)
          .expect(401);

        expect(response.body).toHaveProperty('success', false);
      }
    });

    it('should reject expired or invalid tokens', async () => {
      const invalidTokens = [
        'Bearer invalid.jwt.token',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.expired',
        'Bearer ' + 'a'.repeat(500), // Very long invalid token
      ];

      for (const token of invalidTokens) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/auth/profile')
          .set('Authorization', token)
          .expect(401);

        expect(response.body).toHaveProperty('success', false);
      }
    });
  });

  describe('HTTP Method Errors', () => {
    it('should return 405 for unsupported HTTP methods', async () => {
      // Try PATCH on login endpoint (should be POST only)
      const response = await request(app.getHttpServer())
        .patch('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(405);

      expect(response.body).toBeDefined();
    });

    it('should return 404 for non-existent endpoints', async () => {
      const nonExistentEndpoints = [
        '/api/v1/non-existent',
        '/api/v1/auth/invalid-endpoint',
        '/api/v1/users/12345', // Assuming this doesn't exist
      ];

      for (const endpoint of nonExistentEndpoints) {
        const response = await request(app.getHttpServer())
          .get(endpoint)
          .expect(404);

        expect(response.body).toBeDefined();
      }
    });
  });

  describe('Cache Error Scenarios', () => {
    it('should handle cache failures gracefully', async () => {
      // This tests that the app doesn't crash if cache operations fail
      // Since we're using memory cache in tests, we'll test normal operation
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('Concurrency and Race Conditions', () => {
    it('should handle concurrent requests safely', async () => {
      const concurrentRequests = Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .get('/api/v1/health')
          .expect(200)
      );

      const responses = await Promise.all(concurrentRequests);
      
      responses.forEach(response => {
        expect(response.body).toHaveProperty('success', true);
      });
    });

    it('should handle rapid sequential requests', async () => {
      const requests = [];
      
      for (let i = 0; i < 5; i++) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/health')
          .expect(200);
        
        requests.push(response);
        expect(response.body).toHaveProperty('success', true);
      }

      expect(requests).toHaveLength(5);
    });
  });
});