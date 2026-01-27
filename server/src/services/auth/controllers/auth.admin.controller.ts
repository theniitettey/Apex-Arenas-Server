import { Request, Response } from 'express';
import { adminService } from '../services/auth.admin.service';
import { userService } from '../services/auth.user.service';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-admin-controller');

/**
 * Admin Controller for Auth Service
 * Handles user management, security operations, and system statistics
 */

export class AdminController {

  // ============================================
  // USER LISTING & SEARCH
  // ============================================

  /**
   * GET /admin/users
   * List users with filters and pagination
   */
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

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      logger.error('List users error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list users',
        error_code: error.message
      });
    }
  }

  /**
   * GET /admin/users/:userId
   * Get detailed user information
   */
  async getUserDetails(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;

      const result = await adminService.getUserDetails(userId);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      logger.error('Get user details error:', error);

      if (error.message === 'USER_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          error_code: 'USER_NOT_FOUND'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to get user details',
        error_code: error.message
      });
    }
  }

  // ============================================
  // USER BAN/UNBAN
  // ============================================

  /**
   * POST /admin/users/:userId/ban
   * Ban a user account
   */
  async banUser(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { reason, banned_until } = req.body;
      const admin_id = (req as any).user?.user_id;

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: 'Ban reason is required',
          error_code: 'REASON_REQUIRED'
        });
      }

      const result = await adminService.banUser({
        user_id: userId,
        reason,
        banned_until: banned_until ? new Date(banned_until) : undefined,
        admin_id,
        device_context: {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      });

      if (!result.success) {
        const status = result.error === 'USER_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Ban user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to ban user',
        error_code: 'BAN_FAILED'
      });
    }
  }

  /**
   * POST /admin/users/:userId/unban
   * Unban a user account
   */
  async unbanUser(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.unbanUser(
        userId,
        admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        const status = result.error === 'USER_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Unban user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to unban user',
        error_code: 'UNBAN_FAILED'
      });
    }
  }

  // ============================================
  // ACCOUNT ACTIVATION
  // ============================================

  /**
   * POST /admin/users/:userId/deactivate
   * Deactivate user account
   */
  async deactivateUser(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { reason } = req.body;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.deactivateUser(
        userId,
        reason || 'Deactivated by admin',
        admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        const status = result.error === 'USER_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Deactivate user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to deactivate user',
        error_code: 'DEACTIVATION_FAILED'
      });
    }
  }

  /**
   * POST /admin/users/:userId/reactivate
   * Reactivate user account
   */
  async reactivateUser(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.reactivateUser(
        userId,
        admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        const status = result.error === 'USER_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Reactivate user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reactivate user',
        error_code: 'REACTIVATION_FAILED'
      });
    }
  }

  // ============================================
  // ROLE MANAGEMENT
  // ============================================

  /**
   * PUT /admin/users/:userId/role
   * Change user role
   */
  async changeUserRole(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { role } = req.body;
      const admin_id = (req as any).user?.user_id;

      if (!role || !['player', 'organizer'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Valid role (player or organizer) is required',
          error_code: 'INVALID_ROLE'
        });
      }

      const result = await adminService.changeUserRole(
        userId,
        role,
        admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        const status = result.error === 'USER_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Change user role error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to change user role',
        error_code: 'ROLE_CHANGE_FAILED'
      });
    }
  }

  /**
   * POST /admin/users/:userId/verify-organizer
   * Verify organizer status
   */
  async verifyOrganizer(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.verifyOrganizer(
        userId,
        admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        const status = result.error === 'USER_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Verify organizer error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify organizer',
        error_code: 'VERIFICATION_FAILED'
      });
    }
  }

  /**
   * POST /admin/users/:userId/verify-email
   * Force verify user email
   */
  async forceVerifyEmail(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.forceVerifyEmail(
        userId,
        admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        const status = result.error === 'USER_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Force verify email error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify email',
        error_code: 'VERIFICATION_FAILED'
      });
    }
  }

  // ============================================
  // SECURITY OPERATIONS
  // ============================================

  /**
   * POST /admin/users/:userId/force-logout
   * Force logout user from all devices
   */
  async forceLogoutUser(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { reason } = req.body;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.forceLogoutUser(
        userId,
        reason || 'Admin action',
        admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        return res.status(404).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Force logout error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to logout user',
        error_code: 'FORCE_LOGOUT_FAILED'
      });
    }
  }

  /**
   * GET /admin/users/:userId/sessions
   * Get user's active sessions
   */
  async getUserSessions(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;

      const sessions = await adminService.getUserSessions(userId);

      res.json({
        success: true,
        data: {
          sessions,
          count: sessions.length
        }
      });
    } catch (error: any) {
      logger.error('Get user sessions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get sessions',
        error_code: 'SESSIONS_FETCH_FAILED'
      });
    }
  }

  /**
   * DELETE /admin/users/:userId/sessions/:sessionId
   * Revoke specific session
   */
  async revokeUserSession(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const sessionId = req.params.sessionId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.revokeUserSession(
        userId,
        sessionId,
        admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        return res.status(404).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Revoke session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke session',
        error_code: 'SESSION_REVOKE_FAILED'
      });
    }
  }

  /**
   * POST /admin/users/:userId/unlock
   * Unlock locked account
   */
  async unlockAccount(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.unlockAccount(
        userId,
        admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        const status = result.error === 'USER_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Unlock account error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to unlock account',
        error_code: 'UNLOCK_FAILED'
      });
    }
  }

  /**
   * POST /admin/users/:userId/force-password-reset
   * Force password reset on next login
   */
  async forcePasswordReset(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { reason } = req.body;
      const admin_id = (req as any).user?.user_id;

      const result = await adminService.forcePasswordReset(
        userId,
        reason || 'Admin requested password reset',
        admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        return res.status(404).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Force password reset error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to force password reset',
        error_code: 'FORCE_RESET_FAILED'
      });
    }
  }

  // ============================================
  // AUDIT & REPORTING
  // ============================================

  /**
   * GET /admin/users/:userId/audit
   * Get user's audit trail
   */
  async getUserAuditTrail(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;
      const { limit } = req.query;

      const logs = await adminService.getUserAuditTrail(
        userId,
        limit ? parseInt(limit as string) : 100
      );

      res.json({
        success: true,
        data: {
          logs,
          count: logs.length
        }
      });
    } catch (error: any) {
      logger.error('Get user audit trail error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get audit trail',
        error_code: 'AUDIT_FETCH_FAILED'
      });
    }
  }

  /**
   * GET /admin/audit
   * Search audit logs
   */
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

      res.json({
        success: true,
        data: {
          logs,
          count: logs.length
        }
      });
    } catch (error: any) {
      logger.error('Search audit logs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search audit logs',
        error_code: 'AUDIT_SEARCH_FAILED'
      });
    }
  }

  /**
   * GET /admin/stats
   * Get system statistics
   */
  async getSystemStats(req: Request, res: Response) {
    try {
      const { timeframe } = req.query;

      const stats = await adminService.getSystemStats(
        (timeframe as '24h' | '7d' | '30d') || '24h'
      );

      res.json({
        success: true,
        data: stats
      });
    } catch (error: any) {
      logger.error('Get system stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system statistics',
        error_code: 'STATS_FETCH_FAILED'
      });
    }
  }

  /**
   * GET /admin/security/suspicious
   * Get suspicious activity summary
   */
  async getSuspiciousActivity(req: Request, res: Response) {
    try {
      const { hours } = req.query;

      const summary = await adminService.getSuspiciousActivity(
        hours ? parseInt(hours as string) : 24
      );

      res.json({
        success: true,
        data: summary
      });
    } catch (error: any) {
      logger.error('Get suspicious activity error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get suspicious activity',
        error_code: 'SUSPICIOUS_FETCH_FAILED'
      });
    }
  }

  // ============================================
  // ADMIN MANAGEMENT
  // ============================================

  /**
   * GET /admin/admins
   * List all admin accounts
   */
  async listAdmins(req: Request, res: Response) {
    try {
      const admins = await adminService.listAdmins();

      res.json({
        success: true,
        data: {
          admins,
          count: admins.length
        }
      });
    } catch (error: any) {
      logger.error('List admins error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list admins',
        error_code: 'ADMIN_LIST_FAILED'
      });
    }
  }

  /**
   * POST /admin/admins/setup
   * Setup new admin account
   */
  async setupAdmin(req: Request, res: Response) {
    try {
      const { email, password, first_name, last_name, username } = req.body;

      if (!email || !password || !first_name || !last_name || !username) {
        return res.status(400).json({
          success: false,
          error: 'All fields are required',
          error_code: 'MISSING_FIELDS'
        });
      }

      // Check if email is in whitelist
      if (!adminService.isAdminEmail(email)) {
        return res.status(403).json({
          success: false,
          error: 'Email not authorized for admin access',
          error_code: 'UNAUTHORIZED_EMAIL'
        });
      }

      const admin = await userService.setupAdminAccount(
        email,
        password,
        { first_name, last_name, username },
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      res.status(201).json({
        success: true,
        message: 'Admin account created successfully',
        data: {
          user_id: admin._id,
          email: admin.email,
          username: admin.username
        }
      });
    } catch (error: any) {
      logger.error('Setup admin error:', error);

      if (error.message === 'ADMIN_ALREADY_EXISTS') {
        return res.status(409).json({
          success: false,
          error: 'Admin already exists',
          error_code: 'ADMIN_EXISTS'
        });
      }

      if (error.message === 'ADMIN_PASSWORD_TOO_WEAK') {
        return res.status(400).json({
          success: false,
          error: 'Password does not meet admin security requirements',
          error_code: 'WEAK_PASSWORD'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to setup admin',
        error_code: 'SETUP_FAILED'
      });
    }
  }

  /**
   * POST /admin/admins/:adminId/force-2fa
   * Force 2FA setup for admin
   */
  async forceAdmin2FASetup(req: Request, res: Response) {
    try {
      const adminId = req.params.adminId as string;
      const requesting_admin_id = (req as any).user?.user_id;

      const result = await adminService.forceAdmin2FASetup(
        adminId,
        requesting_admin_id,
        {
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!result.success) {
        return res.status(404).json({
          success: false,
          error: result.error,
          error_code: result.error
        });
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      logger.error('Force admin 2FA error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to force 2FA setup',
        error_code: 'FORCE_2FA_FAILED'
      });
    }
  }
}

export const adminController = new AdminController();