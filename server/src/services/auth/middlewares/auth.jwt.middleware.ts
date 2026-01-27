import { Request, Response, NextFunction } from 'express';
import { tokenService } from '../services/auth.token.service';
import { redisManager } from '../../../configs/redis.config';
import { User, UserSecurity } from '../../../models/user.model';
import { AuthError } from './auth.error.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-jwt-middleware');

/**
 * Extended Request interface with user data
 */
export interface AuthRequest extends Request {
  user?: {
    user_id: string;
    email: string;
    role: 'player' | 'organizer' | 'admin';
  };
}

/**
 * Extract bearer token from authorization header
 */
const extractBearerToken = (req: Request): string | null => {
  const auth_header = req.headers.authorization;
  if (!auth_header || !auth_header.startsWith('Bearer ')) {
    return null;
  }
  return auth_header.substring(7);
};

/**
 * User JWT middleware - for players and organizers
 * Verifies access token signed with user secret
 */
export const userAuthMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      logger.warn('Missing authorization token', {
        path: req.path,
        ip: req.ip
      });
      throw new AuthError('Access token required', 401, 'MISSING_TOKEN');
    }

    // Check if token is blacklisted
    const token_hash = require('crypto').createHash('sha256').update(token).digest('hex');
    const is_blacklisted = await redisManager.isTokenBlacklisted(token_hash);
    if (is_blacklisted) {
      logger.warn('Blacklisted token used', { path: req.path, ip: req.ip });
      throw new AuthError('Token has been revoked', 401, 'TOKEN_REVOKED');
    }

    // Verify token
    const verification = await tokenService.verifyUserAccessToken(token);

    if (!verification.valid || !verification.payload) {
      logger.warn('Invalid user token', {
        path: req.path,
        ip: req.ip,
        error: verification.error
      });
      throw new AuthError(
        verification.error === 'TOKEN_EXPIRED' ? 'Access token expired' : 'Invalid access token',
        401,
        verification.error || 'INVALID_TOKEN'
      );
    }

    // Check if user is still active and not banned
    const user = await User.findById(verification.payload.user_id).select('is_active is_banned');
    if (!user || !user.is_active) {
      throw new AuthError('Account is inactive', 401, 'ACCOUNT_INACTIVE');
    }
    if (user.is_banned) {
      throw new AuthError('Account is banned', 403, 'ACCOUNT_BANNED');
    }

    // Check if password change is required
    const security = await UserSecurity.findOne({ user_id: verification.payload.user_id });
    if (security?.password.change_required) {
      throw new AuthError('Password change required', 403, 'PASSWORD_CHANGE_REQUIRED');
    }

    // Attach user to request
    req.user = {
      user_id: verification.payload.user_id,
      email: verification.payload.email,
      role: verification.payload.role
    };

    logger.debug('User authenticated', {
      user_id: verification.payload.user_id,
      role: verification.payload.role,
      path: req.path
    });

    next();
  } catch (error) {
    if (error instanceof AuthError) {
      return next(error);
    }
    logger.error('User auth middleware error', { error });
    next(new AuthError('Authentication failed', 401, 'AUTH_FAILED'));
  }
};

/**
 * Admin JWT middleware - for admin users only
 * Verifies access token signed with admin secret
 */
export const adminAuthMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      logger.warn('Missing admin authorization token', {
        path: req.path,
        ip: req.ip
      });
      throw new AuthError('Admin access token required', 401, 'MISSING_TOKEN');
    }

    // Check if token is blacklisted
    const token_hash = require('crypto').createHash('sha256').update(token).digest('hex');
    const is_blacklisted = await redisManager.isTokenBlacklisted(token_hash);
    if (is_blacklisted) {
      logger.warn('Blacklisted admin token used', { path: req.path, ip: req.ip });
      throw new AuthError('Token has been revoked', 401, 'TOKEN_REVOKED');
    }

    // Verify admin token (uses different secret)
    const verification = await tokenService.verifyAdminAccessToken(token);

    if (!verification.valid || !verification.payload) {
      logger.warn('Invalid admin token', {
        path: req.path,
        ip: req.ip,
        error: verification.error
      });
      throw new AuthError(
        verification.error === 'TOKEN_EXPIRED' ? 'Admin access token expired' : 'Invalid admin access token',
        401,
        verification.error || 'INVALID_TOKEN'
      );
    }

    // Verify role is admin
    if (verification.payload.role !== 'admin') {
      logger.warn('Non-admin token on admin route', {
        user_id: verification.payload.user_id,
        role: verification.payload.role,
        path: req.path
      });
      throw new AuthError('Admin access required', 403, 'ADMIN_REQUIRED');
    }

    // Check if admin is still active
    const admin = await User.findById(verification.payload.user_id).select('is_active role');
    if (!admin || !admin.is_active || admin.role !== 'admin') {
      throw new AuthError('Admin account is inactive or invalid', 401, 'ADMIN_INACTIVE');
    }

    // Attach user to request
    req.user = {
      user_id: verification.payload.user_id,
      email: verification.payload.email,
      role: verification.payload.role
    };

    logger.debug('Admin authenticated', {
      user_id: verification.payload.user_id,
      path: req.path
    });

    next();
  } catch (error) {
    if (error instanceof AuthError) {
      return next(error);
    }
    logger.error('Admin auth middleware error', { error });
    next(new AuthError('Admin authentication failed', 401, 'ADMIN_AUTH_FAILED'));
  }
};

/**
 * Optional JWT middleware - attaches user if token is valid, continues if not
 */
export const optionalAuthMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      req.user = undefined;
      return next();
    }

    const verification = await tokenService.verifyUserAccessToken(token);

    if (verification.valid && verification.payload) {
      req.user = {
        user_id: verification.payload.user_id,
        email: verification.payload.email,
        role: verification.payload.role
      };
    } else {
      req.user = undefined;
    }

    next();
  } catch (error) {
    // Silently fail for optional auth
    req.user = undefined;
    next();
  }
};

/**
 * Role-based access middleware
 * Must be used after userAuthMiddleware or adminAuthMiddleware
 */
export const requireRole = (...allowed_roles: ('player' | 'organizer' | 'admin')[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AuthError('Authentication required', 401, 'AUTH_REQUIRED'));
    }

    if (!allowed_roles.includes(req.user.role)) {
      logger.warn('Insufficient role', {
        user_id: req.user.user_id,
        user_role: req.user.role,
        required_roles: allowed_roles,
        path: req.path
      });
      return next(new AuthError('Insufficient permissions', 403, 'INSUFFICIENT_ROLE'));
    }

    next();
  };
};
