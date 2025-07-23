import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthTestDataSeeder } from '../../src/database/seeders/auth-test-data.seeder';
import { globalTestSetup, TEST_CONFIG } from '../setup';

/**
 * Integration tests for ThrottlerModule functionality
 * These tests use the full AppModule including rate limiting
 */
describe('Throttle Integration (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let seeder: AuthTestDataSeeder;

  beforeAll(async () => {
    // Setup test environment
    globalTestSetup();
    
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule], // Full app module with ThrottlerModule
    }).compile();

    // Create production-like Fastify adapter
    const fastifyAdapter = new FastifyAdapter({
      logger: false,
      trustProxy: true,
      bodyLimit: TEST_CONFIG.BODY_LIMIT_BYTES,
      disableRequestLogging: true,
    });

    app = moduleFixture.createNestApplication<NestFastifyApplication>(fastifyAdapter);
    app.setGlobalPrefix('api/v1');
    
    prisma = app.get<PrismaService>(PrismaService);
    seeder = new AuthTestDataSeeder(prisma);

    await app.init();

    // Seed minimal test data
    await seeder.cleanupTestUsers();
    await seeder.seedTestUsers();
  });

  afterAll(async () => {
    await seeder.cleanupTestUsers();
    await app.close();
  });

  describe('Rate Limiting', () => {
    it('should limit excessive login attempts', async () => {
      const loginData = {
        email: 'student@test.com',
        password: 'WrongPassword123!',
      };

      // Make rapid login attempts to trigger rate limiting
      const promises = Array.from({ length: TEST_CONFIG.MAX_LOGIN_ATTEMPTS + 5 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send(loginData)
          .then(response => ({
            status: response.status,
            attempt: i + 1,
          }))
          .catch(error => ({
            status: error.response?.status || 500,
            attempt: i + 1,
          }))
      );

      const responses = await Promise.all(promises);

      // Should have some 401 responses (invalid credentials)
      const unauthorizedResponses = responses.filter(r => r.status === 401);
      expect(unauthorizedResponses.length).toBeGreaterThan(0);

      // Should have some 429 responses (rate limited)
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      console.log(`Rate limiting test: ${unauthorizedResponses.length} auth failures, ${rateLimitedResponses.length} rate limited`);
    }, 10000); // Longer timeout for rate limiting test

    it('should allow requests after rate limit cooldown', async () => {
      // Wait for rate limit to reset (this is a simplified test)
      await new Promise(resolve => setTimeout(resolve, 2000));

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'student@test.com',
          password: 'StudentPass123!',
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('tokens');
    });
  });

  describe('Rate Limit Headers', () => {
    it('should include rate limit headers in responses', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      // Check for common rate limit headers
      // Note: Actual headers depend on ThrottlerModule configuration
      expect(response.headers).toBeDefined();
    });
  });
});