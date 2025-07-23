import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Services
import { AuditService } from './services/audit.service';
import { SecurityConfigService } from './services/security-config.service';
import { MetricsService } from './services/metrics.service';
import { CacheService } from './services/cache.service';

// Middleware
import { RequestContextMiddleware } from './middleware/request-context.middleware';
import { SecurityMiddleware } from './middleware/security.middleware';
import { TenantMiddleware } from './middleware/tenant.middleware';

// Import PrismaModule for AuditService
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
  ],
  providers: [
    // Services
    AuditService,
    SecurityConfigService,
    MetricsService,
    CacheService,

    // Middleware
    RequestContextMiddleware,
    SecurityMiddleware,
    TenantMiddleware,
  ],
  exports: [
    // Export all services for use in other modules
    AuditService,
    SecurityConfigService,
    MetricsService,
    CacheService,
    
    // Export middleware
    RequestContextMiddleware,
    SecurityMiddleware,
    TenantMiddleware,
  ],
})
export class CommonModule {}
