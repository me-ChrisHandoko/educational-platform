import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { MetricsService } from './metrics.service';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;
  private readonly defaultTTL: number;

  constructor(
    private configService: ConfigService,
    private metricsService: MetricsService,
  ) {
    this.redis = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      db: this.configService.get('REDIS_DB', 0),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        this.logger.warn(`Redis connection retry attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: false,
    });

    this.defaultTTL = this.configService.get('CACHE_DEFAULT_TTL', 3600);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      this.logger.log('Redis connected');
    });

    this.redis.on('ready', () => {
      this.logger.log('Redis ready');
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis error', error);
    });

    this.redis.on('close', () => {
      this.logger.warn('Redis connection closed');
    });

    this.redis.on('reconnecting', () => {
      this.logger.log('Redis reconnecting...');
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      
      if (value) {
        this.metricsService.incrementCounter('cache_hit', { key_type: this.getKeyType(key) });
        return JSON.parse(value);
      }
      
      this.metricsService.incrementCounter('cache_miss', { key_type: this.getKeyType(key) });
      return null;
    } catch (error) {
      this.logger.error(`Error getting cache key ${key}`, error);
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const expiry = ttl || this.defaultTTL;
      
      await this.redis.setex(key, expiry, serialized);
      this.metricsService.incrementCounter('cache_set', { key_type: this.getKeyType(key) });
    } catch (error) {
      this.logger.error(`Error setting cache key ${key}`, error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
      this.metricsService.incrementCounter('cache_delete', { key_type: this.getKeyType(key) });
    } catch (error) {
      this.logger.error(`Error deleting cache key ${key}`, error);
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    
    try {
      await this.redis.del(...keys);
      keys.forEach(key => {
        this.metricsService.incrementCounter('cache_delete', { key_type: this.getKeyType(key) });
      });
    } catch (error) {
      this.logger.error('Error deleting multiple cache keys', error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Error checking cache key existence ${key}`, error);
      return false;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.redis.keys(pattern);
    } catch (error) {
      this.logger.error(`Error getting keys with pattern ${pattern}`, error);
      return [];
    }
  }

  async flushAll(): Promise<void> {
    if (this.configService.get('NODE_ENV') === 'production') {
      throw new Error('Cannot flush cache in production');
    }
    
    try {
      await this.redis.flushall();
      this.logger.warn('Cache flushed');
    } catch (error) {
      this.logger.error('Error flushing cache', error);
    }
  }

  async getTTL(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logger.error(`Error getting TTL for key ${key}`, error);
      return -1;
    }
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.redis.expire(key, ttl);
      return result === 1;
    } catch (error) {
      this.logger.error(`Error setting expiry for key ${key}`, error);
      return false;
    }
  }

  // Hash operations
  async hget<T>(key: string, field: string): Promise<T | null> {
    try {
      const value = await this.redis.hget(key, field);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      this.logger.error(`Error getting hash field ${key}:${field}`, error);
      return null;
    }
  }

  async hset(key: string, field: string, value: any, ttl?: number): Promise<void> {
    try {
      await this.redis.hset(key, field, JSON.stringify(value));
      if (ttl) {
        await this.redis.expire(key, ttl);
      }
    } catch (error) {
      this.logger.error(`Error setting hash field ${key}:${field}`, error);
    }
  }

  async hgetall<T>(key: string): Promise<Record<string, T>> {
    try {
      const data = await this.redis.hgetall(key);
      const result: Record<string, T> = {};
      
      for (const [field, value] of Object.entries(data)) {
        result[field] = JSON.parse(value);
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Error getting hash ${key}`, error);
      return {};
    }
  }

  async hdel(key: string, ...fields: string[]): Promise<void> {
    try {
      await this.redis.hdel(key, ...fields);
    } catch (error) {
      this.logger.error(`Error deleting hash fields from ${key}`, error);
    }
  }

  // Set operations
  async sadd(key: string, ...members: string[]): Promise<void> {
    try {
      await this.redis.sadd(key, ...members);
    } catch (error) {
      this.logger.error(`Error adding to set ${key}`, error);
    }
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    try {
      await this.redis.srem(key, ...members);
    } catch (error) {
      this.logger.error(`Error removing from set ${key}`, error);
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      return await this.redis.smembers(key);
    } catch (error) {
      this.logger.error(`Error getting set members ${key}`, error);
      return [];
    }
  }

  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const result = await this.redis.sismember(key, member);
      return result === 1;
    } catch (error) {
      this.logger.error(`Error checking set membership ${key}:${member}`, error);
      return false;
    }
  }

  // List operations
  async lpush(key: string, ...values: string[]): Promise<void> {
    try {
      await this.redis.lpush(key, ...values);
    } catch (error) {
      this.logger.error(`Error pushing to list ${key}`, error);
    }
  }

  async rpush(key: string, ...values: string[]): Promise<void> {
    try {
      await this.redis.rpush(key, ...values);
    } catch (error) {
      this.logger.error(`Error pushing to list ${key}`, error);
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.redis.lrange(key, start, stop);
    } catch (error) {
      this.logger.error(`Error getting list range ${key}`, error);
      return [];
    }
  }

  async llen(key: string): Promise<number> {
    try {
      return await this.redis.llen(key);
    } catch (error) {
      this.logger.error(`Error getting list length ${key}`, error);
      return 0;
    }
  }

  // Atomic operations
  async incr(key: string): Promise<number> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      this.logger.error(`Error incrementing ${key}`, error);
      return 0;
    }
  }

  async decr(key: string): Promise<number> {
    try {
      return await this.redis.decr(key);
    } catch (error) {
      this.logger.error(`Error decrementing ${key}`, error);
      return 0;
    }
  }

  async incrby(key: string, increment: number): Promise<number> {
    try {
      return await this.redis.incrby(key, increment);
    } catch (error) {
      this.logger.error(`Error incrementing ${key} by ${increment}`, error);
      return 0;
    }
  }

  // Utility methods
  private getKeyType(key: string): string {
    const parts = key.split(':');
    return parts[0] || 'unknown';
  }

  async getInfo(): Promise<string> {
    try {
      return await this.redis.info();
    } catch (error) {
      this.logger.error('Error getting Redis info', error);
      return '';
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger.error('Error pinging Redis', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.redis.quit();
      this.logger.log('Redis disconnected');
    } catch (error) {
      this.logger.error('Error disconnecting from Redis', error);
    }
  }
}
