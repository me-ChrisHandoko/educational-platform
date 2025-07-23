import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

export interface RateLimitRecord {
  count: number;
  resetTime: number;
}

export interface TokenBlacklistRecord {
  userId: string;
  tokenId: string;
  expiresAt: Date;
  reason?: string;
}

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private readonly defaultTtl: number;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
  ) {
    this.defaultTtl = this.configService.get<number>('REDIS_DEFAULT_TTL', 300); // 5 minutes
  }

  /**
   * Rate Limiting Operations
   */
  async getRateLimit(key: string): Promise<RateLimitRecord | null> {
    try {
      const data = await this.cacheManager.get<RateLimitRecord>(
        `rate_limit:${key}`,
      );
      return data || null;
    } catch (error) {
      this.logger.error(`Failed to get rate limit for ${key}:`, error);
      return null;
    }
  }

  async setRateLimit(
    key: string,
    record: RateLimitRecord,
    ttlSeconds?: number,
  ): Promise<void> {
    try {
      const ttl =
        ttlSeconds || Math.ceil((record.resetTime - Date.now()) / 1000);
      await this.cacheManager.set(`rate_limit:${key}`, record, ttl * 1000);
    } catch (error) {
      this.logger.error(`Failed to set rate limit for ${key}:`, error);
    }
  }

  async incrementRateLimit(
    key: string,
    windowMs: number,
    limit: number,
  ): Promise<{
    count: number;
    resetTime: number;
    allowed: boolean;
  }> {
    try {
      const now = Date.now();
      const rateLimitKey = `rate_limit:${key}`;

      const existing =
        await this.cacheManager.get<RateLimitRecord>(rateLimitKey);

      if (!existing || now > existing.resetTime) {
        // New window
        const newRecord: RateLimitRecord = {
          count: 1,
          resetTime: now + windowMs,
        };

        await this.setRateLimit(key, newRecord, Math.ceil(windowMs / 1000));

        return {
          count: 1,
          resetTime: newRecord.resetTime,
          allowed: true,
        };
      }

      // Increment existing count
      const newCount = existing.count + 1;
      const updatedRecord: RateLimitRecord = {
        count: newCount,
        resetTime: existing.resetTime,
      };

      await this.setRateLimit(
        key,
        updatedRecord,
        Math.ceil((existing.resetTime - now) / 1000),
      );

      return {
        count: newCount,
        resetTime: existing.resetTime,
        allowed: newCount <= limit,
      };
    } catch (error) {
      this.logger.error(`Failed to increment rate limit for ${key}:`, error);
      // Fail open - allow the request if Redis is down
      return {
        count: 1,
        resetTime: Date.now() + windowMs,
        allowed: true,
      };
    }
  }

  /**
   * Token Blacklist Operations
   */
  async isTokenBlacklisted(tokenId: string): Promise<boolean> {
    try {
      const record = await this.cacheManager.get<TokenBlacklistRecord>(
        `blacklist:${tokenId}`,
      );
      return !!record;
    } catch (error) {
      this.logger.error(
        `Failed to check token blacklist for ${tokenId}:`,
        error,
      );
      return false; // Fail open
    }
  }

  async blacklistToken(
    tokenId: string,
    userId: string,
    expiresAt: Date,
    reason?: string,
  ): Promise<void> {
    try {
      const record: TokenBlacklistRecord = {
        userId,
        tokenId,
        expiresAt,
        reason,
      };

      const ttl = Math.max(
        1,
        Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
      );
      await this.cacheManager.set(`blacklist:${tokenId}`, record, ttl * 1000);

      this.logger.log(
        `Token ${tokenId} blacklisted for user ${userId}: ${reason || 'No reason'}`,
      );
    } catch (error) {
      this.logger.error(`Failed to blacklist token ${tokenId}:`, error);
    }
  }

  async removeTokenFromBlacklist(tokenId: string): Promise<void> {
    try {
      await this.cacheManager.del(`blacklist:${tokenId}`);
      this.logger.log(`Token ${tokenId} removed from blacklist`);
    } catch (error) {
      this.logger.error(
        `Failed to remove token ${tokenId} from blacklist:`,
        error,
      );
    }
  }

  /**
   * User Session and Status Caching
   */
  async getUserStatus(userId: string): Promise<string | null> {
    try {
      const result = await this.cacheManager.get<string>(
        `user_status:${userId}`,
      );
      return result || null;
    } catch (error) {
      this.logger.error(`Failed to get user status for ${userId}:`, error);
      return null;
    }
  }

  async setUserStatus(
    userId: string,
    status: string,
    ttlSeconds?: number,
  ): Promise<void> {
    try {
      const ttl = (ttlSeconds || this.defaultTtl) * 1000;
      await this.cacheManager.set(`user_status:${userId}`, status, ttl);
    } catch (error) {
      this.logger.error(`Failed to set user status for ${userId}:`, error);
    }
  }

  async cacheUserPermissions(
    userId: string,
    permissions: string[],
    ttlSeconds?: number,
  ): Promise<void> {
    try {
      const ttl = (ttlSeconds || this.defaultTtl) * 1000;
      await this.cacheManager.set(
        `user_permissions:${userId}`,
        permissions,
        ttl,
      );
    } catch (error) {
      this.logger.error(`Failed to cache permissions for ${userId}:`, error);
    }
  }

  async getUserPermissions(userId: string): Promise<string[] | null> {
    try {
      const result = await this.cacheManager.get<string[]>(
        `user_permissions:${userId}`,
      );
      return result || null;
    } catch (error) {
      this.logger.error(
        `Failed to get cached permissions for ${userId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Session Management
   */
  async setSession(
    sessionId: string,
    sessionData: any,
    ttlSeconds?: number,
  ): Promise<void> {
    try {
      const ttl = (ttlSeconds || this.defaultTtl) * 1000;
      await this.cacheManager.set(`session:${sessionId}`, sessionData, ttl);
    } catch (error) {
      this.logger.error(`Failed to set session ${sessionId}:`, error);
    }
  }

  async getSession(sessionId: string): Promise<any | null> {
    try {
      return await this.cacheManager.get(`session:${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to get session ${sessionId}:`, error);
      return null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.cacheManager.del(`session:${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to delete session ${sessionId}:`, error);
    }
  }

  /**
   * General Cache Operations
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const result = await this.cacheManager.get<T>(key);
      return result || null;
    } catch (error) {
      this.logger.error(`Failed to get cache key ${key}:`, error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const ttl = (ttlSeconds || this.defaultTtl) * 1000;
      await this.cacheManager.set(key, value, ttl);
    } catch (error) {
      this.logger.error(`Failed to set cache key ${key}:`, error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
    } catch (error) {
      this.logger.error(`Failed to delete cache key ${key}:`, error);
    }
  }

  async reset(): Promise<void> {
    try {
      // Note: cache-manager v5+ may not have reset method
      // This is a simplified implementation
      this.logger.log(
        'Cache reset requested - individual keys should be deleted manually',
      );
    } catch (error) {
      this.logger.error('Failed to reset cache:', error);
    }
  }

  /**
   * Get all keys matching a pattern (simplified implementation)
   * Note: This is a simplified implementation. In production, consider tracking keys
   * or using a different approach as cache-manager doesn't expose Redis KEYS directly.
   */
  async keys(pattern: string): Promise<string[]> {
    try {
      // This is a placeholder implementation
      // In production, you might want to track keys in a separate set
      // or use a different approach since cache-manager doesn't expose Redis KEYS
      this.logger.warn(
        `Keys pattern search requested: ${pattern} - using fallback implementation`,
      );
      return [];
    } catch (error) {
      this.logger.error(`Failed to get keys for pattern ${pattern}:`, error);
      return [];
    }
  }

  /**
   * Health Check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    latency?: number;
  }> {
    try {
      const start = Date.now();
      await this.cacheManager.set('health_check', 'ping', 5000);
      const result = await this.cacheManager.get('health_check');
      await this.cacheManager.del('health_check');

      const latency = Date.now() - start;

      if (result === 'ping') {
        return { status: 'healthy', latency };
      } else {
        return { status: 'unhealthy' };
      }
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return { status: 'unhealthy' };
    }
  }
}
