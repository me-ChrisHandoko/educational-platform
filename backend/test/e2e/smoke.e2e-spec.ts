import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { globalTestSetup, TestPerformanceMonitor } from '../setup';

/**
 * Smoke tests to validate production configuration can initialize and basic endpoints work
 * These tests ensure production modules don't have initialization issues
 */
describe('Production Configuration Smoke Tests (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    TestPerformanceMonitor.startTest('Production App Initialization');
    
    // Use development environment to test production modules without external dependencies
    process.env.NODE_ENV = 'development';
    
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule], // Full production module configuration
    }).compile();

    // Production-like Fastify configuration
    const fastifyAdapter = new FastifyAdapter({
      logger: false,
      trustProxy: true,
      bodyLimit: 10485760,
      disableRequestLogging: true,
    });

    app = moduleFixture.createNestApplication<NestFastifyApplication>(fastifyAdapter);
    app.setGlobalPrefix('api/v1');

    await app.init();
    
    TestPerformanceMonitor.endTest('Production App Initialization');
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = 'test'; // Reset to test environment
  });

  describe('Application Bootstrap', () => {
    it('should initialize all production modules successfully', async () => {
      // If we reach this point, all modules initialized without errors
      expect(app).toBeDefined();
      expect(app.getHttpAdapter()).toBeDefined();
    });

    it('should have correct API prefix configuration', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('Core Endpoints', () => {
    it('should respond to health check', async () => {
      TestPerformanceMonitor.startTest('Health Check');
      
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('status', 'ok');
      
      TestPerformanceMonitor.endTest('Health Check');
    });

    it('should respond to application info', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/monitoring/info')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('name');
      expect(response.body.data).toHaveProperty('version');
    });

    it('should respond to system status', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/monitoring/status')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('status');
      expect(response.body.data).toHaveProperty('uptime');
    });
  });

  describe('Authentication Endpoints', () => {
    it('should have auth login endpoint available', async () => {
      // Test that endpoint exists (will fail validation but not 404)
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({})
        .expect(400); // Should return validation error, not 404

      expect(response.body).toHaveProperty('success', false);
    });

    it('should have auth health endpoint available', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/health')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('status', 'ok');
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 routes gracefully', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/non-existent-route')
        .expect(404);

      // Should return structured error response
      expect(response.body).toBeDefined();
    });

    it('should handle malformed requests gracefully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send('invalid json')
        .set('Content-Type', 'application/json')
        .expect(400);

      expect(response.body).toBeDefined();
    });
  });

  describe('Security Configuration', () => {
    it('should include security headers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('should not expose sensitive server information', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['server']).toBe('Educational-Platform');
    });
  });

  afterAll(() => {
    // Display performance metrics
    const metrics = TestPerformanceMonitor.getMetrics();
    console.log('\n📊 Smoke Test Performance Metrics:');
    metrics.forEach(metric => {
      console.log(`  ${metric.name}: ${metric.duration}ms`);
    });
  });
});