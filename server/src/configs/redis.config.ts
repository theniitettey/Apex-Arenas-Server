import Redis, { RedisOptions } from 'ioredis';
import { createLogger } from '../shared/utils/logger.utils';
import { env } from './env.config';

const logger = createLogger('redis');

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset_time: number;
}

interface CachedSession {
  user_id: string;
  email: string;
  role: 'player' | 'organizer' | 'admin';
  cached_at: number;
}

interface BlacklistedToken {
  token_hash: string;
  reason: string;
  blacklisted_at: number;
  expires_at: number;
}

/**
 * Redis Manager for caching, rate limiting, and distributed locks
 * Note: OTP storage is handled by MongoDB (TTL indexes) - Redis not needed for OTP in monolith
 */

class RedisManager {
  private static instance: RedisManager;
  private client: Redis;
  private is_connected = false;

  private readonly KEY_PREFIXES = {
    RATE_LIMIT: 'rate:',
    SESSION_CACHE: 'session:',
    TOKEN_BLACKLIST: 'blacklist:',
    LOCK: 'lock:',
    USER_CACHE: 'user:',
    FAILED_ATTEMPTS: 'failed:'
  };

  private constructor() {
    const options: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      autoResendUnfulfilledCommands: true,
      enableOfflineQueue: true,
      retryStrategy: (times) => {
        if (times > 10) {
          logger.error('Redis max retries reached, giving up');
          return null;
        }
        return Math.min(times * 200, 2000);
      }
    };

    if (env.REDIS_TLS) {
      options.tls = {};
    }

    if (env.REDIS_PASSWORD) {
      options.password = env.REDIS_PASSWORD;
    }

    if (env.REDIS_URL) {
      this.client = new Redis(env.REDIS_URL, options);
    } else {
      this.client = new Redis(options);
    }

    this.setupEventListeners();
  }

  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  private setupEventListeners(): void {
    this.client.on('connect', () => {
      logger.info('Redis connecting...');
    });

    this.client.on('ready', () => {
      this.is_connected = true;
      logger.info('Redis connected and ready');
    });

    this.client.on('error', (error) => {
      this.is_connected = false;
      logger.error('Redis error:', error);
    });

    this.client.on('close', () => {
      this.is_connected = false;
      logger.warn('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });
  }

  // ============================================
  // CONNECTION MANAGEMENT
  // ============================================

  public async connect(): Promise<void> {
    if (this.is_connected) {
      return;
    }

    try {
      await this.client.connect();
      logger.info('Redis connection established');
    } catch (error: any) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.is_connected) {
      return;
    }

    try {
      await this.client.quit();
      this.is_connected = false;
      logger.info('Redis disconnected gracefully');
    } catch (error: any) {
      logger.error('Error disconnecting from Redis:', error);
      throw error;
    }
  }

  public isHealthy(): boolean {
    return this.is_connected && this.client.status === 'ready';
  }

  // ============================================
  // RATE LIMITING
  // ============================================

  /**
   * Check rate limit using sliding window algorithm
   */
  async checkRateLimit(
    identifier: string,
    action: 'login' | 'otp_request' | 'password_reset' | 'registration' | 'api_call',
    window_seconds: number,
    max_requests: number
  ): Promise<RateLimitResult> {
    const key = `${this.KEY_PREFIXES.RATE_LIMIT}${action}:${identifier}`;
    const now = Date.now();
    const window_start = now - (window_seconds * 1000);

    try {
      const pipeline = this.client.pipeline();
      pipeline.zremrangebyscore(key, 0, window_start);
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      pipeline.zcard(key);
      pipeline.expire(key, window_seconds);

      const results = await pipeline.exec();

      if (!results) {
        logger.error('Redis pipeline execution failed');
        return { allowed: true, remaining: max_requests, reset_time: now + (window_seconds * 1000) };
      }

      const request_count = results[2][1] as number;
      const remaining = Math.max(0, max_requests - request_count);
      const reset_time = now + (window_seconds * 1000);

      return {
        allowed: request_count <= max_requests,
        remaining,
        reset_time
      };
    } catch (error: any) {
      logger.error('Rate limit check failed:', error);
      // Fail open - allow request if Redis is down
      return { allowed: true, remaining: max_requests, reset_time: now + (window_seconds * 1000) };
    }
  }

  /**
   * Reset rate limit for an identifier
   */
  async resetRateLimit(identifier: string, action: string): Promise<void> {
    const key = `${this.KEY_PREFIXES.RATE_LIMIT}${action}:${identifier}`;
    await this.client.del(key);
    logger.debug('Rate limit reset', { identifier, action });
  }

  // ============================================
  // FAILED LOGIN ATTEMPTS
  // ============================================

  
  /**
   * Get failed attempt count
   */
  async getFailedAttempts(identifier: string): Promise<number> {
    const key = `${this.KEY_PREFIXES.FAILED_ATTEMPTS}${identifier}`;

    try {
      const count = await this.client.get(key);
      return count ? parseInt(count, 10) : 0;
    } catch (error: any) {
      logger.error('Failed to get attempt count:', error);
      return 0;
    }
  }

  /**
   * Reset failed attempts after successful login
   */
  async resetFailedAttempts(identifier: string): Promise<void> {
    const key = `${this.KEY_PREFIXES.FAILED_ATTEMPTS}${identifier}`;
    await this.client.del(key);
    logger.debug('Failed attempts reset', { identifier });
  }

  
  /**
   * Blacklist an access token (for logout)
   */
  async blacklistToken(
    tokenHash: string, 
    ttlSeconds: number = env.TOKEN_BLACKLIST_TTL_SECONDS
  ): Promise<void> {
    try {
      const key = `blacklist:token:${tokenHash}`;
      await this.client.setex(key, ttlSeconds, '1');
    } catch (error:any) {
      logger.error('Error blacklisting token:', error);
      throw error;
    }
  }

  /**
   * Check if a token is blacklisted
   */
  async isTokenBlacklisted(tokenHash: string): Promise<boolean> {
    try {
      const key = `blacklist:token:${tokenHash}`;
      const result = await this.client.get(key);
      return result !== null;
    } catch (error:any) {
      logger.error('Error checking token blacklist:', error);
      return false;
    }
  }

  /**
   * Block an IP address for suspicious activity
   */
  async blockIP(
    ip_address: string, 
    ttlSeconds: number = env.IP_BLOCK_DURATION_SECONDS
  ): Promise<void> {
    try {
      const key = `blocked:ip:${ip_address}`;
      await this.client.setex(key, ttlSeconds, '1');
      logger.info('IP blocked', { ip_address, ttl: ttlSeconds });
    } catch (error:any) {
      logger.error('Error blocking IP:', error);
      throw error;
    }
  }

  /**
   * Check if an IP is blocked
   */
  async isIPBlocked(ip_address: string): Promise<boolean> {
    try {
      const key = `blocked:ip:${ip_address}`;
      const result = await this.client.get(key);
      return result !== null;
    } catch (error:any) {
      logger.error('Error checking IP block:', error);
      // Fail open - don't block on error
      return false;
    }
  }

  /**
   * Unblock an IP address
   */
  async unblockIP(ip_address: string): Promise<void> {
    try {
      const key = `blocked:ip:${ip_address}`;
      await this.client.del(key);
      logger.info('IP unblocked', { ip_address });
    } catch (error:any) {
      logger.error('Error unblocking IP:', error);
      throw error;
    }
  }

  /**
   * Track failed attempts for an IP (for auto-blocking)
   */
  async trackFailedAttempt(
    ip_address: string, 
    action: string
  ): Promise<{ count: number; shouldBlock: boolean }> {
    try {
      const key = `failed:${action}:${ip_address}`;
      const count = await this.client.incr(key);
      
      if (count === 1) {
        await this.client.expire(key, env.LOCKOUT_WINDOW_MINUTES * 60);
      }

      // Use config threshold
      const shouldBlock = count >= env.IP_AUTO_BLOCK_FAILED_THRESHOLD;
      if (shouldBlock) {
        await this.blockIP(ip_address, env.IP_BLOCK_DURATION_SECONDS);
      }

      return { count, shouldBlock };
    } catch (error:any) {
      logger.error('Error tracking failed attempt:', error);
      return { count: 0, shouldBlock: false };
    }
  }

  // ============================================
  // SESSION CACHING
  // ============================================

  /**
   * Cache session data for faster access
   */
  async cacheSession(
    user_id: string,
    session_data: CachedSession,
    ttl_seconds: number = 300
  ): Promise<void> {
    const key = `${this.KEY_PREFIXES.SESSION_CACHE}${user_id}`;

    try {
      await this.client.setex(key, ttl_seconds, JSON.stringify(session_data));
      logger.debug('Session cached', { user_id });
    } catch (error: any) {
      logger.error('Failed to cache session:', error);
      // Don't throw - caching failure shouldn't break auth
    }
  }

  /**
   * Get cached session
   */
  async getCachedSession(user_id: string): Promise<CachedSession | null> {
    const key = `${this.KEY_PREFIXES.SESSION_CACHE}${user_id}`;

    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error: any) {
      logger.error('Failed to get cached session:', error);
      return null;
    }
  }

  /**
   * Invalidate cached session
   */
  async invalidateSessionCache(user_id: string): Promise<void> {
    const key = `${this.KEY_PREFIXES.SESSION_CACHE}${user_id}`;
    await this.client.del(key);
    logger.debug('Session cache invalidated', { user_id });
  }

  // ============================================
  // DISTRIBUTED LOCKS
  // ============================================

  /**
   * Acquire a distributed lock (prevent race conditions)
   */
  async acquireLock(lock_name: string, ttl_seconds: number = 10): Promise<boolean> {
    const key = `${this.KEY_PREFIXES.LOCK}${lock_name}`;
    const lock_value = `${Date.now()}-${Math.random()}`;

    try {
      const result = await this.client.set(key, lock_value, 'PX', ttl_seconds * 1000, 'NX');
      return result === 'OK';
    } catch (error: any) {
      logger.error('Failed to acquire lock:', error);
      return false;
    }
  }

  /**
   * Release a distributed lock
   */
  async releaseLock(lock_name: string): Promise<void> {
    const key = `${this.KEY_PREFIXES.LOCK}${lock_name}`;

    try {
      await this.client.del(key);
    } catch (error: any) {
      logger.error('Failed to release lock:', error);
    }
  }

  /**
   * Execute with lock (helper method)
   */
  async withLock<T>(
    lock_name: string,
    operation: () => Promise<T>,
    ttl_seconds: number = 10
  ): Promise<T | null> {
    const acquired = await this.acquireLock(lock_name, ttl_seconds);

    if (!acquired) {
      logger.warn('Could not acquire lock', { lock_name });
      return null;
    }

    try {
      return await operation();
    } finally {
      await this.releaseLock(lock_name);
    }
  }

  // ============================================
  // USER CACHE
  // ============================================

  /**
   * Cache user data for faster lookups
   */
  async cacheUser(user_id: string, user_data: any, ttl_seconds: number = 600): Promise<void> {
    const key = `${this.KEY_PREFIXES.USER_CACHE}${user_id}`;

    try {
      await this.client.setex(key, ttl_seconds, JSON.stringify(user_data));
    } catch (error: any) {
      logger.error('Failed to cache user:', error);
    }
  }

  /**
   * Get cached user
   */
  async getCachedUser(user_id: string): Promise<any | null> {
    const key = `${this.KEY_PREFIXES.USER_CACHE}${user_id}`;

    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error: any) {
      logger.error('Failed to get cached user:', error);
      return null;
    }
  }

  /**
   * Invalidate user cache
   */
  async invalidateUserCache(user_id: string): Promise<void> {
    const key = `${this.KEY_PREFIXES.USER_CACHE}${user_id}`;
    await this.client.del(key);
  }

  // ============================================
  // HEALTH CHECK
  // ============================================

  async healthCheck(): Promise<{ status: string; latency_ms?: number }> {
    if (!this.is_connected) {
      return { status: 'disconnected' };
    }

    try {
      const start = Date.now();
      await this.client.ping();
      const latency_ms = Date.now() - start;

      return {
        status: 'healthy',
        latency_ms
      };
    } catch (error: any) {
      logger.error('Redis health check failed:', error);
      return { status: 'unhealthy' };
    }
  }

  // ============================================
  // UTILITIES
  // ============================================

  /**
   * Flush all keys matching a pattern (use with caution)
   */
  async flushPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let deleted_count = 0;

    do {
      const [next_cursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);

      if (keys.length > 0) {
        await this.client.del(...keys);
        deleted_count += keys.length;
      }

      cursor = next_cursor;
    } while (cursor !== '0');

    logger.info('Keys flushed', { pattern, deleted_count });
    return deleted_count;
  }

  /**
   * Get underlying Redis client (for advanced usage)
   */
  getClient(): Redis {
    return this.client;
  }
}

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, closing Redis connection...');
  await RedisManager.getInstance().disconnect();
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, closing Redis connection...');
  await RedisManager.getInstance().disconnect();
});

export const redisManager = RedisManager.getInstance();