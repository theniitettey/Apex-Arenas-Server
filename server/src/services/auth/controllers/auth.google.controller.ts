import { Request, Response } from 'express';
import { googleAuthService } from '../services/auth.google.service';
import { createLogger } from '../../../shared/utils/logger.utils';
import { sendSuccess, sendError, sendUnauthorized, sendCreated } from '../../../shared/utils/response.utils';
import { extractDeviceContext } from '../../../shared/utils/request.utils';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes';

const logger = createLogger('auth-google-controller');

export class GoogleAuthController {
  /**
   * POST /auth/google
   * Authenticate or register with Google
   */
  async googleAuth(req: Request, res: Response) {
    try {
      const { id_token, role } = req.body;
      const device_context = extractDeviceContext(req);

      if (!id_token) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Google ID token is required');
      }

      // Validate role if provided
      if (role && !['player', 'organizer'].includes(role)) {
        return sendError(res, AUTH_ERROR_CODES.INVALID_ROLE);
      }

      const result = await googleAuthService.authenticateWithGoogle(
        id_token,
        device_context,
        role
      );

      if (!result.success) {
        // Special case: account exists but needs password to link
        if (result.error_code === AUTH_ERROR_CODES.ACCOUNT_EXISTS_LINK_REQUIRED) {
          return sendError(res, result.error_code, {
            requires_password: true,
            email: result.user?.email
          }, result.error);
        }

        return sendUnauthorized(res, result.error_code || AUTH_ERROR_CODES.GOOGLE_AUTH_FAILED);
      }

      const user_data = {
        user_id: result.user?._id,
        email: result.user?.email,
        username: result.user?.username,
        role: result.user?.role,
        first_name: result.user?.profile.first_name,
        last_name: result.user?.profile.last_name,
        avatar_url: result.user?.profile.avatar_url,
        is_new_user: result.is_new_user
      };

      const message = result.is_new_user
        ? 'Account created successfully with Google'
        : 'Logged in successfully with Google';

      if (result.is_new_user) {
        return sendCreated(res, {
          user: user_data,
          access_token: result.access_token,
          refresh_token: result.refresh_token
        }, message);
      }

      return sendSuccess(res, {
        user: user_data,
        access_token: result.access_token,
        refresh_token: result.refresh_token
      }, message);
    } catch (error: any) {
      logger.error('Google auth error:', error);
      return sendError(res, AUTH_ERROR_CODES.GOOGLE_AUTH_FAILED);
    }
  }

  /**
   * POST /auth/google/link
   * Link Google account to existing account with password confirmation
   */
  async linkGoogleAccount(req: Request, res: Response) {
    try {
      const { id_token, password } = req.body;
      const device_context = extractDeviceContext(req);

      if (!id_token || !password) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Google ID token and password are required');
      }

      const result = await googleAuthService.linkGoogleWithPassword(
        id_token,
        password,
        device_context
      );

      if (!result.success) {
        if (result.error_code === AUTH_ERROR_CODES.INVALID_CREDENTIALS) {
          return sendUnauthorized(res, result.error_code);
        }
        return sendError(res, result.error_code || AUTH_ERROR_CODES.GOOGLE_LINK_FAILED, undefined, result.error);
      }

      const user_data = {
        user_id: result.user?._id,
        email: result.user?.email,
        username: result.user?.username,
        role: result.user?.role,
        first_name: result.user?.profile.first_name,
        last_name: result.user?.profile.last_name,
        avatar_url: result.user?.profile.avatar_url
      };

      return sendSuccess(res, {
        user: user_data,
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        google_linked: true
      }, 'Google account linked successfully');
    } catch (error: any) {
      logger.error('Google link error:', error);
      return sendError(res, AUTH_ERROR_CODES.GOOGLE_LINK_FAILED);
    }
  }
}

export const googleAuthController = new GoogleAuthController();
