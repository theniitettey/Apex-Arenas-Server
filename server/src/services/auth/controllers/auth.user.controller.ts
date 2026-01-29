import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { PasswordService } from '../services/auth.password.service';
import { AuthRequest } from '../middlewares/auth.jwt.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-user-controller');

export class UserController {
  /**
   * GET /auth/user/profile
   * Get authenticated user's profile
   */
  async getProfile(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;

      if (!user_id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          error_code: 'AUTH_REQUIRED'
        });
      }

      const user = await userService.getUserProfile(user_id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          error_code: 'USER_NOT_FOUND'
        });
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

      res.json({
        success: true,
        data: user_data
      });
    } catch (error: any) {
      logger.error('Get profile error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to get profile',
        error_code: 'PROFILE_FETCH_FAILED'
      });
    }
  }

  /**
   * PUT /auth/user/profile
   * Update authenticated user's profile
   */
  async updateProfile(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const updates = req.body;
      const ip_address = req.ip || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      if (!user_id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          error_code: 'AUTH_REQUIRED'
        });
      }

      const user = await userService.updateUserProfile(
        user_id,
        updates,
        { ip_address, user_agent }
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

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: user_data
      });
    } catch (error: any) {
      logger.error('Update profile error:', error);

      if (error.message === 'USER_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          error_code: 'USER_NOT_FOUND'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update profile',
        error_code: 'PROFILE_UPDATE_FAILED'
      });
    }
  }

  /**
   * POST /auth/user/deactivate
   * Deactivate own account (requires password confirmation)
   */
  async deactivateAccount(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const { password } = req.body;
      const ip_address = req.ip || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      if (!user_id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          error_code: 'AUTH_REQUIRED'
        });
      }

      if (!password) {
        return res.status(400).json({
          success: false,
          error: 'Password confirmation required',
          error_code: 'PASSWORD_REQUIRED'
        });
      }

      // Get user with password hash
      const user = await userService.getUserProfile(user_id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          error_code: 'USER_NOT_FOUND'
        });
      }

      // Verify password
      const is_valid = await PasswordService.comparePassword(password, user.password_hash);
      if (!is_valid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid password',
          error_code: 'INVALID_PASSWORD'
        });
      }

      await userService.deactivateAccount(user_id, { ip_address, user_agent });

      res.json({
        success: true,
        message: 'Account deactivated successfully'
      });
    } catch (error: any) {
      logger.error('Deactivate account error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to deactivate account',
        error_code: 'DEACTIVATION_FAILED'
      });
    }
  }
}

export const userController = new UserController();
