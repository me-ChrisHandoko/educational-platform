// src/auth/constants/user-roles.ts

export const UserRoles = {
  ADMIN: 'ADMIN',
  PRINCIPAL: 'PRINCIPAL',
  VICE_PRINCIPAL: 'VICE_PRINCIPAL',
  TEACHER: 'TEACHER',
  STAFF: 'STAFF',
  STUDENT: 'STUDENT',
  PARENT: 'PARENT',
} as const;

export type UserRole = (typeof UserRoles)[keyof typeof UserRoles];
