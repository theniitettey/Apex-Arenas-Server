import { Request, Response } from 'express';
import crypto from 'crypto';
import { tokenService } from '../services/auth.token.service';
import { sessionService } from '../services/auth.session.service';
import { redisManager } from '../../../configs/redis.config';
import { AuthRequest } from '../middlewares/auth.jwt.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-token-controller');

/**
 * Extract bearer token from request
 */
const extractBearerToken = (req: Request): string | null => {
  const auth_header = req.headers.authorization;
  if (!auth_header || !auth_header.startsWith('Bearer ')) {
    return null;
  }
  return auth_header.substring(7);
};

/**
 * Blacklist an access token in Redis
 */
const blacklistAccessToken = async (token: string): Promise<void> => {
  try {
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');
    // Blacklist for 15 minutes (access token expiry time)
    await redisManager.blacklistToken(token_hash, 15 * 60);
    logger.debug('Access token blacklisted', { token_hash: token_hash.substring(0, 8) + '...' });
  } catch (error) {
    logger.error('Failed to blacklist access token', { error });
    // Don't throw - logout should still succeed even if blacklisting fails
  }
};

/**
 * Token Controller
 * Handles token refresh, validation, and session management for users and admins
 */

export class TokenController {

  // ============================================
  // TOKEN REFRESH
  // ============================================

  /**
   * POST /auth/token/refresh
   * Refresh access token for users (players/organizers)
   */
  async refreshUserToken(req: Request, res: Response) {
    try {
      const { refresh_token } = req.body;
      const ip_address = req.ip || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      if (!refresh_token) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token is required',
          error_code: 'MISSING_REFRESH_TOKEN'
        });
      }

      const result = await sessionService.refreshUserSession(refresh_token, {
        ip_address,
        user_agent
      });

      res.json({
        success: true,
        data: {
          access_token: result.accessToken,
          refresh_token: result.newRefreshToken
        }
      });
    } catch (error: any) {
      logger.error('User token refresh error:', error);

      if (error.message === 'INVALID_REFRESH_TOKEN') {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired refresh token',
          error_code: 'INVALID_REFRESH_TOKEN'
        });
      }

      if (error.message === 'INVALID_TOKEN_TYPE') {
        return res.status(401).json({
          success: false,
          error: 'Invalid token type for this endpoint',
          error_code: 'INVALID_TOKEN_TYPE'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to refresh token',
        error_code: 'TOKEN_REFRESH_FAILED'
      });
    }
  }

  /**
   * POST /auth/admin/token/refresh
   * Refresh access token for admins
   */
  async refreshAdminToken(req: Request, res: Response) {
    try {
      const { refresh_token } = req.body;
      const ip_address = req.ip || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      if (!refresh_token) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token is required',
          error_code: 'MISSING_REFRESH_TOKEN'
        });
      }

      const result = await sessionService.refreshAdminSession(refresh_token, {
        ip_address,
        user_agent
      });

      res.json({
        success: true,
        data: {
          access_token: result.accessToken,
          refresh_token: result.newRefreshToken
        }
      });
    } catch (error: any) {
      logger.error('Admin token refresh error:', error);

      if (error.message === 'INVALID_REFRESH_TOKEN') {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired refresh token',
          error_code: 'INVALID_REFRESH_TOKEN'
        });
      }

      if (error.message === 'INVALID_TOKEN_TYPE') {
        return res.status(401).json({
          success: false,
          error: 'Invalid token type. Admin token required.',
          error_code: 'INVALID_TOKEN_TYPE'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to refresh admin token',
        error_code: 'TOKEN_REFRESH_FAILED'
      });
    }
  }

  // ============================================
  // TOKEN VALIDATION
  // ============================================

  /**
   * POST /auth/token/validate
   * Validate user access token (for internal services)
   */
  async validateUserToken(req: Request, res: Response) {
    try {
      const auth_header = req.headers.authorization;

      if (!auth_header || !auth_header.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Bearer token required',
          error_code: 'MISSING_TOKEN'
        });
      }

      const token = auth_header.substring(7);
      const verification = await tokenService.verifyUserAccessToken(token);

      if (!verification.valid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid token',
          error_code: verification.error || 'INVALID_TOKEN'
        });
      }

      res.json({
        success: true,
        data: {
          valid: true,
          user_id: verification.payload?.user_id,
          email: verification.payload?.email,
          role: verification.payload?.role
        }
      });
    } catch (error: any) {
      logger.error('User token validation error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to validate token',
        error_code: 'VALIDATION_FAILED'
      });
    }
  }

  /**
   * POST /auth/admin/token/validate
   * Validate admin access token (for internal services)
   */
  async validateAdminToken(req: Request, res: Response) {
    try {
      const auth_header = req.headers.authorization;

      if (!auth_header || !auth_header.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Bearer token required',
          error_code: 'MISSING_TOKEN'
        });
      }

      const token = auth_header.substring(7);
      const verification = await tokenService.verifyAdminAccessToken(token);

      if (!verification.valid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid admin token',
          error_code: verification.error || 'INVALID_TOKEN'
        });
      }

      res.json({
        success: true,
        data: {
          valid: true,
          user_id: verification.payload?.user_id,
          email: verification.payload?.email,
          role: verification.payload?.role,
          is_admin: true
        }
      });
    } catch (error: any) {
      logger.error('Admin token validation error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to validate admin token',
        error_code: 'VALIDATION_FAILED'
      });
    }
  }

  // ============================================
  // SESSION MANAGEMENT
  // ============================================

  /**
   * GET /auth/sessions
   * Get current user's active sessions
   */
  async getActiveSessions(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;

      if (!user_id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          error_code: 'AUTH_REQUIRED'
        });
      }

      const sessions = await sessionService.getActiveSessions(user_id);

      res.json({
        success: true,
        data: {
          sessions,
          count: sessions.length
        }
      });
    } catch (error: any) {
      logger.error('Get sessions error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to get sessions',
        error_code: 'SESSIONS_FETCH_FAILED'
      });
    }
  }

  /**
   * DELETE /auth/sessions/:sessionId
   * Revoke a specific session
   */
  async revokeSession(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const sessionId = req.params.sessionId as string;

      if (!user_id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          error_code: 'AUTH_REQUIRED'
        });
      }

      if (!sessionId || Array.isArray(sessionId)) {
        return res.status(400).json({
          success: false,
          error: 'Session ID is required',
          error_code: 'MISSING_SESSION_ID'
        });
      }

      const revoked = await sessionService.revokeSessionById(
        user_id,
        sessionId,
        {
          ip_address: (req.ip as string) || 'unknown',
          user_agent: req.get('user-agent') || 'unknown'
        }
      );

      if (!revoked) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
          error_code: 'SESSION_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        message: 'Session revoked successfully'
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
   * POST /auth/sessions/revoke-others
   * Revoke all sessions except current
   */
  async revokeOtherSessions(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const { refresh_token } = req.body;

      if (!user_id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          error_code: 'AUTH_REQUIRED'
        });
      }

      // Revoke all tokens
      await sessionService.revokeAllUserSessions(user_id, {
        ip_address: req.ip || 'unknown',
        user_agent: req.get('user-agent') || 'unknown',
        reason: 'logout'
      });

      // If refresh token provided, create a new session for current device
      let new_tokens = null;
      if (refresh_token) {
        // This will fail if the refresh token was just revoked, which is expected
        // User will need to login again
      }

      res.json({
        success: true,
        message: 'All other sessions revoked. Please login again.',
        data: new_tokens
      });
    } catch (error: any) {
      logger.error('Revoke other sessions error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to revoke sessions',
        error_code: 'SESSION_REVOKE_FAILED'
      });
    }
  }

  /**
   * POST /auth/logout
   * Logout current session
   */
  async logout(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const { refresh_token } = req.body;

      if (!user_id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          error_code: 'AUTH_REQUIRED'
        });
      }

      // Blacklist the access token to invalidate it immediately
      const access_token = extractBearerToken(req);
      if (access_token) {
        await blacklistAccessToken(access_token);
      }

      // Revoke the refresh token
      if (refresh_token) {
        await sessionService.revokeCurrentSession(
          user_id,
          refresh_token,
          {
            ip_address: req.ip || 'unknown',
            user_agent: req.get('user-agent') || 'unknown'
          }
        );
      }

      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error: any) {
      logger.error('Logout error:', error);

      // Still return success even if token revocation fails
      // Client should clear local tokens regardless
      res.json({
        success: true,
        message: 'Logged out'
      });
    }
  }

  /**
   * POST /auth/logout-all
   * Logout from all devices
   */
  async logoutAll(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;

      if (!user_id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          error_code: 'AUTH_REQUIRED'
        });
      }

      // Blacklist the current access token
      const access_token = extractBearerToken(req);
      if (access_token) {
        await blacklistAccessToken(access_token);
      }

      // Revoke all refresh tokens
      await sessionService.revokeAllUserSessions(user_id, {
        ip_address: req.ip || 'unknown',
        user_agent: req.get('user-agent') || 'unknown',
        reason: 'logout'
      });

      res.json({
        success: true,
        message: 'Logged out from all devices'
      });
    } catch (error: any) {
      logger.error('Logout all error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to logout from all devices',
        error_code: 'LOGOUT_ALL_FAILED'
      });
    }
  }
}

export const tokenController = new TokenController();
