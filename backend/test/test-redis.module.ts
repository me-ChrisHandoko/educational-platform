import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { RedisService } from '../src/redis/redis.service';
import { TEST_CONFIG } from './setup';

/**
 * Test-specific Redis module that uses memory cache directly
 * Avoids Redis connection attempts and associated errors in test environment
 * Uses parameterized configuration from TEST_CONFIG
 */
@Global()
@Module({
  imports: [
    CacheModule.register({
      store: 'memory',
      max: TEST_CONFIG.CACHE_MAX_ITEMS,
      ttl: TEST_CONFIG.CACHE_TTL_SECONDS,
    }),
  ],
  providers: [RedisService],
  exports: [CacheModule, RedisService],
})
export class TestRedisModule {}