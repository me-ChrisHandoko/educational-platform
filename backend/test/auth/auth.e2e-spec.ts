import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { TestAppModule } from '../test-app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthTestDataSeeder } from '../../src/database/seeders/auth-test-data.seeder';
import { globalTestSetup, TEST_CONFIG, TestPerformanceMonitor } from '../setup';

describe('Authentication (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let seeder: AuthTestDataSeeder;
  let testSchoolId: string;

  beforeAll(async () => {
    // Setup test environment with validation
    globalTestSetup();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    // Create minimal Fastify adapter for tests with parameterized config
    const fastifyAdapter = new FastifyAdapter({
      logger: false, // Silent for tests
      trustProxy: true,
      bodyLimit: TEST_CONFIG.BODY_LIMIT_BYTES,
      disableRequestLogging: true,
      connectionTimeout: TEST_CONFIG.CONNECTION_TIMEOUT,
      keepAliveTimeout: TEST_CONFIG.KEEP_ALIVE_TIMEOUT,
    });

    app = moduleFixture.createNestApplication<NestFastifyApplication>(fastifyAdapter);
    
    // Set global API prefix for tests
    app.setGlobalPrefix('api/v1');
    
    // Skip production plugins/hooks in test environment
    if (process.env.NODE_ENV !== 'test') {
      // Only register plugins in non-test environments
    }
    
    prisma = app.get<PrismaService>(PrismaService);
    seeder = new AuthTestDataSeeder(prisma);

    await app.init();

    // Seed test data
    await seeder.cleanupTestUsers();
    await seeder.seedTestUsers();

    // Get test school ID for registration tests
    const testSchool = await prisma.school.findUnique({
      where: { code: 'TEST_SCHOOL' },
    });
    testSchoolId = testSchool?.id || '';
  });

  afterAll(async () => {
    // Cleanup test data
    await seeder.cleanupTestUsers();
    await app.close();
  });

  describe('/auth/login (POST)', () => {
    it('should test basic routing first', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/health')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('status', 'ok');
    });
    
    it('should login successfully with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'student@test.com',
          password: 'StudentPass123!',
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');
      expect(response.body.data.user).toHaveProperty(
        'email',
        'student@test.com',
      );
      expect(response.body.data.user).toHaveProperty('role', 'STUDENT');
      expect(response.body.data.tokens).toHaveProperty('accessToken');
      expect(response.body.data.tokens).toHaveProperty('refreshToken');
      expect(response.body.data.user).not.toHaveProperty('password');
    });

    it('should fail login with invalid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'student@test.com',
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('Invalid credentials');
    });

    it('should fail login with non-existent user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'AnyPassword123!',
        })
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('Invalid credentials');
    });

    it('should fail login with inactive user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'inactive@test.com',
          password: 'InactivePass123!',
        })
        .expect(403);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('Account not active');
    });

    it('should fail login with suspended user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'suspended@test.com',
          password: 'SuspendedPass123!',
        })
        .expect(403);

      expect(response.body).toHaveProperty('success', false);
    });

    it('should fail login with invalid email format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'invalid-email',
          password: 'ValidPass123!',
        })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('validation');
    });

    it('should fail login with missing password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'student@test.com',
        })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('validation');
    });
  });

  describe('/auth/register (POST)', () => {
    it('should register new user successfully', async () => {
      const newUser = {
        email: 'newstudent@test.com',
        password: 'NewStudentPass123!',
        confirmPassword: 'NewStudentPass123!',
        firstName: 'New',
        lastName: 'Student',
        schoolId: testSchoolId,
        role: 'STUDENT',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(newUser)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user).toHaveProperty('email', newUser.email);
      expect(response.body.data.user).toHaveProperty('role', 'STUDENT');
      expect(response.body.data.user).not.toHaveProperty('password');

      // Cleanup
      await prisma.user.delete({ where: { email: newUser.email } });
    });

    it('should fail registration with existing email', async () => {
      const existingUser = {
        email: 'student@test.com', // Already exists
        password: 'NewStudentPass123!',
        confirmPassword: 'NewStudentPass123!',
        firstName: 'Another',
        lastName: 'Student',
        schoolId: testSchoolId,
        role: 'STUDENT',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(existingUser)
        .expect(409);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('already exists');
    });

    it('should fail registration with password mismatch', async () => {
      const userWithMismatch = {
        email: 'mismatch@test.com',
        password: 'Password123!',
        confirmPassword: 'DifferentPassword123!',
        firstName: 'Test',
        lastName: 'User',
        schoolId: testSchoolId,
        role: 'STUDENT',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(userWithMismatch)
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('confirmation does not match');
    });

    it('should fail registration with weak password', async () => {
      const userWithWeakPassword = {
        email: 'weak@test.com',
        password: 'weak',
        confirmPassword: 'weak',
        firstName: 'Test',
        lastName: 'User',
        schoolId: testSchoolId,
        role: 'STUDENT',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(userWithWeakPassword)
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('validation');
    });
  });

  describe('/auth/refresh (POST)', () => {
    let refreshToken: string;

    beforeAll(async () => {
      // Login once to get refresh token for all tests
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'student@test.com',
          password: 'StudentPass123!',
        })
        .expect(200);

      refreshToken = loginResponse.body.data.tokens.refreshToken;
    });

    it('should refresh tokens successfully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: refreshToken,
        })
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data).toHaveProperty('accessTokenExpiresAt');
      expect(response.body.data).toHaveProperty('refreshTokenExpiresAt');
    });

    it('should fail with invalid refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: 'invalid-refresh-token',
        })
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('Invalid refresh token');
    });

    it('should fail with missing refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('validation');
    });
  });

  describe('Protected Routes', () => {
    let accessToken: string;
    let adminAccessToken: string;

    beforeAll(async () => {
      // Get student access token (reuse across all tests)
      const studentLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'student@test.com',
          password: 'StudentPass123!',
        })
        .expect(200);
      
      if (!studentLogin.body?.data?.tokens?.accessToken) {
        throw new Error('Failed to get student access token');
      }
      accessToken = studentLogin.body.data.tokens.accessToken;

      // Get admin access token (reuse across all tests)
      const adminLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'AdminPass123!',
        })
        .expect(200);
      
      if (!adminLogin.body?.data?.tokens?.accessToken) {
        throw new Error('Failed to get admin access token');
      }
      adminAccessToken = adminLogin.body.data.tokens.accessToken;
    });

    it('should access protected route with valid token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user).toHaveProperty(
        'email',
        'student@test.com',
      );
    });

    it('should fail to access protected route without token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/profile')
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('Unauthorized');
    });

    it('should fail to access protected route with invalid token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
    });

    it('should access admin-only route with admin token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/monitoring/debug')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });

    it('should fail to access admin-only route with student token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/monitoring/debug')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('Unauthorized');
    });
  });

  describe('Rate Limiting', () => {
    it.skip('should limit login attempts (ThrottlerModule disabled in tests)', async () => {
      // This test is skipped because ThrottlerModule causes Fastify hooks conflicts
      // Rate limiting is tested separately or in integration environment
    });

    it('should still validate authentication without rate limiting', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'student@test.com',
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('Invalid credentials');
    });
  });
});
