import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.jwt.middleware';
import { AuthError } from './auth.error.middleware';
import { AuditService } from '../services/auth.audit.service';
import { env } from '../../../configs/env.config';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-admin-middleware');

/**
 * Verify admin is in whitelist
 * Additional security layer beyond token verification
 */
export const verifyAdminWhitelist = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new AuthError('Authentication required', 401, 'AUTH_REQUIRED');
    }

    // Get whitelisted admin emails
    const admin_emails_raw = env.ADMIN_EMAILS || '';
    const allowed_emails = admin_emails_raw
      .split(',')
      .map((email: string) => email.trim().toLowerCase())
      .filter((email: string) => email.length > 0);

    if (allowed_emails.length === 0) {
      logger.error('No admin emails configured in ADMIN_EMAILS');
      throw new AuthError('Admin access not configured', 500, 'CONFIG_ERROR');
    }

    if (!allowed_emails.includes(req.user.email.toLowerCase())) {
      logger.warn('Admin not in whitelist', {
        user_id: req.user.user_id,
        email: req.user.email,
        path: req.path
      });

      await AuditService.logSuspiciousActivity(
        req.user.user_id,
        'Admin access attempt by non-whitelisted email',
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown',
          risk_factors: ['non_whitelisted_admin', 'unauthorized_access_attempt']
        }
      );

      throw new AuthError('Admin access denied', 403, 'ADMIN_NOT_WHITELISTED');
    }

    next();
  } catch (error) {
    if (error instanceof AuthError) {
      return next(error);
    }
    next(new AuthError('Admin verification failed', 500, 'ADMIN_VERIFY_FAILED'));
  }
};

/**
 * Log admin action for audit trail
 */
export const logAdminAction = (action_name: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Store original json method
    const original_json = res.json.bind(res);

    // Override json to log after response
    res.json = (body: any) => {
      // Log the admin action
      const log_data = {
        admin_id: req.user?.user_id,
        admin_email: req.user?.email,
        action: action_name,
        path: req.path,
        method: req.method,
        params: req.params,
        query: req.query,
        success: body?.success ?? true,
        ip_address: req.ip,
        user_agent: req.get('user-agent'),
        timestamp: new Date()
      };

      logger.info('Admin action performed', log_data);

      return original_json(body);
    };

    next();
  };
};

/**
 * Restrict sensitive admin actions to specific admin emails (super admin)
 */
export const requireSuperAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new AuthError('Authentication required', 401, 'AUTH_REQUIRED');
    }

    // Get super admin emails (first email in the list is typically super admin)
    const admin_emails_raw = env.ADMIN_EMAILS || '';
    const allowed_emails = admin_emails_raw
      .split(',')
      .map((email: string) => email.trim().toLowerCase())
      .filter((email: string) => email.length > 0);

    // First admin in the list is super admin
    const super_admin_email = allowed_emails[0];

    if (!super_admin_email || req.user.email.toLowerCase() !== super_admin_email) {
      logger.warn('Super admin action attempted by non-super admin', {
        user_id: req.user.user_id,
        email: req.user.email,
        path: req.path
      });
      throw new AuthError('Super admin access required', 403, 'SUPER_ADMIN_REQUIRED');
    }

    next();
  } catch (error) {
    if (error instanceof AuthError) {
      return next(error);
    }
    next(new AuthError('Super admin verification failed', 500, 'SUPER_ADMIN_VERIFY_FAILED'));
  }
};

/**
 * Prevent admin from performing certain actions on themselves
 */
export const preventSelfAction = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new AuthError('Authentication required', 401, 'AUTH_REQUIRED');
    }

    const target_user_id = req.params.userId || req.params.adminId || req.body.user_id;

    if (target_user_id && target_user_id === req.user.user_id) {
      logger.warn('Admin attempted self-action', {
        admin_id: req.user.user_id,
        action: req.path,
        method: req.method
      });
      throw new AuthError('Cannot perform this action on yourself', 400, 'SELF_ACTION_NOT_ALLOWED');
    }

    next();
  } catch (error) {
    if (error instanceof AuthError) {
      return next(error);
    }
    next(new AuthError('Self-action check failed', 500, 'SELF_ACTION_CHECK_FAILED'));
  }
};