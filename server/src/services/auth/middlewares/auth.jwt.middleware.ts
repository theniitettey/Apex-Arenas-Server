import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { tokenService } from '../services/auth.token.service';
import { redisManager } from '../../../configs/redis.config';
import { AuditService } from '../services/auth.audit.service';
import { User, UserSecurity } from '../../../models/user.model';
import { AuthError } from './auth.error.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes';
import { extractDeviceContext } from '../../../shared/utils/request.utils';

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
 * Check and block suspicious IPs
 * Returns true if IP should be blocked
 */
const checkAndBlockSuspiciousIP = async (
  ip_address: string,
  user_agent: string
): Promise<{ blocked: boolean; reason?: string }> => {
  try {
    // Check if IP is already blocked in Redis
    const is_blocked = await redisManager.isIPBlocked(ip_address);
    if (is_blocked) {
      logger.warn('Blocked IP attempted access', { ip_address });
      return { blocked: true, reason: AUTH_ERROR_CODES.IP_BLOCKED };
    }

    // Check if IP has suspicious activity in audit logs
    const is_suspicious = await AuditService.isIPSuspicious(ip_address, 24);
    if (is_suspicious) {
      // Block the IP for 1 hour
      await redisManager.blockIP(ip_address, 3600);
      
      logger.warn('Blocking suspicious IP', { ip_address });
      
      await AuditService.logAuthEvent({
        event_type: 'suspicious_activity',
        success: false,
        metadata: {
          ip_address,
          user_agent,
          failure_reason: AUTH_ERROR_CODES.IP_BLOCKED,
          is_suspicious: true,
          risk_factors: ['suspicious_ip_blocked']
        }
      });

      return { blocked: true, reason: AUTH_ERROR_CODES.IP_BLOCKED };
    }

    return { blocked: false };
  } catch (error:any) {
    logger.error('Error checking suspicious IP:', error);
    // Fail open - don't block on error
    return { blocked: false };
  }
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
    const device_context = extractDeviceContext(req);

    // CHECK FOR SUSPICIOUS IP AND BLOCK
    const ip_check = await checkAndBlockSuspiciousIP(device_context.ip_address, device_context.user_agent);
    if (ip_check.blocked) {
      throw new AuthError(ip_check.reason || AUTH_ERROR_CODES.IP_BLOCKED, 403, AUTH_ERROR_CODES.IP_BLOCKED);
    }

    const token = extractBearerToken(req);

    if (!token) {
      logger.warn('Missing authorization token', {
        path: req.path,
        ip: req.ip
      });
      throw new AuthError(AUTH_ERROR_CODES.MISSING_TOKEN, 401, AUTH_ERROR_CODES.MISSING_TOKEN);
    }

    // Check if token is blacklisted
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');
    const is_blacklisted = await redisManager.isTokenBlacklisted(token_hash);
    if (is_blacklisted) {
      logger.warn('Blacklisted token used', { path: req.path, ip: req.ip });
      throw new AuthError(AUTH_ERROR_CODES.TOKEN_REVOKED, 401, AUTH_ERROR_CODES.TOKEN_REVOKED);
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
        verification.error === AUTH_ERROR_CODES.TOKEN_EXPIRED
          ? AUTH_ERROR_CODES.TOKEN_EXPIRED
          : AUTH_ERROR_CODES.INVALID_TOKEN,
        401,
        verification.error || AUTH_ERROR_CODES.INVALID_TOKEN
      );
    }

    // Check if user is still active and not banned
    const user = await User.findById(verification.payload.user_id).select('is_active is_banned');
    if (!user || !user.is_active) {
      throw new AuthError(AUTH_ERROR_CODES.ACCOUNT_INACTIVE, 401, AUTH_ERROR_CODES.ACCOUNT_INACTIVE);
    }
    if (user.is_banned) {
      throw new AuthError(AUTH_ERROR_CODES.ACCOUNT_BANNED, 403, AUTH_ERROR_CODES.ACCOUNT_BANNED);
    }

    // Check if password change is required
    const security = await UserSecurity.findOne({ user_id: verification.payload.user_id });
    if (security?.password.change_required) {
      throw new AuthError(AUTH_ERROR_CODES.PASSWORD_CHANGE_REQUIRED, 403, AUTH_ERROR_CODES.PASSWORD_CHANGE_REQUIRED);
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
    next(new AuthError(AUTH_ERROR_CODES.AUTH_FAILED, 401, AUTH_ERROR_CODES.AUTH_FAILED));
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
    const device_context = extractDeviceContext(req);

    // CHECK FOR SUSPICIOUS IP AND BLOCK (stricter for admin)
    const ip_check = await checkAndBlockSuspiciousIP(device_context.ip_address, device_context.user_agent);
    if (ip_check.blocked) {
      throw new AuthError(ip_check.reason || AUTH_ERROR_CODES.IP_BLOCKED, 403, AUTH_ERROR_CODES.IP_BLOCKED);
    }

    const token = extractBearerToken(req);

    if (!token) {
      logger.warn('Missing admin authorization token', {
        path: req.path,
        ip: req.ip
      });
      throw new AuthError(AUTH_ERROR_CODES.MISSING_TOKEN, 401, AUTH_ERROR_CODES.MISSING_TOKEN);
    }

    // Check if token is blacklisted
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');
    const is_blacklisted = await redisManager.isTokenBlacklisted(token_hash);
    if (is_blacklisted) {
      logger.warn('Blacklisted admin token used', { path: req.path, ip: req.ip });
      throw new AuthError(AUTH_ERROR_CODES.TOKEN_REVOKED, 401, AUTH_ERROR_CODES.TOKEN_REVOKED);
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
        verification.error === AUTH_ERROR_CODES.TOKEN_EXPIRED
          ? AUTH_ERROR_CODES.TOKEN_EXPIRED
          : AUTH_ERROR_CODES.INVALID_TOKEN,
        401,
        verification.error || AUTH_ERROR_CODES.INVALID_TOKEN
      );
    }

    // Verify role is admin
    if (verification.payload.role !== 'admin') {
      logger.warn('Non-admin token on admin route', {
        user_id: verification.payload.user_id,
        role: verification.payload.role,
        path: req.path
      });
      throw new AuthError(AUTH_ERROR_CODES.ADMIN_REQUIRED, 403, AUTH_ERROR_CODES.ADMIN_REQUIRED);
    }

    // Check if admin is still active
    const admin = await User.findById(verification.payload.user_id).select('is_active role');
    if (!admin || !admin.is_active || admin.role !== 'admin') {
      throw new AuthError(AUTH_ERROR_CODES.ADMIN_INACTIVE, 401, AUTH_ERROR_CODES.ADMIN_INACTIVE);
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
    next(new AuthError(AUTH_ERROR_CODES.AUTH_FAILED, 401, AUTH_ERROR_CODES.AUTH_FAILED));
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
      return next(new AuthError(AUTH_ERROR_CODES.AUTH_REQUIRED, 401, AUTH_ERROR_CODES.AUTH_REQUIRED));
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
