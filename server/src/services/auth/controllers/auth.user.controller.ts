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

      const is_valid = await PasswordService.comparePassword(password, user.password_hash as string);
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

  // ============================================
  // ORGANIZER VERIFICATION
  // ============================================

  async requestOrganizerVerification(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const device_context = extractDeviceContext(req);

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      const { business_name, business_type, registration_number, tax_id, address, contact_person } = req.body;

      // Validate required fields
      if (!business_name || !business_type || !address || !contact_person) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Business name, type, address, and contact person are required');
      }

      // Get uploaded files from multer
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      if (!files?.id_front?.[0] || !files?.id_back?.[0] || !files?.selfie_with_id?.[0]) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'ID front, ID back, and selfie with ID are required');
      }

      const verification_data = {
        business_info: {
          business_name,
          business_type,
          registration_number,
          tax_id,
          address,
          contact_person
        },
        documents: {
          id_front: files.id_front[0].buffer,
          id_back: files.id_back[0].buffer,
          selfie_with_id: files.selfie_with_id[0].buffer,
          business_registration: files.business_registration?.[0]?.buffer,
          utility_bill: files.utility_bill?.[0]?.buffer
        },
        file_metadata: {
          id_front: { mimetype: files.id_front[0].mimetype, size: files.id_front[0].size },
          id_back: { mimetype: files.id_back[0].mimetype, size: files.id_back[0].size },
          selfie_with_id: { mimetype: files.selfie_with_id[0].mimetype, size: files.selfie_with_id[0].size },
          business_registration: files.business_registration?.[0] ? { mimetype: files.business_registration[0].mimetype, size: files.business_registration[0].size } : undefined,
          utility_bill: files.utility_bill?.[0] ? { mimetype: files.utility_bill[0].mimetype, size: files.utility_bill[0].size } : undefined
        }
      };

      const result = await userService.requestOrganizerVerification(user_id, verification_data, device_context);

      if (!result.success) {
        return sendError(res, result.error_code || AUTH_ERROR_CODES.INTERNAL_ERROR, undefined, result.error);
      }

      return sendSuccess(res, {
        request_id: result.request_id
      }, 'Verification request submitted successfully. You will be notified once reviewed.');

    } catch (error: any) {
      logger.error('Request organizer verification error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  async getVerificationStatus(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      const status = await userService.getVerificationStatus(user_id);
      return sendSuccess(res, status);

    } catch (error: any) {
      logger.error('Get verification status error:', error);
      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }

  /**
   * POST /auth/user/add-password
   * Add password to Google-only account
   */
  async addPassword(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const { password } = req.body;
      const device_context = extractDeviceContext(req);

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      if (!password) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Password is required');
      }

      const result = await userService.addPasswordToAccount(user_id, password, device_context);

      if (!result.success) {
        return sendError(res, result.error_code || AUTH_ERROR_CODES.INTERNAL_ERROR, undefined, result.error);
      }

      return sendSuccess(res, { password_added: true }, 'Password added successfully. You can now login with email and password.');
    } catch (error: any) {
      logger.error('Add password error:', error);
      return sendError(res, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * GET /auth/user/auth-methods
   * Get user's available authentication methods
   */
  async getAuthMethods(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      const user = await userService.getUserProfile(user_id);
      if (!user) {
        return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      const has_password = !!user.password_hash;
      const has_google = user.auth_providers?.some(p => p.provider === 'google') || false;

      return sendSuccess(res, {
        has_password,
        has_google,
        providers: user.auth_providers?.map(p => ({
          provider: p.provider,
          linked_at: p.linked_at,
          is_primary: p.is_primary
        })) || []
      });
    } catch (error: any) {
      logger.error('Get auth methods error:', error);
      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }
}

export const userController = new UserController();