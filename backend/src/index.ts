// src/index.ts - Main application exports with explicit exports to avoid conflicts

// Database exports
export {
  EnhancedDatabaseService,
  DatabaseModule,
  type DatabaseMetrics,
  type HealthCheckResult,
  type QueryMetrics,
  type PaginatedResult,
  type DatabaseConfig,
} from './database';

// I18n exports
export {
  LanguageService,
  LanguageGuard,
  AppI18nModule,
  CurrentLanguage,
  type SupportedLanguage,
  SUPPORTED_LANGUAGES,
  getDefaultLanguage,
} from './i18n';

// User module exports
export {
  UsersService,
  UsersController,
  UsersModule,
  UserService,
  ProfileService,
  UserAnalyticsService,
  UserQueryService,
  // DTOs
  CreateUserDto,
  CreateUserWithProfileDto,
  UpdateUserDto,
  ProfileTranslationDto,
  UpdateProfileTranslationDto,
  // Types (but not UserRole to avoid conflict)
  type SafeUser,
  type UserWithProfile,
  type UserStats,
  type PaginatedResponse,
  type Language,
} from './users';

// Auth module exports (including UserRole from here)
export {
  AuthService,
  AuthController,
  AuthModule,
  JwtStrategy,
  JwtAuthGuard,
  RolesGuard,
  CurrentUser,
  Public,
  Roles,
  UserRole, // Export UserRole only from auth module
  UserRoles,
  // DTOs
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  // Response types
  type AuthTokens,
  type RegisterResponse,
  type LoginResponse,
  type RefreshTokenResponse,
  type LogoutResponse,
} from './auth';

// Health module exports
export {
  EnhancedHealthService,
  HealthController,
  HealthModule,
  type SystemHealthCheck,
  type ServiceHealth,
} from './health';

// Common exports
export {
  LRUCache,
  CacheService,
  TranslationBaseDto,
  I18nExceptionFilter,
  ErrorResponseInterceptor,
  type ApiResponse,
  type PaginatedApiResponse,
} from './common';

// Shared exports
export { UserMapper, LanguageConverter } from './shared';

// Config exports
export {
  EnvConfig,
  envValidationSchema,
  type EnvironmentVariables,
  APP_CONSTANTS,
} from './config';

// Bootstrap exports
export {
  AppFactory,
  SecuritySetup,
  MiddlewareSetup,
  StartupLogger,
} from './bootstrap';

// Main app exports
export { AppModule } from './app.module';
export { AppController } from './app.controller';
export { AppService } from './app.service';
