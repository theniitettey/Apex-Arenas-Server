import { Request, Response, NextFunction } from 'express';
import { redisManager } from '../../../configs/redis.config';
import { AuthError } from './auth.error.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-ratelimit-middleware');

export interface RateLimitOptions {
  window_seconds: number;
  max_requests: number;
  key_prefix?: string;
  skip_successful?: boolean;
  message?: string;
}

/**
 * Create a rate limit middleware with custom options
 */
export const createRateLimiter = (options: RateLimitOptions) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Build identifier from IP and optionally user ID
      const user_id = (req as any).user?.user_id;
      const identifier = user_id || req.ip || 'unknown';
      const key_prefix = options.key_prefix || 'api';

      const result = await redisManager.checkRateLimit(
        identifier,
        key_prefix as any,
        options.window_seconds,
        options.max_requests
      );

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', options.max_requests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', new Date(result.reset_time).toISOString());

      if (!result.allowed) {
        logger.warn('Rate limit exceeded', {
          identifier,
          key_prefix,
          path: req.path,
          ip: req.ip
        });

        res.setHeader('Retry-After', Math.ceil((result.reset_time - Date.now()) / 1000));

        throw new AuthError(
          options.message || 'Too many requests. Please try again later.',
          429,
          'RATE_LIMIT_EXCEEDED'
        );
      }

      next();
    } catch (error) {
      if (error instanceof AuthError) {
        return next(error);
      }
      // On Redis error, allow the request (fail open for availability)
      logger.error('Rate limiter error', { error });
      next();
    }
  };
};

/**
 * Pre-configured rate limiters for common use cases
 */

// Strict rate limiter for login attempts
export const loginRateLimiter = createRateLimiter({
  window_seconds: 900, // 15 minutes
  max_requests: 10,
  key_prefix: 'login',
  message: 'Too many login attempts. Please try again in 15 minutes.'
});

// Strict rate limiter for admin login
export const adminLoginRateLimiter = createRateLimiter({
  window_seconds: 900, // 15 minutes
  max_requests: 5,
  key_prefix: 'admin_login',
  message: 'Too many admin login attempts. Please try again later.'
});

// Rate limiter for registration
export const registrationRateLimiter = createRateLimiter({
  window_seconds: 3600, // 1 hour
  max_requests: 5,
  key_prefix: 'registration',
  message: 'Too many registration attempts. Please try again later.'
});

// Rate limiter for OTP requests
export const otpRateLimiter = createRateLimiter({
  window_seconds: 300, // 5 minutes
  max_requests: 3,
  key_prefix: 'otp_request',
  message: 'Too many OTP requests. Please wait before requesting another.'
});

// Rate limiter for password reset
export const passwordResetRateLimiter = createRateLimiter({
  window_seconds: 3600, // 1 hour
  max_requests: 3,
  key_prefix: 'password_reset',
  message: 'Too many password reset attempts. Please try again later.'
});

// General API rate limiter
export const apiRateLimiter = createRateLimiter({
  window_seconds: 60, // 1 minute
  max_requests: 100,
  key_prefix: 'api_call',
  message: 'Too many requests. Please slow down.'
});

// Strict rate limiter for admin actions
export const adminActionRateLimiter = createRateLimiter({
  window_seconds: 60, // 1 minute
  max_requests: 30,
  key_prefix: 'admin_action',
  message: 'Too many admin actions. Please slow down.'
});
