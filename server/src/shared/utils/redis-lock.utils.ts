/**
 * ============================================
 * REDIS DISTRIBUTED LOCK UTILITY
 * ============================================
 * Prevents race conditions in tournament operations
 * 
 * Usage:
 * ```typescript
 * const result = await redisLock.executeWithLock(
 *   'tournament:123:registration',
 *   async () => {
 *     // Your critical section code
 *     return someValue;
 *   },
 *   { ttl: 5000, retries: 3 }
 * );
 * ```
 */

import { redisManager } from '../../configs/redis.config';
import { createLogger } from './logger.utils';
import { AppError } from './error.utils';

const logger = createLogger('redis-lock-util');

export interface LockOptions {
  ttl?: number; // Time-to-live in milliseconds (default: 5000ms)
  retries?: number; // Number of retry attempts (default: 3)
  retryDelay?: number; // Delay between retries in ms (default: 100ms)
  throwOnFail?: boolean; // Throw error if lock can't be acquired (default: true)
}

export class RedisLock {
  private static instance: RedisLock;

  private constructor() {}

  public static getInstance(): RedisLock {
    if (!RedisLock.instance) {
      RedisLock.instance = new RedisLock();
    }
    return RedisLock.instance;
  }

  /**
   * Execute an operation with distributed lock protection
   * Automatically retries if lock is busy
   */
  async executeWithLock<T>(
    lockKey: string,
    operation: () => Promise<T>,
    options: LockOptions = {}
  ): Promise<T> {
    const {
      ttl = 5000, // 5 seconds default
      retries = 3,
      retryDelay = 100,
      throwOnFail = true
    } = options;

    let lastError: Error | null = null;
    let attempts = 0;

    // Try to acquire lock with retries
    while (attempts <= retries) {
      attempts++;

      try {
        // Attempt to acquire lock
        const acquired = await redisManager.acquireLock(lockKey, ttl / 1000);

        if (acquired) {
          logger.debug('Lock acquired', { lockKey, attempt: attempts });

          try {
            // Execute the critical section
            const result = await operation();
            
            // Release lock
            await redisManager.releaseLock(lockKey);
            logger.debug('Lock released', { lockKey });

            return result;
          } catch (operationError: any) {
            // Release lock even if operation fails
            await redisManager.releaseLock(lockKey).catch(() => {
              logger.warn('Failed to release lock after operation error', { lockKey });
            });
            throw operationError;
          }
        }

        // Lock not acquired, prepare for retry
        lastError = new Error(`Could not acquire lock: ${lockKey}`);
        
        if (attempts <= retries) {
          logger.debug('Lock busy, retrying...', { 
            lockKey, 
            attempt: attempts, 
            maxRetries: retries 
          });
          await this.sleep(retryDelay);
        }

      } catch (error: any) {
        lastError = error;
        logger.error('Lock acquisition error', { 
          lockKey, 
          attempt: attempts, 
          error: error.message 
        });
        
        if (attempts <= retries) {
          await this.sleep(retryDelay);
        }
      }
    }

    // All retries exhausted
    logger.error('Failed to acquire lock after retries', { 
      lockKey, 
      attempts, 
      maxRetries: retries 
    });

    if (throwOnFail) {
      throw new AppError(
        'LOCK_ACQUISITION_FAILED',
        lastError?.message || `Could not acquire lock: ${lockKey} after ${attempts} attempts`
      );
    }

    // If not throwing, return null (caller must handle)
    return null as T;
  }

  /**
   * Check if a lock exists (without trying to acquire it)
   */
  async isLocked(lockKey: string): Promise<boolean> {
    try {
      const client = redisManager.getClient();
      const exists = await client.exists(`lock:${lockKey}`);
      return exists === 1;
    } catch (error: any) {
      logger.error('Error checking lock status', { lockKey, error: error.message });
      return false;
    }
  }

  /**
   * Force release a lock (use with caution!)
   * Only use for cleanup/admin operations
   */
  async forceReleaseLock(lockKey: string): Promise<void> {
    try {
      await redisManager.releaseLock(lockKey);
      logger.warn('Lock forcefully released', { lockKey });
    } catch (error: any) {
      logger.error('Error force releasing lock', { lockKey, error: error.message });
    }
  }

  /**
   * Extend lock TTL (for long-running operations)
   */
  async extendLock(lockKey: string, additionalTtl: number): Promise<boolean> {
    try {
      const client = redisManager.getClient();
      const fullKey = `lock:${lockKey}`;
      const result = await client.expire(fullKey, additionalTtl / 1000);
      return result === 1;
    } catch (error: any) {
      logger.error('Error extending lock', { lockKey, error: error.message });
      return false;
    }
  }

  /**
   * Get remaining TTL for a lock (in milliseconds)
   */
  async getLockTTL(lockKey: string): Promise<number> {
    try {
      const client = redisManager.getClient();
      const fullKey = `lock:${lockKey}`;
      const ttl = await client.pttl(fullKey); // Returns TTL in milliseconds
      return ttl > 0 ? ttl : 0;
    } catch (error: any) {
      logger.error('Error getting lock TTL', { lockKey, error: error.message });
      return 0;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const redisLock = RedisLock.getInstance();

// ==================================================
// PREDEFINED LOCK KEY GENERATORS
// ==================================================

export const LockKeys = {
  // Tournament operations
  tournamentRegistration: (tournamentId: string) => 
    `tournament:${tournamentId}:registration`,
  
  tournamentStatusChange: (tournamentId: string) => 
    `tournament:${tournamentId}:status`,
  
  bracketGeneration: (tournamentId: string) => 
    `tournament:${tournamentId}:bracket`,
  
  tournamentCancellation: (tournamentId: string) => 
    `tournament:${tournamentId}:cancel`,

  // Registration operations
  userRegistration: (userId: string, tournamentId: string) => 
    `user:${userId}:tournament:${tournamentId}:register`,
  
  waitlistPromotion: (tournamentId: string) => 
    `tournament:${tournamentId}:waitlist`,

  // Match operations
  matchResultSubmission: (matchId: string) => 
    `match:${matchId}:result`,
  
  matchStatusChange: (matchId: string) => 
    `match:${matchId}:status`,
  
  matchProgression: (tournamentId: string, round: number) => 
    `tournament:${tournamentId}:round:${round}:progression`,

  // Check-in operations
  checkIn: (userId: string, tournamentId: string) => 
    `user:${userId}:tournament:${tournamentId}:checkin`,

  // Team operations
  teamInvite: (teamId: string, userId: string) => 
    `team:${teamId}:invite:${userId}`,
  
  teamRegistration: (teamId: string, tournamentId: string) => 
    `team:${teamId}:tournament:${tournamentId}:register`,
};