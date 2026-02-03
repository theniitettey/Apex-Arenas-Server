import { Request, Response } from 'express';
import { adminService } from '../services/auth.admin.service';
import { userService } from '../services/auth.user.service';
import { createLogger } from '../../../shared/utils/logger.utils';
import { sendSuccess, sendError, sendCreated, sendNotFound } from '../../../shared/utils/response.utils';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes';
import { extractDeviceContext, getAuditMetadata } from '../../../shared/utils/request.utils';

const logger = createLogger('auth-admin-controller');

export class AdminController {

  async listUsers(req: Request, res: Response) {
    try {
      const {
        role,
        is_active,
        is_banned,
        email_verified,
        search,
        page,
        limit,
        sort_by,
        sort_order
      } = req.query;

      const result = await adminService.listUsers({
        role: role as 'player' | 'organizer' | 'admin',
        is_active: is_active !== undefined ? is_active === 'true' : undefined,
        is_banned: is_banned !== undefined ? is_banned === 'true' : undefined,
        email_verified: email_verified !== undefined ? email_verified === 'true' : undefined,
        search: search as string,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        sort_by: sort_by as string,
        sort_order: sort_order as 'asc' | 'desc'
      });

      return sendSuccess(res, result);
    } catch (error: any) {
      logger.error('List users error:', error);
      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }

  async getUserDetails(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const result = await adminService.getUserDetails(userId);
      return sendSuccess(res, result);
    } catch (error: any) {
      logger.error('Get user details error:', error);

      if (error.message === AUTH_ERROR_CODES.USER_NOT_FOUND) {
        return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }

  async banUser(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { reason, banned_until } = req.body;
      const admin_id = (req as any).user?.user_id;

      if (!reason) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Ban reason is required');
      }

      const result = await adminService.banUser({
        user_id: userId,
        reason,
        banned_until: banned_until ? new Date(banned_until) : undefined,
        admin_id,
        device_context: getAuditMetadata(req)
      });

      if (!result.success) {
        if (result.error === AUTH_ERROR_CODES.USER_NOT_FOUND) {
          return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
        }
        return sendError(res, result.error || AUTH_ERROR_CODES.INTERNAL_ERROR);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Ban user error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async unbanUser(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.unbanUser(
        userId,
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        if (result.error === AUTH_ERROR_CODES.USER_NOT_FOUND) {
          return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
        }
        if (result.error === AUTH_ERROR_CODES.USER_NOT_BANNED) {
          return sendError(res, AUTH_ERROR_CODES.USER_NOT_BANNED);
        }
        return sendError(res, result.error || AUTH_ERROR_CODES.INTERNAL_ERROR);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Unban user error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async deactivateUser(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { reason } = req.body;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.deactivateUser(
        userId,
        reason || 'Deactivated by admin',
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        if (result.error === AUTH_ERROR_CODES.USER_NOT_FOUND) {
          return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
        }
        if (result.error === AUTH_ERROR_CODES.CANNOT_DEACTIVATE_ADMIN) {
          return sendError(res, AUTH_ERROR_CODES.CANNOT_DEACTIVATE_ADMIN);
        }
        return sendError(res, result.error || AUTH_ERROR_CODES.INTERNAL_ERROR);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Deactivate user error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async reactivateUser(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.reactivateUser(
        userId,
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        if (result.error === AUTH_ERROR_CODES.USER_NOT_FOUND) {
          return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
        }
        if (result.error === AUTH_ERROR_CODES.USER_ALREADY_ACTIVE) {
          return sendError(res, AUTH_ERROR_CODES.USER_ALREADY_ACTIVE);
        }
        return sendError(res, result.error || AUTH_ERROR_CODES.INTERNAL_ERROR);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Reactivate user error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async changeUserRole(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { role } = req.body;
      const admin_id = (req as any).user?.user_id;

      if (!role || !['player', 'organizer'].includes(role)) {
        return sendError(res, AUTH_ERROR_CODES.INVALID_ROLE);
      }

      const result = await adminService.changeUserRole(
        userId,
        role,
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        if (result.error === AUTH_ERROR_CODES.USER_NOT_FOUND) {
          return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
        }
        if (result.error === AUTH_ERROR_CODES.CANNOT_CHANGE_ADMIN_ROLE) {
          return sendError(res, AUTH_ERROR_CODES.CANNOT_CHANGE_ADMIN_ROLE);
        }
        return sendError(res, result.error || AUTH_ERROR_CODES.INTERNAL_ERROR);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Change user role error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async verifyOrganizer(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.verifyOrganizer(
        userId,
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        if (result.error === AUTH_ERROR_CODES.USER_NOT_FOUND) {
          return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
        }
        if (result.error === AUTH_ERROR_CODES.USER_NOT_ORGANIZER) {
          return sendError(res, AUTH_ERROR_CODES.USER_NOT_ORGANIZER);
        }
        return sendError(res, result.error || AUTH_ERROR_CODES.INTERNAL_ERROR);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Verify organizer error:', error);
      return sendError(res, AUTH_ERROR_CODES.VERIFICATION_FAILED);
    }
  }

  async forceVerifyEmail(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.forceVerifyEmail(
        userId,
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        if (result.error === AUTH_ERROR_CODES.USER_NOT_FOUND) {
          return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
        }
        return sendError(res, result.error || AUTH_ERROR_CODES.INTERNAL_ERROR);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Force verify email error:', error);
      return sendError(res, AUTH_ERROR_CODES.VERIFICATION_FAILED);
    }
  }

  async forceLogoutUser(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { reason } = req.body;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.forceLogoutUser(
        userId,
        reason || 'Admin action',
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Force logout error:', error);
      return sendError(res, AUTH_ERROR_CODES.LOGOUT_FAILED);
    }
  }

  async getUserSessions(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const sessions = await adminService.getUserSessions(userId);

      return sendSuccess(res, {
        sessions,
        count: sessions.length
      });
    } catch (error: any) {
      logger.error('Get user sessions error:', error);
      return sendError(res, AUTH_ERROR_CODES.SESSION_INFO_FETCH_FAILED);
    }
  }

  async revokeUserSession(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const sessionId = req.params.sessionId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.revokeUserSession(
        userId,
        sessionId,
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        return sendNotFound(res, AUTH_ERROR_CODES.SESSION_NOT_FOUND);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Revoke session error:', error);
      return sendError(res, AUTH_ERROR_CODES.SESSION_REVOKE_FAILED);
    }
  }

  async unlockAccount(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.unlockAccount(
        userId,
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        if (result.error === AUTH_ERROR_CODES.USER_NOT_FOUND) {
          return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
        }
        if (result.error === AUTH_ERROR_CODES.ACCOUNT_NOT_LOCKED) {
          return sendError(res, AUTH_ERROR_CODES.ACCOUNT_NOT_LOCKED);
        }
        return sendError(res, result.error || AUTH_ERROR_CODES.INTERNAL_ERROR);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Unlock account error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async forcePasswordReset(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { reason } = req.body;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.forcePasswordReset(
        userId,
        reason || 'Admin requested password reset',
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Force password reset error:', error);
      return sendError(res, AUTH_ERROR_CODES.PASSWORD_RESET_FAILED);
    }
  }

  async getUserAuditTrail(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { limit } = req.query;

      const logs = await adminService.getUserAuditTrail(
        userId,
        limit ? parseInt(limit as string) : 100
      );

      return sendSuccess(res, {
        logs,
        count: logs.length
      });
    } catch (error: any) {
      logger.error('Get user audit trail error:', error);
      return sendError(res, AUTH_ERROR_CODES.AUDIT_TRAIL_FETCH_FAILED);
    }
  }

  async searchAuditLogs(req: Request, res: Response) {
    try {
      const {
        user_id,
        event_type,
        success,
        start_date,
        end_date,
        ip_address,
        is_suspicious,
        limit
      } = req.query;

      const logs = await adminService.searchAuditLogs({
        user_id: user_id as string,
        event_type: event_type as string,
        success: success !== undefined ? success === 'true' : undefined,
        start_date: start_date ? new Date(start_date as string) : undefined,
        end_date: end_date ? new Date(end_date as string) : undefined,
        ip_address: ip_address as string,
        is_suspicious: is_suspicious !== undefined ? is_suspicious === 'true' : undefined,
        limit: limit ? parseInt(limit as string) : undefined
      });

      return sendSuccess(res, {
        logs,
        count: logs.length
      });
    } catch (error: any) {
      logger.error('Search audit logs error:', error);
      return sendError(res, AUTH_ERROR_CODES.AUDIT_SEARCH_FAILED);
    }
  }

  async getSystemStats(req: Request, res: Response) {
    try {
      const { timeframe } = req.query;

      const stats = await adminService.getSystemStats(
        (timeframe as '24h' | '7d' | '30d') || '24h'
      );

      return sendSuccess(res, stats);
    } catch (error: any) {
      logger.error('Get system stats error:', error);
      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }

  async getSuspiciousActivity(req: Request, res: Response) {
    try {
      const { hours } = req.query;

      const summary = await adminService.getSuspiciousActivity(
        hours ? parseInt(hours as string) : 24
      );

      return sendSuccess(res, summary);
    } catch (error: any) {
      logger.error('Get suspicious activity error:', error);
      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }

  async listAdmins(req: Request, res: Response) {
    try {
      const admins = await adminService.listAdmins();

      return sendSuccess(res, {
        admins,
        count: admins.length
      });
    } catch (error: any) {
      logger.error('List admins error:', error);
      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }

  async setupAdmin(req: Request, res: Response) {
    try {
      const { email, password, first_name, last_name, username } = req.body;

      if (!email || !password || !first_name || !last_name || !username) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS);
      }

      if (!adminService.isAdminEmail(email)) {
        return sendError(res, AUTH_ERROR_CODES.ADMIN_NOT_WHITELISTED);
      }

      const admin = await userService.setupAdminAccount(
        email,
        password,
        { first_name, last_name, username },
        getAuditMetadata(req)
      );

      return sendCreated(res, {
        user_id: admin._id,
        email: admin.email,
        username: admin.username
      }, 'Admin account created successfully');
    } catch (error: any) {
      logger.error('Setup admin error:', {
        message: error.message, 
        stack: error.stack,
        name: error.name 
      });

      if (error.message === AUTH_ERROR_CODES.ADMIN_ALREADY_EXISTS) {
        return sendError(res, AUTH_ERROR_CODES.ADMIN_ALREADY_EXISTS);
      }

      if (error.message === AUTH_ERROR_CODES.ADMIN_PASSWORD_TOO_WEAK) {
        return sendError(res, AUTH_ERROR_CODES.ADMIN_PASSWORD_TOO_WEAK);
      }

      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async forceAdmin2FASetup(req: Request, res: Response) {
    try {
      const adminId = req.params.adminId as string;
      const requesting_admin_id = (req as any).user?.user_id;

      const result = await adminService.forceAdmin2FASetup(
        adminId,
        requesting_admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        return sendNotFound(res, AUTH_ERROR_CODES.ADMIN_NOT_FOUND);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Force admin 2FA error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  // ============================================
  // ORGANIZER VERIFICATION MANAGEMENT
  // ============================================

  async listVerificationRequests(req: Request, res: Response) {
    try {
      const { status, page, limit, sort_order } = req.query;

      const result = await adminService.listVerificationRequests({
        status: status as any,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        sort_order: sort_order as 'asc' | 'desc'
      });

      return sendSuccess(res, result);
    } catch (error: any) {
      logger.error('List verification requests error:', error);
      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }

  async getVerificationRequestDetails(req: Request, res: Response) {
    try {
      const requestId = req.params.requestId as string;
      const request = await adminService.getVerificationRequestDetails(requestId);

      return sendSuccess(res, request);
    } catch (error: any) {
      logger.error('Get verification request details error:', error);

      if (error.message === 'VERIFICATION_REQUEST_NOT_FOUND') {
        return sendNotFound(res, 'VERIFICATION_REQUEST_NOT_FOUND');
      }

      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }

  async reviewVerificationRequest(req: Request, res: Response) {
    try {
      const requestId = req.params.requestId as string;
      const { action, admin_notes, rejection_reasons } = req.body;
      const admin_id = (req as any).user?.user_id;

      if (!action || !['approve', 'reject', 'request_resubmission'].includes(action)) {
        return sendError(res, AUTH_ERROR_CODES.VALIDATION_ERROR, undefined, 'Invalid action. Must be: approve, reject, or request_resubmission');
      }

      if (action !== 'approve' && (!rejection_reasons || !Array.isArray(rejection_reasons) || rejection_reasons.length === 0)) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Rejection reasons are required for reject/resubmission');
      }

      const result = await adminService.reviewVerificationRequest({
        request_id: requestId,
        action,
        admin_id,
        admin_notes,
        rejection_reasons,
        device_context: getAuditMetadata(req)
      });

      if (!result.success) {
        if (result.error === 'VERIFICATION_REQUEST_NOT_FOUND') {
          return sendNotFound(res, 'VERIFICATION_REQUEST_NOT_FOUND');
        }
        return sendError(res, result.error || AUTH_ERROR_CODES.INTERNAL_ERROR);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Review verification request error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async markVerificationUnderReview(req: Request, res: Response) {
    try {
      const requestId = req.params.requestId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.markVerificationUnderReview(
        requestId,
        admin_id,
        getAuditMetadata(req)
      );

      if (!result.success) {
        if (result.error === 'VERIFICATION_REQUEST_NOT_FOUND') {
          return sendNotFound(res, 'VERIFICATION_REQUEST_NOT_FOUND');
        }
        return sendError(res, result.error || AUTH_ERROR_CODES.INTERNAL_ERROR);
      }

      return sendSuccess(res, undefined, result.message);
    } catch (error: any) {
      logger.error('Mark verification under review error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }
}

export const adminController = new AdminController();