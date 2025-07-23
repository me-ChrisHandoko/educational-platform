import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../../redis/redis.service';

export interface TokenInfo {
  userId: string;
  sessionId: string;
  tokenId: string;
  expiresAt: Date;
  tokenType: 'access' | 'refresh';
}

@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);

  constructor(
    private redisService: RedisService,
    private jwtService: JwtService,
  ) {}

  /**
   * Add a token to the blacklist
   */
  async blacklistToken(token: string, reason?: string): Promise<void> {
    try {
      const tokenInfo = this.extractTokenInfo(token);

      if (!tokenInfo) {
        this.logger.warn('Failed to extract token info for blacklisting');
        return;
      }

      await this.redisService.blacklistToken(
        tokenInfo.tokenId,
        tokenInfo.userId,
        tokenInfo.expiresAt,
        reason,
      );

      this.logger.log(
        `Token blacklisted: ${tokenInfo.tokenId} for user ${tokenInfo.userId}`,
      );
    } catch (error) {
      this.logger.error('Failed to blacklist token:', error);
    }
  }

  /**
   * Check if a token is blacklisted
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const tokenInfo = this.extractTokenInfo(token);

      if (!tokenInfo) {
        return false; // Invalid token format, let JWT validation handle it
      }

      return await this.redisService.isTokenBlacklisted(tokenInfo.tokenId);
    } catch (error) {
      this.logger.error('Error checking token blacklist:', error);
      return false; // Fail open
    }
  }

  /**
   * Blacklist all tokens for a user (logout all sessions)
   */
  async blacklistAllUserTokens(userId: string, reason?: string): Promise<void> {
    try {
      // This is a simplified implementation
      // In a real scenario, you'd need to track all active tokens per user
      const allUserTokensKey = `user_tokens:${userId}`;
      const tokenIds =
        (await this.redisService.get<string[]>(allUserTokensKey)) || [];

      const blacklistPromises = tokenIds.map((tokenId) =>
        this.redisService.blacklistToken(
          tokenId,
          userId,
          new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
          reason || 'User logout all sessions',
        ),
      );

      await Promise.all(blacklistPromises);

      // Clear the user tokens list
      await this.redisService.del(allUserTokensKey);

      this.logger.log(`All tokens blacklisted for user ${userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to blacklist all tokens for user ${userId}:`,
        error,
      );
    }
  }

  /**
   * Blacklist tokens by session
   */
  async blacklistSessionTokens(
    sessionId: string,
    userId: string,
    reason?: string,
  ): Promise<void> {
    try {
      const sessionTokensKey = `session_tokens:${sessionId}`;
      const tokenIds =
        (await this.redisService.get<string[]>(sessionTokensKey)) || [];

      const blacklistPromises = tokenIds.map((tokenId) =>
        this.redisService.blacklistToken(
          tokenId,
          userId,
          new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
          reason || 'Session terminated',
        ),
      );

      await Promise.all(blacklistPromises);

      // Clear the session tokens list
      await this.redisService.del(sessionTokensKey);

      this.logger.log(`Session tokens blacklisted: ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to blacklist session tokens ${sessionId}:`,
        error,
      );
    }
  }

  /**
   * Track a token (for later blacklisting)
   */
  async trackToken(
    token: string,
    tokenType: 'access' | 'refresh',
  ): Promise<void> {
    try {
      const tokenInfo = this.extractTokenInfo(token);

      if (!tokenInfo) {
        return;
      }

      // Track token by user
      const userTokensKey = `user_tokens:${tokenInfo.userId}`;
      const userTokens =
        (await this.redisService.get<string[]>(userTokensKey)) || [];

      if (!userTokens.includes(tokenInfo.tokenId)) {
        userTokens.push(tokenInfo.tokenId);
        await this.redisService.set(userTokensKey, userTokens, 24 * 60 * 60); // 24 hours
      }

      // Track token by session
      const sessionTokensKey = `session_tokens:${tokenInfo.sessionId}`;
      const sessionTokens =
        (await this.redisService.get<string[]>(sessionTokensKey)) || [];

      if (!sessionTokens.includes(tokenInfo.tokenId)) {
        sessionTokens.push(tokenInfo.tokenId);
        await this.redisService.set(
          sessionTokensKey,
          sessionTokens,
          24 * 60 * 60,
        ); // 24 hours
      }

      // Store token details
      const tokenDetailsKey = `token_details:${tokenInfo.tokenId}`;
      await this.redisService.set(
        tokenDetailsKey,
        {
          ...tokenInfo,
          tokenType,
          trackedAt: new Date(),
        },
        Math.ceil((tokenInfo.expiresAt.getTime() - Date.now()) / 1000),
      );
    } catch (error) {
      this.logger.error('Failed to track token:', error);
    }
  }

  /**
   * Remove a token from tracking (when it expires naturally)
   */
  async untrackToken(token: string): Promise<void> {
    try {
      const tokenInfo = this.extractTokenInfo(token);

      if (!tokenInfo) {
        return;
      }

      // Remove from user tokens
      const userTokensKey = `user_tokens:${tokenInfo.userId}`;
      const userTokens =
        (await this.redisService.get<string[]>(userTokensKey)) || [];
      const updatedUserTokens = userTokens.filter(
        (id) => id !== tokenInfo.tokenId,
      );

      if (updatedUserTokens.length > 0) {
        await this.redisService.set(
          userTokensKey,
          updatedUserTokens,
          24 * 60 * 60,
        );
      } else {
        await this.redisService.del(userTokensKey);
      }

      // Remove from session tokens
      const sessionTokensKey = `session_tokens:${tokenInfo.sessionId}`;
      const sessionTokens =
        (await this.redisService.get<string[]>(sessionTokensKey)) || [];
      const updatedSessionTokens = sessionTokens.filter(
        (id) => id !== tokenInfo.tokenId,
      );

      if (updatedSessionTokens.length > 0) {
        await this.redisService.set(
          sessionTokensKey,
          updatedSessionTokens,
          24 * 60 * 60,
        );
      } else {
        await this.redisService.del(sessionTokensKey);
      }

      // Remove token details
      await this.redisService.del(`token_details:${tokenInfo.tokenId}`);
    } catch (error) {
      this.logger.error('Failed to untrack token:', error);
    }
  }

  /**
   * Get active sessions for a user
   */
  async getUserActiveSessions(userId: string): Promise<string[]> {
    try {
      const userTokensKey = `user_tokens:${userId}`;
      const tokenIds =
        (await this.redisService.get<string[]>(userTokensKey)) || [];

      const sessionIds = new Set<string>();

      for (const tokenId of tokenIds) {
        const tokenDetails = await this.redisService.get<
          TokenInfo & { tokenType: string; trackedAt: Date }
        >(`token_details:${tokenId}`);

        if (
          tokenDetails &&
          !(await this.redisService.isTokenBlacklisted(tokenId))
        ) {
          sessionIds.add(tokenDetails.sessionId);
        }
      }

      return Array.from(sessionIds);
    } catch (error) {
      this.logger.error(
        `Failed to get active sessions for user ${userId}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Extract token information for tracking/blacklisting
   */
  private extractTokenInfo(token: string): TokenInfo | null {
    try {
      // Decode without verification to extract info
      const decoded = this.jwtService.decode(token);

      if (!decoded || !decoded.sub || !decoded.exp) {
        return null;
      }

      return {
        userId: decoded.sub,
        sessionId: decoded.sessionId || 'unknown',
        tokenId: decoded.jti || this.generateTokenId(token),
        expiresAt: new Date(decoded.exp * 1000),
        tokenType: decoded.type || 'access',
      };
    } catch (error) {
      this.logger.error('Failed to extract token info:', error);
      return null;
    }
  }

  /**
   * Generate a token ID if not present in JWT
   */
  private generateTokenId(token: string): string {
    // Use first 16 chars of base64 encoded token hash
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(token)
      .digest('base64')
      .substring(0, 16);
  }

  /**
   * Cleanup expired blacklist entries (optional maintenance method)
   */
  async cleanupExpiredEntries(): Promise<void> {
    // This would be called by a scheduled job
    // Redis TTL handles most cleanup automatically
    this.logger.log(
      'Blacklist cleanup completed (Redis TTL handles most cleanup)',
    );
  }
}
