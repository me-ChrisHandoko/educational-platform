import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { AccountLockoutService } from './services/account-lockout.service';
import { PermissionService } from './services/permission.service';
import { TokenBlacklistService } from './services/token-blacklist.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    forwardRef(() => import('../common/common.module').then(m => m.CommonModule)),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    AccountLockoutService,
    PermissionService,
    TokenBlacklistService,
    JwtStrategy,
    LocalStrategy,
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtStrategy, AccountLockoutService],
})
export class AuthModule {}
