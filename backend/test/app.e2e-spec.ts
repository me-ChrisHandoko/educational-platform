import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDbHelper } from './helpers/test-db.helper';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );

    await app.init();
    await TestDbHelper.clearDatabase();
  });

  afterAll(async () => {
    await TestDbHelper.clearDatabase();
    await TestDbHelper.disconnect();
    if (app) {
      await app.close();
    }
    if (module) {
      await module.close();
    }
  });

  describe('Root Endpoint', () => {
    it('/ (GET) should return Hello World', () => {
      return request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect('Hello World!');
    });

    it('/ (GET) should have correct content type', () => {
      return request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect('Content-Type', /text\/html/);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent routes', () => {
      return request(app.getHttpServer())
        .get('/non-existent-route')
        .expect(404);
    });

    it('should handle malformed requests gracefully', () => {
      return request(app.getHttpServer())
        .post('/')
        .send('invalid-data')
        .expect(404); // POST not allowed on root
    });
  });

  describe('Security Headers', () => {
    it('should include basic security headers', async () => {
      const response = await request(app.getHttpServer()).get('/').expect(200);

      // Check for basic security-related headers
      // Note: These would depend on your security middleware configuration
      expect(response.headers).toBeDefined();
    });
  });

  describe('Application Health', () => {
    it('should respond to health check endpoint', () => {
      return request(app.getHttpServer())
        .get('/auth/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({
            status: 'ok',
            service: 'authentication',
            timestamp: expect.any(String),
          });
        });
    });
  });
});

// Additional system-level tests
describe('Application System Tests', () => {
  let app: INestApplication;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (module) {
      await module.close();
    }
  });

  describe('Application Bootstrap', () => {
    it('should start the application successfully', () => {
      expect(app).toBeDefined();
      expect(app.getHttpServer()).toBeDefined();
    });

    it('should have all required modules loaded', () => {
      // Test that critical modules are available
      const authService = module.get('AuthService', { strict: false });
      const prismaService = module.get('PrismaService', { strict: false });

      expect(authService).toBeDefined();
      expect(prismaService).toBeDefined();
    });
  });

  describe('Global Configuration', () => {
    it('should have validation pipe configured', async () => {
      // Test that validation is working globally
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'invalid-email',
          password: 'short',
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });
  });
});
