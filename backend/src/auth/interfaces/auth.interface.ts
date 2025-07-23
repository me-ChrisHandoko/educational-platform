export interface JwtPayload {
  sub: string; // User ID
  email: string;
  role: string;
  schoolId: string;
  tenantId: string;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  schoolId: string;
  tenantId: string;
  status: string;
  profile?: {
    firstName: string;
    lastName: string;
    avatar?: string;
  };
  lastLoginAt?: Date;
  permissions?: string[];
}

export interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
  isFirstLogin: boolean;
  requiresPasswordChange: boolean;
  mfaRequired: boolean;
}

export interface RefreshTokenPayload {
  sub: string; // User ID
  sessionId: string;
  tokenFamily: string;
  iat?: number;
  exp?: number;
}

export interface SecurityContext {
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

export interface PasswordResetToken {
  userId: string;
  token: string;
  expiresAt: Date;
  usedAt?: Date;
}

export interface LoginAttempt {
  email: string;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  failureReason?: string;
  timestamp: Date;
  tenantId?: string;
}
