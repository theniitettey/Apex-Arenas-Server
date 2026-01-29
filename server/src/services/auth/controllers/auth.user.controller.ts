import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { PasswordService } from '../services/auth.password.service';
import { AuthRequest } from '../middlewares/auth.jwt.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';
import { sendSuccess, sendError, sendUnauthorized, sendNotFound } from '../../../shared/utils/response.utils';
import { extractDeviceContext } from '../../../shared/utils/request.utils';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes';

const logger = createLogger('auth-user-controller');

export class UserController {

  async getProfile(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      const user = await userService.getUserProfile(user_id);

      if (!user) {
        return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      const user_data = {
        user_id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
        profile: {
          first_name: user.profile.first_name,
          last_name: user.profile.last_name,
          bio: user.profile.bio,
          avatar_url: user.profile.avatar_url,
          phone_number: user.profile.phone_number,
          country: user.profile.country,
          social_links: user.profile.social_links
        },
        verification_status: user.verification_status,
        is_active: user.is_active,
        last_login: user.last_login,
        created_at: user.created_at
      };

      return sendSuccess(res, user_data);
    } catch (error: any) {
      logger.error('Get profile error:', error);
      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }

  async updateProfile(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const updates = req.body;
      const device_context = extractDeviceContext(req);

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      const user = await userService.updateUserProfile(
        user_id,
        updates,
        device_context
      );

      const user_data = {
        user_id: user._id,
        email: user.email,
        username: user.username,
        profile: {
          first_name: user.profile.first_name,
          last_name: user.profile.last_name,
          bio: user.profile.bio,
          avatar_url: user.profile.avatar_url,
          phone_number: user.profile.phone_number,
          country: user.profile.country,
          social_links: user.profile.social_links
        }
      };

      return sendSuccess(res, user_data, 'Profile updated successfully');
    } catch (error: any) {
      logger.error('Update profile error:', error);

      if (error.message === 'USER_NOT_FOUND') {
        return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async deactivateAccount(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const { password } = req.body;
      const device_context = extractDeviceContext(req);

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      if (!password) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Password confirmation required');
      }

      const user = await userService.getUserProfile(user_id);
      if (!user) {
        return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      const is_valid = await PasswordService.comparePassword(password, user.password_hash);
      if (!is_valid) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.INVALID_CURRENT_PASSWORD);
      }

      await userService.deactivateAccount(user_id, device_context);

      return sendSuccess(res, undefined, 'Account deactivated successfully');
    } catch (error: any) {
      logger.error('Deactivate account error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }
}

export const userController = new UserController();