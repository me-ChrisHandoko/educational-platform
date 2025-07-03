// src/shared/mappers/user.mapper.ts
import {
  SafeUser,
  UserWithProfile,
  CleanTranslation,
} from '../../users/types/user.types';

// Define types locally to avoid Prisma import issues
interface UserEntity {
  id: string;
  email: string;
  password: string;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt: Date | null;
  preferredLanguage: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface ProfileEntity {
  id: string;
  userId: string;
  avatar: string | null;
  phone: string | null;
  address: string | null;
  birthday: Date | null;
}

interface ProfileTranslationEntity {
  id: string;
  profileId: string;
  language: string;
  firstName: string;
  lastName: string;
  bio: string | null;
}

interface ProfileWithTranslations extends ProfileEntity {
  translations: ProfileTranslationEntity[];
}

export class UserMapper {
  /**
   * Convert Prisma User to SafeUser (remove password)
   */
  static toSafeUser(prismaUser: UserEntity): SafeUser {
    const { password, ...safeUser } = prismaUser;
    return safeUser as SafeUser;
  }

  /**
   * Convert ProfileTranslation to CleanTranslation
   */
  static toCleanTranslation(
    translation: ProfileTranslationEntity,
  ): CleanTranslation {
    return {
      language: translation.language as any, // Cast to Language type
      firstName: translation.firstName,
      lastName: translation.lastName,
      bio: translation.bio || undefined,
    };
  }

  /**
   * Convert Profile with translations to clean format
   */
  static toCleanProfile(profile: ProfileWithTranslations) {
    return {
      id: profile.id,
      avatar: profile.avatar,
      phone: profile.phone,
      address: profile.address,
      birthday: profile.birthday,
      userId: profile.userId,
      translations: profile.translations.map(this.toCleanTranslation),
    };
  }

  /**
   * Convert User with Profile to UserWithProfile
   */
  static toUserWithProfile(
    user: UserEntity,
    profile?: ProfileWithTranslations,
  ): UserWithProfile {
    const safeUser = this.toSafeUser(user);

    if (profile) {
      return {
        ...safeUser,
        profile: this.toCleanProfile(profile),
      };
    }

    return safeUser;
  }
}
