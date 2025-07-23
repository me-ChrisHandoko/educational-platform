import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export class TestDbHelper {
  private static prisma: PrismaClient;

  static async getTestDatabase(): Promise<PrismaClient> {
    if (!this.prisma) {
      this.prisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
          },
        },
      });
      await this.prisma.$connect();
    }
    return this.prisma;
  }

  static async clearDatabase(): Promise<void> {
    const prisma = await this.getTestDatabase();

    // Clear all tables in dependency order
    const tableNames = [
      'UserProfile',
      'User',
      'Session',
      'LoginHistory',
      'AuditLog',
      // Add other table names as needed
    ];

    for (const tableName of tableNames) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${tableName}";`);
      } catch (error) {
        // Table might not exist, ignore
      }
    }
  }

  static async createTestUser(overrides: Partial<any> = {}): Promise<any> {
    const prisma = await this.getTestDatabase();

    const defaultUser = {
      id: uuidv4(),
      email: `test-${Date.now()}@example.com`,
      password: '$argon2id$v=19$m=65536,t=3,p=1$testhashedpassword', // Pre-hashed test password
      role: 'STUDENT',
      schoolId: uuidv4(),
      status: 'ACTIVE',
      ...overrides,
    };

    const user = await prisma.user.create({
      data: defaultUser,
    });

    // Create user profile
    await prisma.userProfile.create({
      data: {
        userId: user.id,
        firstName: 'Test',
        lastName: 'User',
        displayName: 'Test User',
      },
    });

    return user;
  }

  static async createTestSchool(overrides: Partial<any> = {}): Promise<any> {
    const prisma = await this.getTestDatabase();

    const defaultSchool = {
      id: uuidv4(),
      name: `Test School ${Date.now()}`,
      type: 'PUBLIC',
      level: 'ELEMENTARY',
      status: 'ACTIVE',
      ...overrides,
    };

    return await prisma.school.create({
      data: defaultSchool,
    });
  }

  static async createTestSession(
    userId: string,
    overrides: Partial<any> = {},
  ): Promise<any> {
    const prisma = await this.getTestDatabase();

    const defaultSession = {
      id: uuidv4(),
      userId,
      sessionToken: `session-${Date.now()}`,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      ...overrides,
    };

    return await prisma.session.create({
      data: defaultSession,
    });
  }

  static async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
  }

  // Helper method to reset auto-increment sequences
  static async resetSequences(): Promise<void> {
    const prisma = await this.getTestDatabase();

    // Reset PostgreSQL sequences if needed
    try {
      await prisma.$executeRaw`ALTER SEQUENCE IF EXISTS user_id_seq RESTART WITH 1;`;
      // Add other sequences as needed
    } catch (error) {
      // Sequences might not exist, ignore
    }
  }

  // Helper method to seed test data
  static async seedTestData(): Promise<{
    users: any[];
    schools: any[];
  }> {
    const school = await this.createTestSchool({
      name: 'Test Elementary School',
      type: 'PUBLIC',
      level: 'ELEMENTARY',
    });

    const users = await Promise.all([
      this.createTestUser({
        email: 'student@test.com',
        role: 'STUDENT',
        schoolId: school.id,
      }),
      this.createTestUser({
        email: 'teacher@test.com',
        role: 'TEACHER',
        schoolId: school.id,
      }),
      this.createTestUser({
        email: 'admin@test.com',
        role: 'ADMIN',
        schoolId: school.id,
      }),
    ]);

    return {
      users,
      schools: [school],
    };
  }
}
