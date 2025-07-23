# Authentication System Documentation

## Overview

Robust authentication system for the educational platform with the following features:

- **JWT-based authentication** with access/refresh token rotation
- **Argon2id password hashing** for maximum security
- **Multi-tenant support** (to be enhanced in AUTH-007)
- **Role-based permissions** (to be implemented in AUTH-004)
- **Comprehensive audit logging** (to be implemented in AUTH-008)

## API Endpoints

### Public Endpoints

#### POST /auth/login

Login with email and password.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "securePassword123!",
  "tenantId": "optional-tenant-id",
  "deviceFingerprint": "optional-device-id"
}
```

**Response:**

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "TEACHER",
    "schoolId": "school-uuid",
    "tenantId": "tenant-uuid",
    "status": "ACTIVE",
    "profile": {
      "firstName": "John",
      "lastName": "Doe",
      "avatar": "url"
    }
  },
  "tokens": {
    "accessToken": "jwt-token",
    "refreshToken": "refresh-token",
    "accessTokenExpiresAt": "2024-01-01T00:00:00Z",
    "refreshTokenExpiresAt": "2024-01-08T00:00:00Z"
  },
  "isFirstLogin": false,
  "requiresPasswordChange": false,
  "mfaRequired": false
}
```

#### POST /auth/register

Register new user account.

**Request:**

```json
{
  "email": "newuser@example.com",
  "password": "SecurePass123!",
  "confirmPassword": "SecurePass123!",
  "firstName": "Jane",
  "lastName": "Smith",
  "phoneNumber": "+1234567890",
  "schoolId": "school-uuid",
  "role": "TEACHER"
}
```

#### POST /auth/refresh

Refresh access token using refresh token.

**Request:**

```json
{
  "refreshToken": "refresh-token-here"
}
```

#### GET /auth/health

Health check endpoint.

### Protected Endpoints

#### GET /auth/profile

Get current user profile (requires JWT token).

#### POST /auth/change-password

Change user password (requires JWT token).

**Request:**

```json
{
  "currentPassword": "oldPassword",
  "newPassword": "NewSecurePass123!",
  "confirmPassword": "NewSecurePass123!"
}
```

#### POST /auth/logout

Logout user (requires JWT token).

## Security Features

### Password Security

- **Argon2id hashing** with high memory/time costs
- **Password complexity requirements**:
  - Minimum 8 characters
  - At least 1 uppercase letter
  - At least 1 lowercase letter
  - At least 1 number
  - At least 1 special character

### Token Security

- **Short-lived access tokens** (15 minutes default)
- **Long-lived refresh tokens** (7 days default)
- **Token rotation** on refresh
- **Session tracking** with unique session IDs

### Audit & Monitoring

- **Login attempt logging** (success/failure)
- **Security event tracking**
- **IP address and user agent tracking**
- **Failed login attempt monitoring**

## Configuration

Required environment variables:

```env
# JWT Configuration
JWT_ACCESS_SECRET=your-super-secret-jwt-access-key-here-32-chars-min
JWT_REFRESH_SECRET=your-super-secret-jwt-refresh-key-here-32-chars-min
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Database
DATABASE_URL=postgresql://postgres:mydevelopment@localhost:3479/educational_platform
```

## Usage Examples

### Frontend Integration

```typescript
// Login
const loginResponse = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123!',
  }),
});

const { user, tokens } = await loginResponse.json();

// Store tokens securely
localStorage.setItem('accessToken', tokens.accessToken);
localStorage.setItem('refreshToken', tokens.refreshToken);

// Use access token for authenticated requests
const profileResponse = await fetch('/auth/profile', {
  headers: {
    Authorization: `Bearer ${tokens.accessToken}`,
  },
});
```

### Token Refresh

```typescript
// Automatic token refresh
async function refreshTokens() {
  const refreshToken = localStorage.getItem('refreshToken');

  const response = await fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  const { accessToken, refreshToken: newRefreshToken } = await response.json();

  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', newRefreshToken);
}
```

## Next Steps

1. **AUTH-003**: Multi-Factor Authentication implementation
2. **AUTH-004**: Role-Based Access Control (RBAC) system
3. **AUTH-005**: Session management and Redis integration
4. **AUTH-006**: Password recovery and email integration
5. **AUTH-007**: Enhanced multi-tenant isolation
6. **AUTH-008**: Comprehensive security monitoring
7. **AUTH-009**: Testing and security validation

## Testing

Run tests with:

```bash
npm run test
npm run test:e2e
```

## Security Considerations

- Never log sensitive information (passwords, tokens)
- Use HTTPS in production
- Implement rate limiting for auth endpoints
- Monitor for suspicious login patterns
- Regular security audits and updates
