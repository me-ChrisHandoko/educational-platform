import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { redisStore } from 'cache-manager-ioredis-yet';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');

        if (!redisUrl) {
          console.warn('REDIS_URL not configured, using memory cache fallback');
          return {
            store: 'memory',
            max: 1000,
            ttl: 300, // 5 minutes default
          };
        }

        try {
          // Parse Redis URL or use default local Redis
          const redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            lazyConnect: true,
            keepAlive: 30000,
            connectTimeout: 10000,
            commandTimeout: 5000,
          });

          // Test connection
          await redis.ping();
          console.log('✅ Redis connected successfully');

          return {
            store: redisStore,
            redis,
            ttl: 300, // 5 minutes default
            max: 10000, // Maximum number of items in cache
            isGlobal: true,
          };
        } catch (error) {
          console.error('❌ Redis connection failed:', error.message);
          console.warn('Falling back to memory cache');

          return {
            store: 'memory',
            max: 1000,
            ttl: 300,
          };
        }
      },
    }),
  ],
  providers: [RedisService],
  exports: [CacheModule, RedisService],
})
export class RedisModule {}
