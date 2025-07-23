import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { CommonModule } from './common/common.module';
import { AdminModule } from './admin/admin.module';
import configuration from './config/configuration';
import { configValidationSchema } from './config/validation.schema';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { SecurityMiddleware } from './common/middleware/security.middleware';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { CacheInterceptor } from './common/interceptors/cache.interceptor';
import { DatabaseMetricsInterceptor } from './common/interceptors/database-metrics.interceptor';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: configValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: true,
        stripUnknown: true,
      },
      cache: true,
      expandVariables: true,
    }),
    
    // Scheduling
    ScheduleModule.forRoot(),
    
    // Event emitter for async operations
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),
    
    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          name: 'short',
          ttl: 60000, // 1 minute
          limit: configService.get('RATE_LIMIT_SHORT', 20),
        },
        {
          name: 'medium',
          ttl: 900000, // 15 minutes
          limit: configService.get('RATE_LIMIT_MEDIUM', 100),
        },
        {
          name: 'long',
          ttl: 3600000, // 1 hour
          limit: configService.get('RATE_LIMIT_LONG', 300),
        },
      ],
    }),
    
    // Core modules
    CommonModule,
    RedisModule,
    PrismaModule,
    
    // Feature modules
    AuthModule,
    AdminModule,
    HealthModule,
    MonitoringModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global guards
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global interceptors
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DatabaseMetricsInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply middleware in order
    consumer
      .apply(
        RequestContextMiddleware,
        SecurityMiddleware,
        TenantMiddleware,
      )
      .forRoutes('*');
  }
}
