import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import {
  TestDatabase,
  TestDataBuilder,
  createTestingApp,
  createTestingModule,
  request,
} from '../helpers/test-database';
import { AuthModule } from '../../src/auth/auth.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { CommonModule } from '../../src/common/common.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import * as argon2 from 'argon2';

describe('Auth Integration Tests', () => {
  let app: INestApplication;
  let module: TestingModule;
  let testDb: TestDatabase;
  let prisma: PrismaService;

  beforeAll(async () => {
    testDb = TestDatabase.getInstance();
    await testDb.setup();

    module = await createTestingModule({
      imports: [CommonModule, PrismaModule, AuthModule],
    });

    // Override PrismaService with test database
    prisma = module.get<PrismaService>(PrismaService);
    jest.spyOn(prisma, '$connect').mockResolvedValue();
    jest.spyOn(prisma, '$disconnect').mockResolvedValue();

    app = await createTestingApp(module);
  });

  afterAll(async () => {
    await app.close();
    await testDb.teardown();
  });

  beforeEach(async () => {
    await testDb.cleanTables();
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      // Create test school
      const school = await prisma.school.create({
        data: TestDataBuilder.school(),
      });

      const registerData = {
        email: 'newuser@example.com',
        password: 'Test123!@#',
        confirmPassword: 'Test123!@#',
        firstName: 'New',
        lastName: 'User',
        role: 'TEACHER',
        schoolId: school.id,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(registerData)
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: expect.any(String),
          email: registerData.email,
          role: registerData.role,
          schoolId: school.id,
          tenantId: school.tenantId,
          status: 'ACTIVE',
          profile: {
            firstName: registerData.firstName,
            lastName: registerData.lastName,
            displayName: `${registerData.firstName} ${registerData.lastName}`,
          },
        },
      });

      // Verify user was created in database
      const user = await prisma.user.findUnique({
        where: { email: registerData.email },
      });

      expect(user).toBeTruthy();
      expect(user.email).toBe(registerData.email);
    });

    it('should fail with weak password', async () => {
      const school = await prisma.school.create({
        data: TestDataBuilder.school(),
      });

      const registerData = {
        email: 'weakpass@example.com',
        password: 'weak',
        confirmPassword: 'weak',
        firstName: 'Weak',
        lastName: 'Password',
        role: 'TEACHER',
        schoolId: school.id,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(registerData)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        statusCode: 400,
        error: 'Bad Request',
      });
    });

    it('should fail with duplicate email', async () => {
      const school = await prisma.school.create({
        data: TestDataBuilder.school(),
      });

      // Create existing user
      const existingUser = TestDataBuilder.user({ schoolId: school.id });
      const hashedPassword = await argon2.hash(existingUser.password);
      
      await prisma.user.create({
        data: {
          ...existingUser,
          password: hashedPassword,
        },
      });

      const registerData = {
        email: existingUser.email,
        password: 'Test123!@#',
        confirmPassword: 'Test123!@#',
        firstName: 'Duplicate',
        lastName: 'User',
        role: 'TEACHER',
        schoolId: school.id,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(registerData)
        .expect(409);

      expect(response.body).toMatchObject({
        success: false,
        statusCode: 409,
        error: 'Conflict',
        code: 'USER_EXISTS',
      });
    });
  });

  describe('POST /auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const school = await prisma.school.create({
        data: TestDataBuilder.school(),
      });

      // Create user
      const password = 'Test123!@#';
      const hashedPassword = await argon2.hash(password);
      
      const user = await prisma.user.create({
        data: {
          email: 'login@example.com',
          password: hashedPassword,
          role: 'TEACHER',
          schoolId: school.id,
          status: 'ACTIVE',
        },
      });

      await prisma.userProfile.create({
        data: {
          userId: user.id,
          firstName: 'Login',
          lastName: 'User',
          displayName: 'Login User',
        },
      });

      const loginData = {
        email: user.email,
        password: password,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            schoolId: user.schoolId,
            tenantId: school.tenantId,
            status: 'ACTIVE',
          },
          tokens: {
            accessToken: expect.any(String),
            refreshToken: expect.any(String),
            accessTokenExpiresAt: expect.any(String),
            refreshTokenExpiresAt: expect.any(String),
          },
          isFirstLogin: false,
          requiresPasswordChange: false,
          mfaRequired: false,
        },
      });
    });

    it('should fail with invalid password', async () => {
      const school = await prisma.school.create({
        data: TestDataBuilder.school(),
      });

      const hashedPassword = await argon2.hash('Test123!@#');
      
      const user = await prisma.user.create({
        data: {
          email: 'invalid@example.com',
          password: hashedPassword,
          role: 'TEACHER',
          schoolId: school.id,
          status: 'ACTIVE',
        },
      });

      const loginData = {
        email: user.email,
        password: 'WrongPassword123!',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body).toMatchObject({
        success: false,
        statusCode: 401,
        error: 'Unauthorized',
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('should fail with non-existent user', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'Test123!@#',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body).toMatchObject({
        success: false,
        statusCode: 401,
        error: 'Unauthorized',
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('should enforce rate limiting after multiple failed attempts', async () => {
      const loginData = {
        email: 'ratelimit@example.com',
        password: 'WrongPassword',
      };

      // Make multiple failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send(loginData);
      }

      // Next attempt should be rate limited
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(429);

      expect(response.body).toMatchObject({
        success: false,
        statusCode: 429,
        error: 'Too Many Requests',
      });
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh tokens successfully', async () => {
      const school = await prisma.school.create({
        data: TestDataBuilder.school(),
      });

      // Create and login user
      const password = 'Test123!@#';
      const hashedPassword = await argon2.hash(password);
      
      const user = await prisma.user.create({
        data: {
          email: 'refresh@example.com',
          password: hashedPassword,
          role: 'TEACHER',
          schoolId: school.id,
          status: 'ACTIVE',
        },
      });

      // Login to get tokens
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password })
        .expect(201);

      const { refreshToken } = loginResponse.body.data.tokens;

      // Refresh tokens
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          accessTokenExpiresAt: expect.any(String),
          refreshTokenExpiresAt: expect.any(String),
        },
      });

      // New tokens should be different
      expect(response.body.data.accessToken).not.toBe(loginResponse.body.data.tokens.accessToken);
    });

    it('should fail with invalid refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);

      expect(response.body).toMatchObject({
        success: false,
        statusCode: 401,
        error: 'Unauthorized',
      });
    });
  });
});
