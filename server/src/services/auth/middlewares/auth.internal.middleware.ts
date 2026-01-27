import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthError } from './auth.error.middleware';
import { env } from '../../../configs/env.config';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-internal-middleware');

/**
 * Extended Request interface for internal service requests
 */
export interface InternalRequest extends Request {
  service_context?: {
    service_name: string;
    admin_id?: string;
  };
}

/**
 * Internal service authentication middleware
 * Used for service-to-service communication
 */
export const internalAuthMiddleware = (
  req: InternalRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const service_token = req.headers['x-service-token'] as string;
    const service_name = req.headers['x-service-name'] as string;

    if (!service_token) {
      logger.warn('Missing service token for internal request', {
        path: req.path,
        ip: req.ip
      });
      throw new AuthError('Service token required', 401, 'MISSING_SERVICE_TOKEN');
    }

    const expected_token = env.INTERNAL_SERVICE_SECRET;

    if (!expected_token) {
      logger.error('INTERNAL_SERVICE_SECRET not configured');
      throw new AuthError('Internal authentication not configured', 500, 'CONFIG_ERROR');
    }

    // Timing-safe comparison to prevent timing attacks
    try {
      const token_buffer = Buffer.from(service_token);
      const expected_buffer = Buffer.from(expected_token);

      if (token_buffer.length !== expected_buffer.length ||
          !crypto.timingSafeEqual(token_buffer, expected_buffer)) {
        throw new Error('Token mismatch');
      }
    } catch (error) {
      logger.error('Invalid service token attempt', {
        path: req.path,
        ip: req.ip,
        user_agent: req.headers['user-agent'],
        service_name
      });
      throw new AuthError('Invalid service token', 401, 'INVALID_SERVICE_TOKEN');
    }

    // Attach service context to request
    req.service_context = {
      service_name: service_name || 'unknown'
    };

    // If admin_id is passed, attach it
    const admin_id = req.headers['x-admin-id'] as string;
    if (admin_id) {
      req.service_context.admin_id = admin_id;
    }

    logger.debug('Internal service authenticated', {
      path: req.path,
      service_name: req.service_context.service_name
    });

    next();
  } catch (error) {
    if (error instanceof AuthError) {
      return next(error);
    }
    next(new AuthError('Internal authentication failed', 401, 'INTERNAL_AUTH_FAILED'));
  }
};

/**
 * Combined middleware: Allow either admin JWT OR internal service token
 * Useful for endpoints that can be accessed by admins or other services
 */
export const adminOrInternalMiddleware = async (
  req: InternalRequest,
  res: Response,
  next: NextFunction
) => {
  // Check for internal service token first
  const service_token = req.headers['x-service-token'] as string;
  
  if (service_token) {
    // Use internal auth
    return internalAuthMiddleware(req, res, next);
  }

  // Fall back to admin auth
  const { adminAuthMiddleware } = require('./auth.jwt.middleware');
  return adminAuthMiddleware(req, res, next);
};
