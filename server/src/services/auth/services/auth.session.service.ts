import { tokenService, DeviceInfo, TokenPair } from './auth.token.service';
import { AuthLog } from '../../../models/user.model';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-session-service');

export interface SessionInfo {
  session_id: string;
  device_info: {
    user_agent: string;
    ip_address: string;
    device_type?: string;
    device_name?: string;
  };
  created_at: Date;
  expires_at: Date;
  last_used_at?: Date;
  use_count: number;
}

export interface SessionValidationResult {
  valid: boolean;
  user_id?: string;
  email?: string;
  role?: 'player' | 'organizer' | 'admin';
}

/**
 * Session service managing user sessions (wrapper around token service)
 * Supports: players, organizers (user sessions) and admins (admin sessions)
 */

export class SessionService {

  // ============================================
  // SESSION CREATION
  // ============================================

  /**
   * Create new session for players and organizers
   */
  async createUserSession(
    user_id: string,
    email: string,
    role: 'player' | 'organizer',
    device_info: DeviceInfo
  ): Promise<TokenPair> {
    try {
      const tokenPair = await tokenService.generateUserTokenPair(
        user_id,
        email,
        role,
        device_info,
        true // revoke existing tokens on new login
      );

      await this.logAuthEvent({
        user_id,
        event_type: 'login_success',
        success: true,
        metadata: {
          ip_address: device_info.ip_address,
          user_agent: device_info.user_agent
        }
      });

      logger.info('New user session created', { user_id, role });
      return tokenPair;
    } catch (error: any) {
      logger.error('Error creating user session:', error);
      throw new Error('SESSION_CREATION_FAILED');
    }
  }

  /**
   * Create new session for admins
   */
  async createAdminSession(
    user_id: string,
    email: string,
    device_info: DeviceInfo
  ): Promise<TokenPair> {
    try {
      const tokenPair = await tokenService.generateAdminTokenPair(
        user_id,
        email,
        device_info,
        true // revoke existing tokens on new login
      );

      await this.logAuthEvent({
        user_id,
        event_type: 'login_success',
        success: true,
        metadata: {
          ip_address: device_info.ip_address,
          user_agent: device_info.user_agent,
          is_admin: true
        }
      });

      logger.info('New admin session created', { user_id });
      return tokenPair;
    } catch (error: any) {
      logger.error('Error creating admin session:', error);
      throw new Error('SESSION_CREATION_FAILED');
    }
  }

  // ============================================
  // SESSION REFRESH
  // ============================================

  /**
   * Refresh user session (player/organizer)
   */
  async refreshUserSession(
    refreshToken: string,
    device_info: DeviceInfo
  ): Promise<{ accessToken: string; newRefreshToken: string }> {
    try {
      // 1. Verify the current refresh token
      const verification = await tokenService.verifyRefreshToken(refreshToken);

      if (!verification.valid || !verification.payload) {
        logger.warn('Invalid refresh token for user session', { error: verification.error });
        throw new Error('INVALID_REFRESH_TOKEN');
      }

      const { user_id, email, role } = verification.payload;

      // 2. Ensure this is not an admin token
      if (role === 'admin') {
        logger.warn('Admin token used on user refresh endpoint', { user_id });
        throw new Error('INVALID_TOKEN_TYPE');
      }

      // 3. Generate new tokens (don't revoke existing yet)
      const accessToken = await tokenService.generateUserAccessToken(user_id, email, role);
      const newRefreshToken = await tokenService.generateRefreshToken(user_id, device_info, false);

      // 4. Revoke the old token after new one is created
      try {
        await tokenService.revokeRefreshToken(refreshToken);
      } catch (revokeError: any) {
        logger.warn('Failed to revoke old refresh token (non-critical)', {
          error: revokeError.message
        });
      }

      // 5. Log the refresh event
      await this.logAuthEvent({
        user_id,
        event_type: 'token_refreshed',
        success: true,
        metadata: {
          ip_address: device_info.ip_address,
          user_agent: device_info.user_agent
        }
      });

      logger.info('User session refreshed', { user_id, role });
      return { accessToken, newRefreshToken };
    } catch (error: any) {
      logger.error('Error refreshing user session:', error);

      if (error.message === 'INVALID_REFRESH_TOKEN' || error.message === 'INVALID_TOKEN_TYPE') {
        throw error;
      }

      throw new Error('SESSION_REFRESH_FAILED');
    }
  }

  /**
   * Refresh admin session
   */
  async refreshAdminSession(
    refreshToken: string,
    device_info: DeviceInfo
  ): Promise<{ accessToken: string; newRefreshToken: string }> {
    try {
      // 1. Verify the current refresh token
      const verification = await tokenService.verifyRefreshToken(refreshToken);

      if (!verification.valid || !verification.payload) {
        logger.warn('Invalid refresh token for admin session', { error: verification.error });
        throw new Error('INVALID_REFRESH_TOKEN');
      }

      const { user_id, email, role } = verification.payload;

      // 2. Ensure this is an admin token
      if (role !== 'admin') {
        logger.warn('Non-admin token used on admin refresh endpoint', { user_id, role });
        throw new Error('INVALID_TOKEN_TYPE');
      }

      // 3. Generate new tokens
      const accessToken = await tokenService.generateAdminAccessToken(user_id, email);
      const newRefreshToken = await tokenService.generateRefreshToken(user_id, device_info, false);

      // 4. Revoke the old token
      try {
        await tokenService.revokeRefreshToken(refreshToken);
      } catch (revokeError: any) {
        logger.warn('Failed to revoke old admin refresh token (non-critical)', {
          error: revokeError.message
        });
      }

      // 5. Log the refresh event
      await this.logAuthEvent({
        user_id,
        event_type: 'token_refreshed',
        success: true,
        metadata: {
          ip_address: device_info.ip_address,
          user_agent: device_info.user_agent,
          is_admin: true
        }
      });

      logger.info('Admin session refreshed', { user_id });
      return { accessToken, newRefreshToken };
    } catch (error: any) {
      logger.error('Error refreshing admin session:', error);

      if (error.message === 'INVALID_REFRESH_TOKEN' || error.message === 'INVALID_TOKEN_TYPE') {
        throw error;
      }

      throw new Error('SESSION_REFRESH_FAILED');
    }
  }

  // ============================================
  // SESSION VALIDATION
  // ============================================

  /**
   * Validate user session (player/organizer)
   */
  async validateUserSession(accessToken: string): Promise<SessionValidationResult> {
    try {
      const verification = await tokenService.verifyUserAccessToken(accessToken);

      if (verification.valid && verification.payload) {
        return {
          valid: true,
          user_id: verification.payload.user_id,
          email: verification.payload.email,
          role: verification.payload.role
        };
      }

      return { valid: false };
    } catch (error: any) {
      logger.error('Error validating user session:', error);
      return { valid: false };
    }
  }

  /**
   * Validate admin session
   */
  async validateAdminSession(accessToken: string): Promise<SessionValidationResult> {
    try {
      const verification = await tokenService.verifyAdminAccessToken(accessToken);

      if (verification.valid && verification.payload) {
        return {
          valid: true,
          user_id: verification.payload.user_id,
          email: verification.payload.email,
          role: verification.payload.role
        };
      }

      return { valid: false };
    } catch (error: any) {
      logger.error('Error validating admin session:', error);
      return { valid: false };
    }
  }

  // ============================================
  // SESSION REVOCATION
  // ============================================

  /**
   * Revoke current session (logout)
   */
  async revokeCurrentSession(
    user_id: string,
    refreshToken: string,
    metadata: { ip_address: string; user_agent: string }
  ): Promise<void> {
    try {
      await tokenService.revokeRefreshToken(refreshToken);

      await this.logAuthEvent({
        user_id,
        event_type: 'logout',
        success: true,
        metadata
      });

      logger.info('Session revoked', { user_id });
    } catch (error: any) {
      logger.error('Error revoking session:', error);
      throw new Error('SESSION_REVOCATION_FAILED');
    }
  }

  /**
   * Revoke all sessions for a user (logout from all devices)
   */
  async revokeAllUserSessions(
    user_id: string,
    context: { ip_address: string; user_agent: string; reason?: string }
  ): Promise<void> {
    try {
      const reason = context.reason as 'logout' | 'password_change' | 'security_concern' | 'admin_action' || 'logout';
      await tokenService.revokeAllUserTokens(user_id, reason);

      await this.logAuthEvent({
        user_id,
        event_type: 'logout_all_devices',
        success: true,
        metadata: {
          ip_address: context.ip_address,
          user_agent: context.user_agent,
          reason: context.reason
        }
      });

      logger.info('All user sessions revoked', { user_id, reason: context.reason });
    } catch (error: any) {
      logger.error('Failed to revoke all user sessions', {
        user_id,
        error: error.message
      });
      // Don't throw - session revocation failure shouldn't block operations
    }
  }

  /**
   * Revoke specific session by session ID
   */
  async revokeSessionById(
    user_id: string,
    session_id: string,
    metadata: { ip_address: string; user_agent: string }
  ): Promise<boolean> {
    try {
      const revoked = await tokenService.revokeSession(user_id, session_id);

      if (revoked) {
        await this.logAuthEvent({
          user_id,
          event_type: 'token_revoked',
          success: true,
          metadata: {
            ...metadata,
            session_id
          }
        });
        logger.info('Session revoked by ID', { user_id, session_id });
      }

      return revoked;
    } catch (error: any) {
      logger.error('Error revoking session by ID:', error);
      throw new Error('SESSION_REVOCATION_FAILED');
    }
  }

  // ============================================
  // SESSION INFO
  // ============================================

  /**
   * Get active sessions for a user
   */
  async getActiveSessions(user_id: string): Promise<SessionInfo[]> {
    try {
      const sessions = await tokenService.getActiveSessions(user_id);

      if (sessions.length === 0) {
        return [];
      }

      return sessions.map(session => ({
        session_id: session._id.toString(),
        device_info: session.device_info,
        created_at: session.created_at,
        expires_at: session.expires_at,
        last_used_at: session.last_used_at,
        use_count: session.use_count
      }));
    } catch (error: any) {
      logger.error('Error getting active sessions:', error);
      throw new Error('SESSION_INFO_FETCH_FAILED');
    }
  }

  /**
   * Get active session count for a user
   */
  async getActiveSessionCount(user_id: string): Promise<number> {
    try {
      const sessions = await tokenService.getActiveSessions(user_id);
      return sessions.length;
    } catch (error: any) {
      logger.error('Error getting session count:', error);
      return 0;
    }
  }

  // ============================================
  // AUDIT LOGGING
  // ============================================

  /**
   * Log authentication event
   */
  private async logAuthEvent(params: {
    user_id?: string;
    event_type: string;
    success: boolean;
    identifier?: string;
    metadata: {
      ip_address: string;
      user_agent: string;
      failure_reason?: string;
      [key: string]: any;
    };
  }): Promise<void> {
    try {
      await AuthLog.create({
        user_id: params.user_id,
        event_type: params.event_type,
        success: params.success,
        identifier: params.identifier,
        metadata: {
          ip_address: params.metadata.ip_address,
          user_agent: params.metadata.user_agent,
          failure_reason: params.metadata.failure_reason,
          is_suspicious: false
        }
      });
    } catch (error: any) {
      // Log but don't throw - audit logging shouldn't break auth flow
      logger.error('Failed to log auth event', { error: error.message });
    }
  }
}

export const sessionService = new SessionService();
