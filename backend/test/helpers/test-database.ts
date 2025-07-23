import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

export class TestDatabase {
  private static instance: TestDatabase;
  private prisma: PrismaClient;
  private dbName: string;
  private connectionString: string;

  private constructor() {}

  static getInstance(): TestDatabase {
    if (!TestDatabase.instance) {
      TestDatabase.instance = new TestDatabase();
    }
    return TestDatabase.instance;
  }

  async setup(): Promise<PrismaClient> {
    // Generate unique database name for this test run
    this.dbName = `test_${process.env.JEST_WORKER_ID || '1'}_${uuidv4().substring(0, 8)}`;
    
    // Get base connection string from environment
    const baseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
    const url = new URL(baseUrl);
    
    // Set database to postgres for initial connection
    url.pathname = '/postgres';
    
    try {
      // Create test database
      await execAsync(`createdb -h ${url.hostname} -p ${url.port} -U ${url.username} ${this.dbName}`);
      
      // Update connection string to use test database
      url.pathname = `/${this.dbName}`;
      this.connectionString = url.toString();
      process.env.DATABASE_URL = this.connectionString;
      
      // Initialize Prisma client
      this.prisma = new PrismaClient({
        datasources: {
          db: {
            url: this.connectionString,
          },
        },
      });
      
      // Run migrations
      await execAsync('npx prisma migrate deploy');
      
      // Connect to database
      await this.prisma.$connect();
      
      return this.prisma;
    } catch (error) {
      console.error('Failed to setup test database:', error);
      throw error;
    }
  }

  async teardown(): Promise<void> {
    try {
      // Disconnect from database
      if (this.prisma) {
        await this.prisma.$disconnect();
      }
      
      // Drop test database
      if (this.dbName) {
        const baseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
        const url = new URL(baseUrl);
        await execAsync(`dropdb -h ${url.hostname} -p ${url.port} -U ${url.username} --if-exists ${this.dbName}`);
      }
    } catch (error) {
      console.error('Failed to teardown test database:', error);
    }
  }

  async cleanTables(): Promise<void> {
    if (!this.prisma) return;

    const tables = await this.prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != '_prisma_migrations'
    `;

    for (const { tablename } of tables) {
      await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE`);
    }
  }

  getPrisma(): PrismaClient {
    return this.prisma;
  }
}

export async function createTestingApp(
  moduleFixture: TestingModule,
): Promise<INestApplication> {
  const app = moduleFixture.createNestApplication();

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  // Initialize app
  await app.init();

  return app;
}

export function createTestingModule(metadata: any): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: '.env.test',
      }),
      ...((metadata.imports as any[]) || []),
    ],
    controllers: metadata.controllers || [],
    providers: metadata.providers || [],
  }).compile();
}

export class TestDataBuilder {
  static user(overrides: Partial<any> = {}): any {
    return {
      email: `test-${uuidv4()}@example.com`,
      password: 'Test123!@#',
      firstName: 'Test',
      lastName: 'User',
      role: 'TEACHER',
      schoolId: uuidv4(),
      status: 'ACTIVE',
      ...overrides,
    };
  }

  static school(overrides: Partial<any> = {}): any {
    return {
      id: uuidv4(),
      tenantId: uuidv4(),
      name: 'Test School',
      address: 'Test Address',
      phone: '081234567890',
      email: `school-${uuidv4()}@example.com`,
      status: 'ACTIVE',
      ...overrides,
    };
  }

  static student(overrides: Partial<any> = {}): any {
    return {
      nisn: Math.random().toString().substring(2, 12),
      firstName: 'Test',
      lastName: 'Student',
      birthDate: new Date('2010-01-01'),
      gender: 'MALE',
      schoolId: uuidv4(),
      ...overrides,
    };
  }

  static academicYear(overrides: Partial<any> = {}): any {
    return {
      id: uuidv4(),
      schoolId: uuidv4(),
      name: '2023/2024',
      startDate: new Date('2023-07-01'),
      endDate: new Date('2024-06-30'),
      isActive: true,
      ...overrides,
    };
  }
}

export async function authenticateUser(
  app: INestApplication,
  credentials: { email: string; password: string },
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send(credentials);

  return response.body.data.tokens.accessToken;
}

// Re-export supertest for convenience
import * as request from 'supertest';
export { request };
