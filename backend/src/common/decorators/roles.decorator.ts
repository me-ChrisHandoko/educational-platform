import { SetMetadata } from '@nestjs/common';

export type UserRole = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for accessing an endpoint
 * @param roles - Array of roles that are allowed to access the endpoint
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Decorator for admin-only endpoints
 */
export const AdminOnly = () => Roles('ADMIN');

/**
 * Decorator for teacher and admin endpoints
 */
export const TeacherOrAdmin = () => Roles('TEACHER', 'ADMIN');

/**
 * Decorator for authenticated users (any role)
 */
export const Authenticated = () =>
  Roles('ADMIN', 'TEACHER', 'STUDENT', 'PARENT');
