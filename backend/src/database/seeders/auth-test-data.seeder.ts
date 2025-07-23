import { PrismaService } from '../../prisma/prisma.service';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';

export class AuthTestDataSeeder {
  constructor(private prisma: PrismaService) {}

  async seedTestUsers() {
    console.log('🌱 Seeding test users for authentication testing...');

    // Create complete hierarchy: Platform → Tenant → School
    const defaultPlatformId = randomUUID();
    const defaultTenantId = randomUUID();
    const defaultSchoolId = randomUUID();

    console.log(`🌐 Creating test platform with ID: ${defaultPlatformId}`);

    // First create platform
    await this.prisma.platform.upsert({
      where: { domain: 'test-platform.local' },
      update: {},
      create: {
        id: defaultPlatformId,
        name: 'Test Educational Platform',
        domain: 'test-platform.local',
        status: 'ACTIVE',
        settings: {},
        maintenanceMode: false,
        defaultCurrency: 'IDR',
        defaultCountry: 'ID',
        defaultTimezone: 'Asia/Jakarta',
        metadata: {},
      },
    });

    console.log(`🏢 Creating test tenant with ID: ${defaultTenantId}`);

    // Create tenant
    await this.prisma.tenant.upsert({
      where: { code: 'TEST_TENANT' },
      update: {},
      create: {
        id: defaultTenantId,
        platformId: defaultPlatformId,
        name: 'Test Educational Tenant',
        code: 'TEST_TENANT',
        type: 'SINGLE_SCHOOL',
        status: 'ACTIVE',
        settings: {},
        defaultCurrency: 'IDR',
        defaultTimezone: 'Asia/Jakarta',
        schemaPrefix: 'test_tenant',
        billingInfo: {},
        metadata: {},
      },
    });

    console.log(`🏫 Creating test school with ID: ${defaultSchoolId}`);

    // Create school (requires valid tenantId)
    await this.prisma.school.upsert({
      where: { code: 'TEST_SCHOOL' },
      update: {},
      create: {
        id: defaultSchoolId,
        tenantId: defaultTenantId,
        schemaName: 'test_school',
        name: 'Test Educational Platform',
        code: 'TEST_SCHOOL',
        type: 'INTEGRATED',
        subdomain: 'test-school',
        countryCode: 'ID',
        address: {},
        contactInfo: {},
        status: 'ACTIVE',
      },
    });

    console.log(`📚 Using school ID: ${defaultSchoolId}`);

    // Test users with different roles and scenarios
    // Using proper UUIDs as required by schema @db.Uuid constraint
    const testUsers = [
      {
        id: randomUUID(),
        email: 'admin@test.com',
        password: 'AdminPass123!',
        role: 'ADMIN',
        status: 'ACTIVE',
        profile: {
          firstName: 'Admin',
          lastName: 'User',
        },
      },
      {
        id: randomUUID(),
        email: 'teacher@test.com',
        password: 'TeacherPass123!',
        role: 'TEACHER',
        status: 'ACTIVE',
        profile: {
          firstName: 'Teacher',
          lastName: 'User',
        },
      },
      {
        id: randomUUID(),
        email: 'student@test.com',
        password: 'StudentPass123!',
        role: 'STUDENT',
        status: 'ACTIVE',
        profile: {
          firstName: 'Student',
          lastName: 'User',
        },
      },
      {
        id: randomUUID(),
        email: 'inactive@test.com',
        password: 'InactivePass123!',
        role: 'STUDENT',
        status: 'INACTIVE',
        profile: {
          firstName: 'Inactive',
          lastName: 'User',
        },
      },
      {
        id: randomUUID(),
        email: 'suspended@test.com',
        password: 'SuspendedPass123!',
        role: 'STUDENT',
        status: 'SUSPENDED',
        profile: {
          firstName: 'Suspended',
          lastName: 'User',
        },
      },
    ];

    for (const userData of testUsers) {
      try {
        // Hash password using same configuration as AuthService
        const hashedPassword = await argon2.hash(userData.password, {
          type: argon2.argon2id,
          memoryCost: 2 ** 16,
          timeCost: 3,
          parallelism: 1,
        });

        // Create or update user
        const user = await this.prisma.user.upsert({
          where: { email: userData.email },
          update: {
            password: hashedPassword,
            role: userData.role as any,
            status: userData.status as any,
          },
          create: {
            id: userData.id,
            email: userData.email,
            password: hashedPassword,
            role: userData.role as any,
            status: userData.status as any,
            schoolId: defaultSchoolId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        // Create or update profile
        await this.prisma.userProfile.upsert({
          where: { userId: user.id },
          update: {
            firstName: userData.profile.firstName,
            lastName: userData.profile.lastName,
          },
          create: {
            userId: user.id,
            firstName: userData.profile.firstName,
            lastName: userData.profile.lastName,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        console.log(
          `✅ Created test user: ${userData.email} (${userData.role})`,
        );
      } catch (error) {
        console.error(
          `❌ Failed to create user ${userData.email}:`,
          error.message,
        );
      }
    }
  }

  async cleanupTestUsers() {
    console.log('🧹 Cleaning up test users and related data...');

    const testEmails = [
      'admin@test.com',
      'teacher@test.com',
      'student@test.com',
      'inactive@test.com',
      'suspended@test.com',
    ];

    // Delete users and profiles
    for (const email of testEmails) {
      try {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (user) {
          // Delete profile first (foreign key constraint)
          await this.prisma.userProfile.deleteMany({
            where: { userId: user.id },
          });
          // Delete user
          await this.prisma.user.delete({ where: { email } });
          console.log(`✅ Deleted test user: ${email}`);
        }
      } catch (error) {
        console.error(`❌ Failed to delete user ${email}:`, error.message);
      }
    }

    // Clean up test school
    try {
      const school = await this.prisma.school.findUnique({
        where: { code: 'TEST_SCHOOL' },
      });
      if (school) {
        await this.prisma.school.delete({ where: { code: 'TEST_SCHOOL' } });
        console.log(`✅ Deleted test school`);
      }
    } catch (error) {
      console.error(`❌ Failed to delete test school:`, error.message);
    }

    // Clean up test tenant
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { code: 'TEST_TENANT' },
      });
      if (tenant) {
        await this.prisma.tenant.delete({ where: { code: 'TEST_TENANT' } });
        console.log(`✅ Deleted test tenant`);
      }
    } catch (error) {
      console.error(`❌ Failed to delete test tenant:`, error.message);
    }

    // Clean up test platform
    try {
      const platform = await this.prisma.platform.findUnique({
        where: { domain: 'test-platform.local' },
      });
      if (platform) {
        await this.prisma.platform.delete({
          where: { domain: 'test-platform.local' },
        });
        console.log(`✅ Deleted test platform`);
      }
    } catch (error) {
      console.error(`❌ Failed to delete test platform:`, error.message);
    }
  }

  async printTestCredentials() {
    console.log('\n📋 TEST CREDENTIALS FOR AUTHENTICATION TESTING:');
    console.log('='.repeat(60));

    const credentials = [
      {
        role: 'ADMIN',
        email: 'admin@test.com',
        password: 'AdminPass123!',
        description: 'Full admin access',
      },
      {
        role: 'TEACHER',
        email: 'teacher@test.com',
        password: 'TeacherPass123!',
        description: 'Teacher with course management rights',
      },
      {
        role: 'STUDENT',
        email: 'student@test.com',
        password: 'StudentPass123!',
        description: 'Regular student account',
      },
      {
        role: 'INACTIVE',
        email: 'inactive@test.com',
        password: 'InactivePass123!',
        description: 'Inactive account (should fail login)',
      },
      {
        role: 'SUSPENDED',
        email: 'suspended@test.com',
        password: 'SuspendedPass123!',
        description: 'Suspended account (should fail login)',
      },
    ];

    credentials.forEach((cred) => {
      console.log(
        `${cred.role.padEnd(12)} | ${cred.email.padEnd(20)} | ${cred.password.padEnd(18)} | ${cred.description}`,
      );
    });

    console.log('='.repeat(60));
    console.log(
      '💡 Use these credentials to test different authentication scenarios\n',
    );
  }
}
