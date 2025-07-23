import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { TestRedisModule } from './test-redis.module';
import { HealthModule } from '../src/health/health.module';
import { MonitoringModule } from '../src/monitoring/monitoring.module';
import { CommonModule } from '../src/common/common.module';
import { AdminModule } from '../src/admin/admin.module';
import configuration from '../src/config/configuration';
import { configValidationSchema } from '../src/config/validation.schema';
import { RequestContextMiddleware } from '../src/common/middleware/request-context.middleware';

/**
 * Test-specific AppModule without problematic modules that cause Fastify hooks conflicts
 * - Excludes ThrottlerModule (causes hooks.length undefined error)
 * - Excludes SecurityMiddleware (simplifies test setup)
 * - Minimal configuration for stable testing
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: configValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: true,
        stripUnknown: true,
      },
    }),
    // ThrottlerModule REMOVED - causes Fastify hooks conflicts in tests
    CommonModule,
    TestRedisModule, // Uses memory cache, no Redis connection attempts
    PrismaModule,
    AuthModule,
    AdminModule,
    HealthModule,
    MonitoringModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // ThrottlerGuard REMOVED - not needed for auth tests
  ],
})
export class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Only essential middleware for tests
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}