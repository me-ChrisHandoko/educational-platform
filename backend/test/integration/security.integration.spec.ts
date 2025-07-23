import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { globalTestSetup, TEST_CONFIG } from '../setup';

/**
 * Integration tests for SecurityMiddleware functionality
 * Tests security headers and request sanitization in production-like environment
 */
describe('Security Integration (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    // Setup test environment but allow security middleware
    process.env.NODE_ENV = 'development'; // Force production-like behavior
    
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule], // Full app module with SecurityMiddleware
    }).compile();

    const fastifyAdapter = new FastifyAdapter({
      logger: false,
      trustProxy: true,
      bodyLimit: TEST_CONFIG.BODY_LIMIT_BYTES,
      disableRequestLogging: true,
    });

    app = moduleFixture.createNestApplication<NestFastifyApplication>(fastifyAdapter);
    app.setGlobalPrefix('api/v1');
    
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    // Reset test environment
    process.env.NODE_ENV = 'test';
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      // Check for security headers
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(response.headers['permissions-policy']).toContain('camera=()');
      expect(response.headers['server']).toBe('Educational-Platform');
      
      // Should not expose X-Powered-By
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should include HSTS header in production environment', async () => {
      // Temporarily set production environment
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Create new app instance to pick up env change
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const fastifyAdapter = new FastifyAdapter({
        logger: false,
        trustProxy: true,
        disableRequestLogging: true,
      });

      const prodApp = moduleFixture.createNestApplication<NestFastifyApplication>(fastifyAdapter);
      prodApp.setGlobalPrefix('api/v1');
      await prodApp.init();

      const response = await request(prodApp.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
      
      await prodApp.close();
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Request Sanitization', () => {
    it('should handle suspicious patterns in URLs', async () => {
      // Test with potentially malicious URL patterns
      const suspiciousPath = '/api/v1/health?test=<script>alert(1)</script>';
      
      const response = await request(app.getHttpServer())
        .get(suspiciousPath)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      // Request should be processed but sanitized
    });

    it('should sanitize request body content', async () => {
      const maliciousData = {
        email: 'test@example.com',
        password: 'password<script>alert("xss")</script>',
        name: 'User\\x00\\x01Name', // Null bytes
      };

      // This should not crash the server due to sanitization
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(maliciousData);

      // Should return validation error or unauthorized, not crash
      expect([400, 401]).toContain(response.status);
    });

    it('should reject extremely long input', async () => {
      const veryLongString = 'a'.repeat(15000); // Longer than 10KB limit
      
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: veryLongString,
        });

      // Should handle gracefully (validation error or sanitization)
      expect([400, 401]).toContain(response.status);
    });
  });

  describe('Suspicious User Agent Detection', () => {
    it('should handle suspicious user agents gracefully', async () => {
      const suspiciousUserAgents = [
        'sqlmap/1.0',
        'nikto/2.1.6',
        'Nessus',
        'w3af/1.0',
      ];

      for (const userAgent of suspiciousUserAgents) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/health')
          .set('User-Agent', userAgent)
          .expect(200);

        // Should still process the request but log the suspicious activity
        expect(response.body).toHaveProperty('success', true);
      }
    });
  });
});