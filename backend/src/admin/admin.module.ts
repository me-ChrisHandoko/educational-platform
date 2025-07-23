import { Module } from '@nestjs/common';
import { AdminSecurityController } from './controllers/admin-security.controller';
import { AdminSecurityService } from './services/admin-security.service';
import { AdminGuard } from './guards/admin.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [PrismaModule, RedisModule, AuthModule, CommonModule],
  controllers: [AdminSecurityController],
  providers: [AdminSecurityService, AdminGuard],
  exports: [AdminSecurityService, AdminGuard],
})
export class AdminModule {}
