// src/users/index.ts
// Main services
export { UsersService } from './users.service';
export { UsersController } from './users.controller';
export { UsersModule } from './users.module';

// Specialized services
export { UserService } from './services/user.service';
export { ProfileService } from './services/profile.service';
export { UserAnalyticsService } from './services/user-analytics.service';
export { UserQueryService } from './services/user-query.service';

// DTOs
export { CreateUserDto, CreateUserWithProfileDto } from './dto/create-user.dto';
export { UpdateUserDto } from './dto/update-user.dto';
export {
  ProfileTranslationDto,
  UpdateProfileTranslationDto,
} from './dto/profile-translation.dto';

// Types - Export all types EXCEPT UserRole to avoid conflict
export type {
  Language,
  SafeUser,
  CleanTranslation,
  ProfileWithTranslations,
  UserWithProfile,
  PrismaProfileTranslation,
  PrismaProfileWithTranslations,
  UserStats,
  PaginationMeta,
  PaginatedResponse,
  CreateUserResponse,
  CreateUserWithProfileResponse,
} from './types/user.types';

// Note: UserRole is NOT exported here to avoid conflict with auth module
