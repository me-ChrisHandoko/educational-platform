import type { User, UserProfile } from '@prisma/client';

export interface MockUser extends Partial<User> {
  id: string;
  email: string;
  password: string;
  role: string;
  schoolId: string;
  status: string;
  lastLoginAt?: Date | null;
  profile?: MockUserProfile | null;
}

export interface MockUserProfile extends Partial<UserProfile> {
  firstName: string;
  lastName: string;
  avatar?: string | null;
}

export interface MockSchool {
  id: string;
  name: string;
  type: string;
  level: string;
  status: string;
}

export interface MockSecurityContext {
  userId: string;
  tenantId: string;
  schoolId: string;
  role: string;
  permissions: string[];
  sessionId: string;
  ipAddress: string;
  userAgent: string;
  deviceFingerprint?: string;
}

export interface MockLoginContext {
  ipAddress: string;
  userAgent: string;
  deviceFingerprint?: string;
}

export interface MockPrismaUser {
  id: string;
  schoolId: string;
  email: string;
  username: string | null;
  password: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  failedLoginAttempts: number;
  lockedAt: Date | null;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
  profile?: MockUserProfile | null;
}

export const createMockUser = (
  overrides: Partial<MockPrismaUser> = {},
): MockPrismaUser => ({
  id: 'test-user-id',
  schoolId: 'test-school-id',
  email: 'test@example.com',
  username: null,
  password: 'hashed-password',
  role: 'STUDENT',
  status: 'ACTIVE',
  emailVerified: false,
  phoneNumber: null,
  phoneVerified: false,
  twoFactorEnabled: false,
  lastLoginAt: null,
  passwordChangedAt: null,
  failedLoginAttempts: 0,
  lockedAt: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createMockSecurityContext = (
  overrides: Partial<MockSecurityContext> = {},
): MockSecurityContext => ({
  userId: 'test-user-id',
  tenantId: 'default',
  schoolId: 'test-school-id',
  role: 'STUDENT',
  permissions: [],
  sessionId: 'test-session-id',
  ipAddress: '127.0.0.1',
  userAgent: 'test-agent',
  ...overrides,
});
