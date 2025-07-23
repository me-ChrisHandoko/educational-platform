import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to require specific permissions for a route
 * @param permissions Array of permission names required
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Common permission constants for the educational platform
 */
export const Permission = {
  // User management
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_ARCHIVE: 'user:archive',

  // Course management
  COURSE_CREATE: 'course:create',
  COURSE_READ: 'course:read',
  COURSE_UPDATE: 'course:update',
  COURSE_DELETE: 'course:delete',
  COURSE_PUBLISH: 'course:publish',

  // Content management
  CONTENT_CREATE: 'content:create',
  CONTENT_READ: 'content:read',
  CONTENT_UPDATE: 'content:update',
  CONTENT_DELETE: 'content:delete',
  CONTENT_MODERATE: 'content:moderate',

  // Assessment management
  ASSESSMENT_CREATE: 'assessment:create',
  ASSESSMENT_READ: 'assessment:read',
  ASSESSMENT_UPDATE: 'assessment:update',
  ASSESSMENT_DELETE: 'assessment:delete',
  ASSESSMENT_GRADE: 'assessment:grade',

  // System administration
  SYSTEM_CONFIG: 'system:config',
  SYSTEM_MONITOR: 'system:monitor',
  SYSTEM_BACKUP: 'system:backup',
  SYSTEM_AUDIT: 'system:audit',

  // Analytics and reporting
  ANALYTICS_VIEW: 'analytics:view',
  REPORTS_GENERATE: 'reports:generate',
  REPORTS_EXPORT: 'reports:export',
} as const;

export type UserPermission = (typeof Permission)[keyof typeof Permission];
