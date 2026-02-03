import { User, IApexUser, UserSecurity, AuthLog, RefreshToken, ApexMediaDocuments, OrganizerVerificationRequest } from '../../../models/user.model';
import { AuditService } from './auth.audit.service';
import { tokenService } from './auth.token.service';
import { otpService } from './auth.otp.service';
import { twoFactorService } from './auth.2fa.service';
import { env } from '../../../configs/env.config';
import { createLogger } from '../../../shared/utils/logger.utils';
import { emailService } from '../../../shared/utils/email.util';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes'; // <-- Add this import

const logger = createLogger('auth-admin-service');

// ============================================
// INTERFACES
// ============================================

export interface UserListFilters {
  role?: 'player' | 'organizer' | 'admin';
  is_active?: boolean;
  is_banned?: boolean;
  email_verified?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface UserListResult {
  users: IApexUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface UserDetailsResult {
  user: Partial<IApexUser>;
  security: any;
  recent_activity: any[];
  otp_stats: any;
  active_sessions: number;
  two_factor_status: any;
}

export interface BanUserParams {
  user_id: string;
  reason: string;
  banned_until?: Date;
  admin_id: string;
  device_context: {
    ip_address: string;
    user_agent: string;
  };
}

export interface AdminActionResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface SystemStats {
  users: {
    total: number;
    active: number;
    banned: number;
    players: number;
    organizers: number;
    admins: number;
    verified_emails: number;
    verified_organizers: number;
  };
  security: any;
  sessions: {
    active_total: number;
  };
  system: {
    uptime: number;
    memory: NodeJS.MemoryUsage;
    timestamp: Date;
  };
}

export interface VerificationListFilters {
  status?: 'pending' | 'under_review' | 'approved' | 'rejected' | 'needs_resubmission';
  page?: number;
  limit?: number;
  sort_order?: 'asc' | 'desc';
}

export interface VerificationListResult {
  requests: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface ReviewVerificationParams {
  request_id: string;
  action: 'approve' | 'reject' | 'request_resubmission'| 'organizer_approve' | 'organizer_rejected';
  admin_id: string;
  admin_notes?: string;
  rejection_reasons?: string[];
  device_context: {
    ip_address: string;
    user_agent: string;
  };
}

/**
 * Admin Service for user management and security operations
 */

export class AdminService {

  // ============================================
  // USER LISTING & SEARCH
  // ============================================

  /**
   * List users with filters and pagination
   */
  async listUsers(filters: UserListFilters): Promise<UserListResult> {
    try {
      const page = filters.page || 1;
      const limit = Math.min(filters.limit || 50, 100); // Max 100 per page
      const skip = (page - 1) * limit;

      // Build query
      const query: any = {};

      if (filters.role) {
        query.role = filters.role;
      }

      if (filters.is_active !== undefined) {
        query.is_active = filters.is_active;
      }

      if (filters.is_banned !== undefined) {
        query.is_banned = filters.is_banned;
      }

      if (filters.email_verified !== undefined) {
        query['verification_status.email_verified'] = filters.email_verified;
      }

      if (filters.search) {
        const search_regex = new RegExp(filters.search, 'i');
        query.$or = [
          { email: search_regex },
          { username: search_regex },
          { 'profile.first_name': search_regex },
          { 'profile.last_name': search_regex }
        ];
      }

      // Build sort
      const sort_field = filters.sort_by || 'created_at';
      const sort_order = filters.sort_order === 'asc' ? 1 : -1;
      const sort: any = { [sort_field]: sort_order };

      // Execute query
      const [users, total] = await Promise.all([
        User.find(query)
          .select('-password_hash')
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(query)
      ]);

      return {
        users: users as IApexUser[],
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.ceil(total / limit)
        }
      };
    } catch (error: any) {
      logger.error('Error listing users:', error);
      throw new Error('USER_LIST_FAILED');
    }
  }

  /**
   * Get detailed user information for admin view
   */
  async getUserDetails(user_id: string): Promise<UserDetailsResult> {
    try {
      const user = await User.findById(user_id).select('-password_hash').lean();
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const [security, recent_activity, otp_stats, active_sessions, two_factor_status] = await Promise.all([
        UserSecurity.findOne({ user_id }).lean(),
        AuditService.getUserAuditTrail(user_id, 20),
        otpService.getOTPStats(user_id),
        tokenService.getActiveSessions(user_id),
        twoFactorService.getStatus(user_id)
      ]);

      return {
        user,
        security: {
          lockout: security?.lockout,
          two_factor: {
            is_enabled: security?.two_factor.is_enabled,
            method: security?.two_factor.method,
            enabled_at: security?.two_factor.enabled_at
          },
          risk: security?.risk,
          activity_summary: security?.activity_summary,
          trusted_devices_count: security?.trusted_devices?.length || 0
        },
        recent_activity,
        otp_stats,
        active_sessions: active_sessions.length,
        two_factor_status
      };
    } catch (error: any) {
      logger.error('Error getting user details:', error);
      throw error;
    }
  }

  // ============================================
  // USER BAN/UNBAN
  // ============================================

  /**
   * Ban a user account
   */
  async banUser(params: BanUserParams): Promise<AdminActionResult> {
    try {
      const { user_id, reason, banned_until, admin_id, device_context } = params;

      const user = await User.findById(user_id);
      if (!user) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND }; // changed
      }

      // Prevent banning admins (unless super admin - future feature)
      if (user.role === 'admin') {
        return { success: false, error: AUTH_ERROR_CODES.CANNOT_BAN_ADMIN }; // changed
      }

      // Update user
      user.is_banned = true;
      user.banned_reason = reason;
      user.banned_until = banned_until as Date;
      user.banned_by = admin_id as any;
      await user.save();

      // Revoke all tokens
      await tokenService.revokeAllUserTokens(user_id, 'admin_action');

      // Log the action
      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_deactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: reason
        }
      });

      logger.info('User banned by admin', { user_id, admin_id, reason });

      return { success: true, message: 'User banned successfully' };
    } catch (error: any) {
      logger.error('Error banning user:', error);
      return { success: false, error: 'BAN_FAILED' };
    }
  }

  /**
   * Unban a user account
   */
  async unbanUser(
    user_id: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND }; // changed
      }

      if (!user.is_banned) {
        return { success: false, error: 'USER_NOT_BANNED' }; // could add to error-codes if desired
      }

      user.is_banned = false;
      user.banned_reason = undefined as any;
      user.banned_until = undefined as any;
      user.banned_by = undefined;
      await user.save();

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_reactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: 'Admin unbanned user'
        }
      });

      logger.info('User unbanned by admin', { user_id, admin_id });

      return { success: true, message: 'User unbanned successfully' };
    } catch (error: any) {
      logger.error('Error unbanning user:', error);
      return { success: false, error: 'UNBAN_FAILED' };
    }
  }

  // ============================================
  // ACCOUNT ACTIVATION
  // ============================================

  /**
   * Deactivate user account (soft delete)
   */
  async deactivateUser(
    user_id: string,
    reason: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND }; // changed
      }

      if (user.role === 'admin') {
        return { success: false, error: 'CANNOT_DEACTIVATE_ADMIN' }; // could add to error-codes if desired
      }

      user.is_active = false;
      await user.save();

      await tokenService.revokeAllUserTokens(user_id, 'admin_action');

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_deactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: reason
        }
      });

      logger.info('User deactivated by admin', { user_id, admin_id, reason });

      return { success: true, message: 'User deactivated successfully' };
    } catch (error: any) {
      logger.error('Error deactivating user:', error);
      return { success: false, error: 'DEACTIVATION_FAILED' };
    }
  }

  /**
   * Reactivate user account
   */
  async reactivateUser(
    user_id: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND }; // changed
      }

      if (user.is_active) {
        return { success: false, error: 'USER_ALREADY_ACTIVE' }; // could add to error-codes if desired
      }

      user.is_active = true;
      await user.save();

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_reactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: 'Admin reactivated account'
        }
      });

      logger.info('User reactivated by admin', { user_id, admin_id });

      return { success: true, message: 'User reactivated successfully' };
    } catch (error: any) {
      logger.error('Error reactivating user:', error);
      return { success: false, error: 'REACTIVATION_FAILED' };
    }
  }

  // ============================================
  // ROLE MANAGEMENT
  // ============================================

  /**
   * Change user role (player <-> organizer only)
   */
  async changeUserRole(
    user_id: string,
    new_role: 'player' | 'organizer',
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND }; // changed
      }

      // Cannot change admin role through this method
      if (user.role === 'admin') {
        return { success: false, error: 'CANNOT_CHANGE_ADMIN_ROLE' }; // could add to error-codes if desired
      }

      const old_role = user.role;
      user.role = new_role;

      // If promoting to organizer, they still need organizer verification
      if (new_role === 'organizer') {
        user.verification_status.organizer_verified = false;
      }

      await user.save();

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_reactivated', // Using this as generic account update
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: `Role changed from ${old_role} to ${new_role}`
        }
      });

      logger.info('User role changed by admin', { user_id, admin_id, old_role, new_role });

      return { success: true, message: `User role changed to ${new_role}` };
    } catch (error: any) {
      logger.error('Error changing user role:', error);
      return { success: false, error: 'ROLE_CHANGE_FAILED' };
    }
  }

  /**
   * Verify organizer status
   */
  async verifyOrganizer(
    user_id: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND }; // changed
      }

      if (user.role !== 'organizer') {
        return { success: false, error: 'USER_NOT_ORGANIZER' }; // could add to error-codes if desired
      }

      user.verification_status.organizer_verified = true;
      user.verification_status.verified_at = new Date();
      await user.save();

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_reactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: 'Organizer verified by admin'
        }
      });

      logger.info('Organizer verified by admin', { user_id, admin_id });

      return { success: true, message: 'Organizer verified successfully' };
    } catch (error: any) {
      logger.error('Error verifying organizer:', error);
      return { success: false, error: 'VERIFICATION_FAILED' };
    }
  }

  /**
   * Force verify user email (for support cases)
   */
  async forceVerifyEmail(
    user_id: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND }; // changed
      }

      user.verification_status.email_verified = true;
      user.verification_status.verified_at = new Date();
      await user.save();

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_reactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: 'Email force verified by admin'
        }
      });

      logger.info('Email force verified by admin', { user_id, admin_id });

      return { success: true, message: 'Email verified successfully' };
    } catch (error: any) {
      logger.error('Error force verifying email:', error);
      return { success: false, error: 'VERIFICATION_FAILED' };
    }
  }

  // ============================================
  // SECURITY OPERATIONS
  // ============================================

  /**
   * Force logout user (revoke all sessions)
   */
  async forceLogoutUser(
    user_id: string,
    reason: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND }; // changed
      }

      await tokenService.revokeAllUserTokens(user_id, 'admin_action');

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'logout_all_devices',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: reason
        }
      });

      logger.info('User force logged out by admin', { user_id, admin_id, reason });

      return { success: true, message: 'User logged out from all devices' };
    } catch (error: any) {
      logger.error('Error forcing logout:', error);
      return { success: false, error: 'FORCE_LOGOUT_FAILED' };
    }
  }

  /**
   * Get user's active sessions
   */
  async getUserSessions(user_id: string): Promise<any[]> {
    try {
      return await tokenService.getActiveSessions(user_id);
    } catch (error: any) {
      logger.error('Error getting user sessions:', error);
      throw new Error('SESSIONS_FETCH_FAILED');
    }
  }

  /**
   * Revoke specific session
   */
  async revokeUserSession(
    user_id: string,
    session_id: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const revoked = await tokenService.revokeSession(user_id, session_id);

      if (!revoked) {
        return { success: false, error: AUTH_ERROR_CODES.SESSION_NOT_FOUND }; // changed
      }

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'token_revoked',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: 'Session revoked by admin',
          session_id
        }
      });

      logger.info('Session revoked by admin', { user_id, session_id, admin_id });

      return { success: true, message: 'Session revoked successfully' };
    } catch (error: any) {
      logger.error('Error revoking session:', error);
      return { success: false, error: 'SESSION_REVOKE_FAILED' };
    }
  }

  /**
   * Unlock locked account
   */
  async unlockAccount(
    user_id: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const security = await UserSecurity.findOne({ user_id });
      if (!security) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND }; // changed
      }

      if (!security.lockout.is_locked) {
        return { success: false, error: 'ACCOUNT_NOT_LOCKED' }; // could add to error-codes if desired
      }

      security.lockout.is_locked = false;
      security.lockout.locked_until = undefined;
      security.lockout.failed_login_attempts = 0;
      security.lockout.lock_reason = undefined;
      await security.save();

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_unlocked',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: 'Account unlocked by admin'
        }
      });

      // Send account unlocked notification
      const user = await User.findById(user_id).select('email profile.first_name');
      if (user) {
        await emailService.sendEmail({
          to: user.email,
          template: 'account_unlocked',
          data: {
            user_name: user.profile?.first_name || 'User'
          }
        });
      }

      logger.info('Account unlocked by admin', { user_id, admin_id });

      return { success: true, message: 'Account unlocked successfully' };
    } catch (error: any) {
      logger.error('Error unlocking account:', error);
      return { success: false, error: 'UNLOCK_FAILED' };
    }
  }

  /**
   * Force password reset on next login
   */
  async forcePasswordReset(
    user_id: string,
    reason: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const security = await UserSecurity.findOne({ user_id });
      if (!security) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND }; // changed
      }

      security.password.change_required = true;
      security.password.change_required_reason = reason;
      await security.save();

      // Revoke all tokens to force re-login
      await tokenService.revokeAllUserTokens(user_id, 'security_concern');

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'password_reset_requested',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: reason
        }
      });

      logger.info('Password reset forced by admin', { user_id, admin_id, reason });

      return { success: true, message: 'Password reset required on next login' };
    } catch (error: any) {
      logger.error('Error forcing password reset:', error);
      return { success: false, error: 'FORCE_RESET_FAILED' };
    }
  }

  // ============================================
  // ADMIN MANAGEMENT
  // ============================================

  /**
   * List all admin accounts
   */
  async listAdmins(): Promise<IApexUser[]> {
    try {
      return await User.find({ role: 'admin' })
        .select('-password_hash')
        .sort({ created_at: -1 })
        .lean() as IApexUser[];
    } catch (error: any) {
      logger.error('Error listing admins:', error);
      throw new Error('ADMIN_LIST_FAILED');
    }
  }

  /**
   * Check if email is in admin whitelist
   */
  isAdminEmail(email: string): boolean {
    const admin_emails_raw = env.ADMIN_EMAILS || '';
    const allowed_emails = admin_emails_raw
      .split(',')
      .map((e: string) => e.trim().toLowerCase())
      .filter((e: string) => e.length > 0);
    return allowed_emails.includes(email.toLowerCase());
  }

  /**
   * Force 2FA setup for admin
   */
  async forceAdmin2FASetup(
    admin_user_id: string,
    requesting_admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const admin = await User.findById(admin_user_id);
      if (!admin || admin.role !== 'admin') {
        return { success: false, error: 'ADMIN_NOT_FOUND' };
      }

      const security = await UserSecurity.findOne({ user_id: admin_user_id });
      if (!security) {
        return { success: false, error: 'SECURITY_NOT_FOUND' };
      }

      security.two_factor.setup_required = true;
      await security.save();

      // Revoke tokens to force re-login
      await tokenService.revokeAllUserTokens(admin_user_id, 'security_concern');

      await AuditService.logAuthEvent({
        user_id: admin_user_id,
        event_type: '2fa_enabled',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id: requesting_admin_id,
          admin_reason: '2FA setup forced by admin'
        }
      });

      logger.info('2FA setup forced for admin', { admin_user_id, requesting_admin_id });

      return { success: true, message: '2FA setup required on next login' };
    } catch (error: any) {
      logger.error('Error forcing 2FA setup:', error);
      return { success: false, error: 'FORCE_2FA_FAILED' };
    }
  }

  // ============================================
  // STATISTICS & REPORTING
  // ============================================

  /**
   * Get system statistics
   */
  async getSystemStats(timeframe: '24h' | '7d' | '30d' = '24h'): Promise<SystemStats> {
    try {
      const [
        total_users,
        active_users,
        banned_users,
        players,
        organizers,
        admins,
        verified_emails,
        verified_organizers,
        security_stats,
        active_sessions
      ] = await Promise.all([
        User.countDocuments({}),
        User.countDocuments({ is_active: true }),
        User.countDocuments({ is_banned: true }),
        User.countDocuments({ role: 'player' }),
        User.countDocuments({ role: 'organizer' }),
        User.countDocuments({ role: 'admin' }),
        User.countDocuments({ 'verification_status.email_verified': true }),
        User.countDocuments({ 'verification_status.organizer_verified': true }),
        AuditService.getSecurityStats(timeframe),
        RefreshToken.countDocuments({ is_revoked: false, expires_at: { $gt: new Date() } })
      ]);

      return {
        users: {
          total: total_users,
          active: active_users,
          banned: banned_users,
          players,
          organizers,
          admins,
          verified_emails,
          verified_organizers
        },
        security: security_stats,
        sessions: {
          active_total: active_sessions
        },
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date()
        }
      };
    } catch (error: any) {
      logger.error('Error getting system stats:', error);
      throw new Error('STATS_FETCH_FAILED');
    }
  }

  /**
   * Get suspicious activity summary
   */
  async getSuspiciousActivity(hours: number = 24): Promise<any> {
    try {
      return await AuditService.getSuspiciousActivitySummary(hours);
    } catch (error: any) {
      logger.error('Error getting suspicious activity:', error);
      throw new Error('SUSPICIOUS_ACTIVITY_FETCH_FAILED');
    }
  }

  /**
   * Search audit logs
   */
  async searchAuditLogs(filters: {
    user_id?: string;
    event_type?: string;
    success?: boolean;
    start_date?: Date;
    end_date?: Date;
    ip_address?: string;
    is_suspicious?: boolean;
    limit?: number;
  }): Promise<any[]> {
    try {
      return await AuditService.searchAuditLogs(filters);
    } catch (error: any) {
      logger.error('Error searching audit logs:', error);
      throw new Error('AUDIT_SEARCH_FAILED');
    }
  }

  /**
   * Get user's audit trail
   */
  async getUserAuditTrail(user_id: string, limit: number = 100): Promise<any[]> {
    try {
      return await AuditService.getUserAuditTrail(user_id, limit);
    } catch (error: any) {
      logger.error('Error getting user audit trail:', error);
      throw new Error('AUDIT_TRAIL_FETCH_FAILED');
    }
  }

  // ============================================
  // ORGANIZER VERIFICATION MANAGEMENT
  // ============================================

  /**
   * List organizer verification requests
   */
  async listVerificationRequests(filters: VerificationListFilters): Promise<VerificationListResult> {
    try {
      const page = filters.page || 1;
      const limit = Math.min(filters.limit || 20, 50);
      const skip = (page - 1) * limit;

      const query: any = {};
      if (filters.status) {
        query.status = filters.status;
      }

      const sort_order = filters.sort_order === 'asc' ? 1 : -1;

      const [requests, total] = await Promise.all([
        OrganizerVerificationRequest.find(query)
          .populate('user_id', 'email username profile.first_name profile.last_name')
          .populate('required_documents.id_front required_documents.id_back required_documents.selfie_with_id required_documents.business_registration required_documents.utility_bill')
          .populate('reviewed_by', 'email username')
          .sort({ submitted_at: sort_order })
          .skip(skip)
          .limit(limit)
          .lean(),
        OrganizerVerificationRequest.countDocuments(query)
      ]);

      return {
        requests,
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.ceil(total / limit)
        }
      };
    } catch (error: any) {
      logger.error('Error listing verification requests:', error);
      throw new Error('VERIFICATION_LIST_FAILED');
    }
  }

  /**
   * Get single verification request details
   */
  async getVerificationRequestDetails(request_id: string): Promise<any> {
    try {
      const request = await OrganizerVerificationRequest.findById(request_id)
        .populate('user_id', 'email username profile.first_name profile.last_name profile.phone_number created_at')
        .populate('required_documents.id_front required_documents.id_back required_documents.selfie_with_id required_documents.business_registration required_documents.utility_bill')
        .populate('reviewed_by', 'email username')
        .lean();

      if (!request) {
        throw new Error('VERIFICATION_REQUEST_NOT_FOUND');
      }

      return request;
    } catch (error: any) {
      logger.error('Error getting verification request details:', error);
      throw error;
    }
  }

  /**
   * Review organizer verification request (approve/reject)
   */
  async reviewVerificationRequest(params: ReviewVerificationParams): Promise<AdminActionResult> {
    try {
      const { request_id, action, admin_id, admin_notes, rejection_reasons, device_context } = params;

      const request = await OrganizerVerificationRequest.findById(request_id);
      if (!request) {
        return { success: false, error: 'VERIFICATION_REQUEST_NOT_FOUND' };
      }

      if (!['pending', 'under_review'].includes(request.status)) {
        return { success: false, error: 'REQUEST_ALREADY_PROCESSED' };
      }

      const user = await User.findById(request.user_id);
      if (!user) {
        return { success: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND };
      }

      // Update request status
      request.reviewed_by = admin_id as any;
      request.reviewed_at = new Date();
      request.admin_notes = admin_notes;

      let document_status: 'approved' | 'rejected' | 'pending' = 'pending';

      switch (action) {
        case 'approve':
          request.status = 'approved';
          document_status = 'approved';

          // Update user's role and verification status
          user.role = 'organizer';
          user.verification_status.organizer_verified = true;
          user.verification_status.verified_at = new Date();
          await user.save();

          logger.info('Organizer verification approved', { user_id: user._id, request_id });
          break;

        case 'reject':
          request.status = 'rejected';
          request.rejection_reasons = rejection_reasons || ['Application rejected'];
          document_status = 'rejected';

          logger.info('Organizer verification rejected', { user_id: user._id, request_id });
          break;

        case 'request_resubmission':
          request.status = 'needs_resubmission';
          request.rejection_reasons = rejection_reasons || ['Additional documents required'];

          logger.info('Organizer verification needs resubmission', { user_id: user._id, request_id });
          break;

        default:
          return { success: false, error: 'INVALID_ACTION' };
      }

      await request.save();

      // Update document statuses
      if (document_status !== 'pending') {
        await ApexMediaDocuments.updateMany(
          { verification_request_id: request._id },
          { 
            status: document_status,
            reviewed_at: new Date(),
            reviewed_by: admin_id,
            rejection_reason: action === 'reject' ? rejection_reasons?.join(', ') : undefined
          }
        );
      }

      // Log admin action
      await AuditService.logAuthEvent({
        user_id: request.user_id.toString(),
        event_type: 'account_reactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id,
          admin_reason: `Organizer verification ${action}: ${admin_notes || 'No notes'}`,
          request_id
        }
      });

      // Send notification email to user
      await emailService.sendEmail({
        to: user.email,
        template: action === 'approve' ? 'organizer_approved' : 'organizer_rejected',
        data: {
          user_name: user.profile?.first_name || 'User',
          status: action,
          rejection_reasons: rejection_reasons,
          admin_notes: admin_notes
        }
      }).catch(err => logger.warn('Failed to send verification email', { error: err.message }));

      return {
        success: true,
        message: `Verification request ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'marked for resubmission'}`
      };
    } catch (error: any) {
      logger.error('Error reviewing verification request:', error);
      return { success: false, error: 'REVIEW_FAILED' };
    }
  }

  /**
   * Mark request as under review
   */
  async markVerificationUnderReview(
    request_id: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<AdminActionResult> {
    try {
      const request = await OrganizerVerificationRequest.findById(request_id);
      if (!request) {
        return { success: false, error: 'VERIFICATION_REQUEST_NOT_FOUND' };
      }

      if (request.status !== 'pending') {
        return { success: false, error: 'REQUEST_NOT_PENDING' };
      }

      request.status = 'under_review';
      request.reviewed_by = admin_id as any;
      await request.save();

      logger.info('Verification request marked under review', { request_id, admin_id });

      return { success: true, message: 'Request marked as under review' };
    } catch (error: any) {
      logger.error('Error marking verification under review:', error);
      return { success: false, error: 'UPDATE_FAILED' };
    }
  }
}

export const adminService = new AdminService();
