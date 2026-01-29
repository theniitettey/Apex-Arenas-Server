import { Request, Response } from 'express';
import crypto from 'crypto';
import { tokenService } from '../services/auth.token.service';
import { sessionService } from '../services/auth.session.service';
import { redisManager } from '../../../configs/redis.config';
import { AuthRequest } from '../middlewares/auth.jwt.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';
import { sendSuccess, sendError, sendUnauthorized, sendNotFound } from '../../../shared/utils/response.utils';
import { extractDeviceContext } from '../../../shared/utils/request.utils';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes';

const logger = createLogger('auth-token-controller');

const extractBearerToken = (req: Request): string | null => {
  const auth_header = req.headers.authorization;
  if (!auth_header || !auth_header.startsWith('Bearer ')) {
    return null;
  }
  return auth_header.substring(7);
};

const blacklistAccessToken = async (token: string): Promise<void> => {
  try {
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');
    await redisManager.blacklistToken(token_hash, 15 * 60);
    logger.debug('Access token blacklisted', { token_hash: token_hash.substring(0, 8) + '...' });
  } catch (error) {
    logger.error('Failed to blacklist access token', { error });
  }
};

export class TokenController {

  async refreshUserToken(req: Request, res: Response) {
    try {
      const { refresh_token } = req.body;
      const device_context = extractDeviceContext(req);

      if (!refresh_token) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_TOKEN, undefined, 'Refresh token is required');
      }

      const result = await sessionService.refreshUserSession(refresh_token, device_context);

      return sendSuccess(res, {
        access_token: result.accessToken,
        refresh_token: result.newRefreshToken
      });
    } catch (error: any) {
      logger.error('User token refresh error:', error);

      if (error.message === 'INVALID_REFRESH_TOKEN') {
        return sendUnauthorized(res, AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN);
      }

      if (error.message === 'INVALID_TOKEN_TYPE') {
        return sendUnauthorized(res, AUTH_ERROR_CODES.INVALID_TOKEN_TYPE);
      }

      return sendError(res, AUTH_ERROR_CODES.SESSION_REFRESH_FAILED);
    }
  }

  async refreshAdminToken(req: Request, res: Response) {
    try {
      const { refresh_token } = req.body;
      const device_context = extractDeviceContext(req);

      if (!refresh_token) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_TOKEN, undefined, 'Refresh token is required');
      }

      const result = await sessionService.refreshAdminSession(refresh_token, device_context);

      return sendSuccess(res, {
        access_token: result.accessToken,
        refresh_token: result.newRefreshToken
      });
    } catch (error: any) {
      logger.error('Admin token refresh error:', error);

      if (error.message === 'INVALID_REFRESH_TOKEN') {
        return sendUnauthorized(res, AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN);
      }

      if (error.message === 'INVALID_TOKEN_TYPE') {
        return sendUnauthorized(res, AUTH_ERROR_CODES.INVALID_TOKEN_TYPE);
      }

      return sendError(res, AUTH_ERROR_CODES.SESSION_REFRESH_FAILED);
    }
  }

  async validateUserToken(req: Request, res: Response) {
    try {
      const auth_header = req.headers.authorization;

      if (!auth_header || !auth_header.startsWith('Bearer ')) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.MISSING_TOKEN);
      }

      const token = auth_header.substring(7);
      const verification = await tokenService.verifyUserAccessToken(token);

      if (!verification.valid) {
        return sendUnauthorized(res, verification.error || AUTH_ERROR_CODES.INVALID_TOKEN);
      }

      return sendSuccess(res, {
        valid: true,
        user_id: verification.payload?.user_id,
        email: verification.payload?.email,
        role: verification.payload?.role
      });
    } catch (error: any) {
      logger.error('User token validation error:', error);
      return sendError(res, AUTH_ERROR_CODES.AUTH_FAILED);
    }
  }

  async validateAdminToken(req: Request, res: Response) {
    try {
      const auth_header = req.headers.authorization;

      if (!auth_header || !auth_header.startsWith('Bearer ')) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.MISSING_TOKEN);
      }

      const token = auth_header.substring(7);
      const verification = await tokenService.verifyAdminAccessToken(token);

      if (!verification.valid) {
        return sendUnauthorized(res, verification.error || AUTH_ERROR_CODES.INVALID_TOKEN);
      }

      return sendSuccess(res, {
        valid: true,
        user_id: verification.payload?.user_id,
        email: verification.payload?.email,
        role: verification.payload?.role,
        is_admin: true
      });
    } catch (error: any) {
      logger.error('Admin token validation error:', error);
      return sendError(res, AUTH_ERROR_CODES.AUTH_FAILED);
    }
  }

  async getActiveSessions(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      const sessions = await sessionService.getActiveSessions(user_id);

      return sendSuccess(res, {
        sessions,
        count: sessions.length
      });
    } catch (error: any) {
      logger.error('Get sessions error:', error);
      return sendError(res, AUTH_ERROR_CODES.SESSION_INFO_FETCH_FAILED);
    }
  }

  async revokeSession(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const sessionId = req.params.sessionId as string;
      const device_context = extractDeviceContext(req);

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      if (!sessionId || Array.isArray(sessionId)) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Session ID is required');
      }

      const revoked = await sessionService.revokeSessionById(
        user_id,
        sessionId,
        device_context
      );

      if (!revoked) {
        return sendNotFound(res, AUTH_ERROR_CODES.SESSION_NOT_FOUND);
      }

      return sendSuccess(res, undefined, 'Session revoked successfully');
    } catch (error: any) {
      logger.error('Revoke session error:', error);
      return sendError(res, AUTH_ERROR_CODES.SESSION_REVOKE_FAILED);
    }
  }

  async revokeOtherSessions(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const device_context = extractDeviceContext(req);

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      await sessionService.revokeAllUserSessions(user_id, {
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent,
        reason: 'logout'
      });

      return sendSuccess(res, undefined, 'All other sessions revoked. Please login again.');
    } catch (error: any) {
      logger.error('Revoke other sessions error:', error);
      return sendError(res, AUTH_ERROR_CODES.SESSION_REVOKE_FAILED);
    }
  }

  async logout(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const { refresh_token } = req.body;
      const device_context = extractDeviceContext(req);

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      const access_token = extractBearerToken(req);
      if (access_token) {
        await blacklistAccessToken(access_token);
      }

      if (refresh_token) {
        await sessionService.revokeCurrentSession(
          user_id,
          refresh_token,
          device_context
        );
      }

      return sendSuccess(res, undefined, 'Logged out successfully');
    } catch (error: any) {
      logger.error('Logout error:', error);
      return sendSuccess(res, undefined, 'Logged out');
    }
  }

  async logoutAll(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const device_context = extractDeviceContext(req);

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      const access_token = extractBearerToken(req);
      if (access_token) {
        await blacklistAccessToken(access_token);
      }

      await sessionService.revokeAllUserSessions(user_id, {
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent,
        reason: 'logout'
      });

      return sendSuccess(res, undefined, 'Logged out from all devices');
    } catch (error: any) {
      logger.error('Logout all error:', error);
      return sendError(res, AUTH_ERROR_CODES.LOGOUT_FAILED);
    }
  }
}

export const tokenController = new TokenController();