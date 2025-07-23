import { randomUUID } from 'crypto';
import { faker } from '@faker-js/faker';

/**
 * Test data factories for better test isolation and consistency
 * Provides factory methods to generate test data with proper relationships
 */

export interface TestUser {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' | 'SUPER_ADMIN';
  schoolId: string;
  isActive: boolean;
}

export interface TestSchool {
  id: string;
  name: string;
  code: string;
  tenantId: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface TestTenant {
  id: string;
  name: string;
  code: string;
  platformId: string;
  type: 'SINGLE_SCHOOL' | 'MULTI_SCHOOL';
  status: 'ACTIVE' | 'INACTIVE';
}

export interface TestPlatform {
  id: string;
  name: string;
  domain: string;
  status: 'ACTIVE' | 'INACTIVE';
  defaultCurrency: string;
  defaultCountry: string;
  defaultTimezone: string;
}

/**
 * Factory for creating test platforms
 */
export class PlatformFactory {
  static create(overrides: Partial<TestPlatform> = {}): TestPlatform {
    return {
      id: randomUUID(),
      name: faker.company.name() + ' Educational Platform',
      domain: faker.internet.domainName(),
      status: 'ACTIVE',
      defaultCurrency: 'IDR',
      defaultCountry: 'ID',
      defaultTimezone: 'Asia/Jakarta',
      ...overrides,
    };
  }

  static createBatch(count: number, overrides: Partial<TestPlatform> = {}): TestPlatform[] {
    return Array.from({ length: count }, () => this.create(overrides));
  }
}

/**
 * Factory for creating test tenants
 */
export class TenantFactory {
  static create(overrides: Partial<TestTenant> = {}): TestTenant {
    return {
      id: randomUUID(),
      name: faker.company.name() + ' Tenant',
      code: faker.string.alphanumeric(10).toUpperCase(),
      platformId: randomUUID(),
      type: 'SINGLE_SCHOOL',
      status: 'ACTIVE',
      ...overrides,
    };
  }

  static createBatch(count: number, overrides: Partial<TestTenant> = {}): TestTenant[] {
    return Array.from({ length: count }, () => this.create(overrides));
  }
}

/**
 * Factory for creating test schools
 */
export class SchoolFactory {
  static create(overrides: Partial<TestSchool> = {}): TestSchool {
    return {
      id: randomUUID(),
      name: faker.company.name() + ' School',
      code: faker.string.alphanumeric(8).toUpperCase(),
      tenantId: randomUUID(),
      status: 'ACTIVE',
      ...overrides,
    };
  }

  static createBatch(count: number, overrides: Partial<TestSchool> = {}): TestSchool[] {
    return Array.from({ length: count }, () => this.create(overrides));
  }
}

/**
 * Factory for creating test users
 */
export class UserFactory {
  private static readonly ROLES: TestUser['role'][] = ['STUDENT', 'INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'];

  static create(overrides: Partial<TestUser> = {}): TestUser {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    
    return {
      id: randomUUID(),
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
      password: this.generateStrongPassword(),
      firstName,
      lastName,
      role: faker.helpers.arrayElement(this.ROLES),
      schoolId: randomUUID(),
      isActive: true,
      ...overrides,
    };
  }

  static createStudent(overrides: Partial<TestUser> = {}): TestUser {
    return this.create({ role: 'STUDENT', ...overrides });
  }

  static createInstructor(overrides: Partial<TestUser> = {}): TestUser {
    return this.create({ role: 'INSTRUCTOR', ...overrides });
  }

  static createAdmin(overrides: Partial<TestUser> = {}): TestUser {
    return this.create({ role: 'ADMIN', ...overrides });
  }

  static createSuperAdmin(overrides: Partial<TestUser> = {}): TestUser {
    return this.create({ role: 'SUPER_ADMIN', ...overrides });
  }

  static createBatch(count: number, overrides: Partial<TestUser> = {}): TestUser[] {
    return Array.from({ length: count }, () => this.create(overrides));
  }

  private static generateStrongPassword(): string {
    // Generate a password that meets security requirements
    const length = faker.number.int({ min: 12, max: 20 });
    return faker.internet.password({
      length,
      memorable: false,
      pattern: /[A-Za-z0-9!@#$%^&*()]/,
    });
  }
}

/**
 * Factory for creating complete test environments
 */
export class TestEnvironmentFactory {
  static createCompleteHierarchy(): {
    platform: TestPlatform;
    tenant: TestTenant;
    school: TestSchool;
    users: {
      student: TestUser;
      instructor: TestUser;
      admin: TestUser;
      superAdmin: TestUser;
    };
  } {
    const platform = PlatformFactory.create();
    const tenant = TenantFactory.create({ platformId: platform.id });
    const school = SchoolFactory.create({ tenantId: tenant.id });

    const users = {
      student: UserFactory.createStudent({ schoolId: school.id }),
      instructor: UserFactory.createInstructor({ schoolId: school.id }),
      admin: UserFactory.createAdmin({ schoolId: school.id }),
      superAdmin: UserFactory.createSuperAdmin({ schoolId: school.id }),
    };

    return { platform, tenant, school, users };
  }

  static createMinimalTestData(): {
    school: TestSchool;
    users: {
      student: TestUser;
      admin: TestUser;
    };
  } {
    const school = SchoolFactory.create();
    const users = {
      student: UserFactory.createStudent({ schoolId: school.id }),
      admin: UserFactory.createAdmin({ schoolId: school.id }),
    };

    return { school, users };
  }
}

/**
 * Login credentials factory for authentication tests
 */
export class LoginCredentialsFactory {
  static validCredentials(): { email: string; password: string } {
    return {
      email: 'student@test.com', // Use known test user
      password: 'StudentPass123!',
    };
  }

  static adminCredentials(): { email: string; password: string } {
    return {
      email: 'admin@test.com',
      password: 'AdminPass123!',
    };
  }

  static invalidCredentials(): { email: string; password: string } {
    return {
      email: faker.internet.email(),
      password: faker.internet.password(),
    };
  }

  static malformedCredentials(): Array<{ email: string; password: string }> {
    return [
      { email: 'not-an-email', password: 'password123' },
      { email: 'user@example.com', password: '' },
      { email: '', password: 'password123' },
      { email: '@example.com', password: 'password123' },
      { email: 'user@', password: 'password123' },
    ];
  }
}

/**
 * Request data factory for API testing
 */
export class RequestDataFactory {
  static createValidLoginRequest() {
    return LoginCredentialsFactory.validCredentials();
  }

  static createInvalidLoginRequest() {
    return LoginCredentialsFactory.invalidCredentials();
  }

  static createMalformedRequests(): Array<any> {
    return [
      {}, // Empty object
      { email: 'test@example.com' }, // Missing password
      { password: 'password123' }, // Missing email
      null, // Null
      undefined, // Undefined
      'string instead of object', // Wrong type
      { email: null, password: null }, // Null values
    ];
  }

  static createOversizedRequest(sizeInBytes: number): any {
    return {
      email: 'test@example.com',
      password: 'password123',
      data: 'a'.repeat(sizeInBytes),
    };
  }
}