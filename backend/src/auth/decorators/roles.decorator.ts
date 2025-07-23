import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Decorator to require specific roles for a route
 * @param roles Array of role names required
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Common role constants for the educational platform
 */
export const Role = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  INSTRUCTOR: 'instructor',
  STUDENT: 'student',
  GUEST: 'guest',
} as const;

export type UserRole = (typeof Role)[keyof typeof Role];
