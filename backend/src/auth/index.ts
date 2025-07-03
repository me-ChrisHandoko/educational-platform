// src/auth/index.ts
export { AuthService } from './auth.service';
export { AuthController } from './auth.controller';
export { AuthModule } from './auth.module';
export { JwtStrategy } from './strategies/jwt.strategy';

// Guards
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export { RolesGuard } from './guards/roles.guard';

// Decorators
export { CurrentUser } from './decorators/current-user.decorator';
export { Public } from './decorators/public.decorator';
export { Roles } from './decorators/roles.decorator';
export type { UserRole } from './decorators/roles.decorator';

// Constants
export { UserRoles } from './constants/user-roles';

// DTOs
export { LoginDto, RegisterDto, RefreshTokenDto } from './dto/auth.dto';
export type {
  AuthTokens,
  RegisterResponse,
  LoginResponse,
  RefreshTokenResponse,
  LogoutResponse,
} from './dto/auth-response.dto';
