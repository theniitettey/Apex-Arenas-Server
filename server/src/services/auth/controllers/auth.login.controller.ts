import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { twoFactorService } from '../services/auth.2fa.service';
import { AuthRequest } from '../middlewares/auth.jwt.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';
import { sendSuccess, sendError, sendUnauthorized, sendForbidden } from '../../../shared/utils/response.utils';
import { extractDeviceContext, getAuditMetadata } from '../../../shared/utils/request.utils';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes';

const logger = createLogger('auth-login-controller');

export class LoginController {

  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const device_context = extractDeviceContext(req);

      const login_result = await userService.loginUser({
        email,
        password,
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent
      });

      if (!login_result.success) {
        // Handle Google-only account trying to use password
        if (login_result.error_code === AUTH_ERROR_CODES.GOOGLE_ONLY_ACCOUNT) {
          return sendError(res, AUTH_ERROR_CODES.GOOGLE_ONLY_ACCOUNT, {
            has_google: true,
            can_add_password: true
          }, 'This account uses Google Sign-In. Please use Google to login or add a password in your account settings.');
        }

        if (login_result.error_code === AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED) {
          return sendForbidden(res, AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        }
        // Handle Google-only account trying to use password
        if (login_result.error_code === 'GOOGLE_ONLY_ACCOUNT') {
          return sendError(res, 'GOOGLE_ONLY_ACCOUNT', {
            has_google: true,
            can_add_password: true
          }, 'This account uses Google Sign-In. Please use Google to login or add a password in your account settings.');
        }
        if (login_result.error_code === AUTH_ERROR_CODES.TWO_FA_REQUIRED) {
          return sendSuccess(res, {
            requires_2fa: true,
            user_id: login_result.user?._id,
            two_factor_method: await this.get2FAMethod(login_result.user?._id?.toString())
          });
        }
        if (login_result.error_code === AUTH_ERROR_CODES.ACCOUNT_LOCKED) {
          return sendError(res, AUTH_ERROR_CODES.ACCOUNT_LOCKED, {
            is_locked: true,
            lock_until: login_result.lock_until
          });
        }
        if (login_result.error_code === AUTH_ERROR_CODES.ACCOUNT_BANNED) {
          return sendForbidden(res, AUTH_ERROR_CODES.ACCOUNT_BANNED);
        }
        return sendUnauthorized(res, login_result.error_code || AUTH_ERROR_CODES.INVALID_CREDENTIALS);
      }

      const user_data = {
        user_id: login_result.user?._id,
        email: login_result.user?.email,
        username: login_result.user?.username,
        role: login_result.user?.role,
        first_name: login_result.user?.profile.first_name,
        last_name: login_result.user?.profile.last_name,
        avatar_url: login_result.user?.profile.avatar_url
      };

      logger.info('User logged in successfully', {
        user_id: login_result.user?._id,
        email: login_result.user?.email,
        role: login_result.user?.role
      });

      return sendSuccess(res, {
        user: user_data,
        access_token: login_result.access_token,
        refresh_token: login_result.refresh_token
      });
    } catch (error: any) {
      logger.error('Login error:', error);
      return sendError(res, AUTH_ERROR_CODES.LOGIN_FAILED);
    }
  }

  async adminLogin(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const device_context = extractDeviceContext(req);

      const login_result = await userService.loginAdmin({
        email,
        password,
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent
      });

      if (!login_result.success) {
        if (login_result.error_code === AUTH_ERROR_CODES.TWO_FA_SETUP_REQUIRED) {
          const setup_data = await twoFactorService.setupTOTP(login_result.user?._id?.toString() || '');
          return sendSuccess(res, {
            requires_2fa_setup: true,
            user_id: login_result.user?._id,
            setup: {
              qr_code_data_url: setup_data.qr_code_data_url,
              manual_entry_key: setup_data.manual_entry_key,
              issuer: setup_data.issuer
            }
          });
        }
        if (login_result.error_code === AUTH_ERROR_CODES.TWO_FA_REQUIRED) {
          return sendSuccess(res, {
            requires_2fa: true,
            user_id: login_result.user?._id,
            two_factor_method: 'authenticator_app'
          });
        }
        if (login_result.error_code === AUTH_ERROR_CODES.TWO_FA_NOT_ENABLED) {
          return sendForbidden(res, AUTH_ERROR_CODES.TWO_FA_NOT_ENABLED);
        }
        if (login_result.error_code === AUTH_ERROR_CODES.ACCOUNT_LOCKED) {
          return sendError(res, AUTH_ERROR_CODES.ACCOUNT_LOCKED, {
            is_locked: true,
            lock_until: login_result.lock_until
          });
        }
        if (login_result.error_code === AUTH_ERROR_CODES.ADMIN_NOT_SETUP) {
          return sendError(res, AUTH_ERROR_CODES.ADMIN_NOT_SETUP, undefined, 'Admin account not set up. Please contact system administrator.');
        }
        return sendUnauthorized(res, login_result.error_code || AUTH_ERROR_CODES.INVALID_CREDENTIALS);
      }

      const admin_data = {
        user_id: login_result.user?._id,
        email: login_result.user?.email,
        username: login_result.user?.username,
        role: 'admin',
        first_name: login_result.user?.profile.first_name,
        last_name: login_result.user?.profile.last_name
      };

      logger.info('Admin logged in successfully', {
        user_id: login_result.user?._id,
        email: login_result.user?.email
      });

      return sendSuccess(res, {
        user: admin_data,
        access_token: login_result.access_token,
        refresh_token: login_result.refresh_token,
        is_admin: true
      });
    } catch (error: any) {
      logger.error('Admin login error:', error);
      return sendError(res, AUTH_ERROR_CODES.LOGIN_FAILED);
    }
  }

  async verify2FALogin(req: Request, res: Response) {
    try {
      const { user_id, code, use_backup_code } = req.body;
      const device_context = extractDeviceContext(req);

      if (!user_id || !code) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS);
      }

      const result = await userService.complete2FALogin(
        user_id,
        code,
        use_backup_code || false,
        device_context
      );

      if (!result.success) {
        return sendUnauthorized(res, result.error_code || AUTH_ERROR_CODES.TWO_FA_INVALID_CODE);
      }

      const user_data = {
        user_id: result.user?._id,
        email: result.user?.email,
        username: result.user?.username,
        role: result.user?.role,
        first_name: result.user?.profile.first_name,
        last_name: result.user?.profile.last_name
      };

      logger.info('2FA login completed', { user_id });

      return sendSuccess(res, {
        user: user_data,
        access_token: result.access_token,
        refresh_token: result.refresh_token
      });
    } catch (error: any) {
      logger.error('2FA login verification error:', error);
      return sendError(res, AUTH_ERROR_CODES.TWO_FA_VERIFICATION_FAILED);
    }
  }

  async verifyAdmin2FALogin(req: Request, res: Response) {
    try {
      const { user_id, code, use_backup_code } = req.body;
      const device_context = extractDeviceContext(req);

      if (!user_id || !code) {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS);
      }

      const result = await userService.completeAdmin2FALogin(
        user_id,
        code,
        use_backup_code || false,
        device_context
      );

      if (!result.success) {
        return sendUnauthorized(res, result.error_code || AUTH_ERROR_CODES.TWO_FA_INVALID_CODE);
      }

      const admin_data = {
        user_id: result.user?._id,
        email: result.user?.email,
        username: result.user?.username,
        role: 'admin',
        first_name: result.user?.profile.first_name,
        last_name: result.user?.profile.last_name
      };

      logger.info('Admin 2FA login completed', { user_id });

      return sendSuccess(res, {
        user: admin_data,
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        is_admin: true
      });
    } catch (error: any) {
      logger.error('Admin 2FA login verification error:', error);
      return sendError(res, AUTH_ERROR_CODES.ADMIN_2FA_VERIFICATION_FAILED);
    }
  }

  async verifyAdmin2FASetup(req: Request, res: Response) {
    try {
      // ADD THIS FIRST
      console.log('=== RAW REQUEST DEBUG ===');
      console.log('req.body:', JSON.stringify(req.body));
      console.log('req.body keys:', Object.keys(req.body));
      console.log('Content-Type:', req.headers['content-type']);
      console.log('req.method:', req.method);
      console.log('req.url:', req.url);
      console.log('========================');

      const { user_id, code } = req.body;
      const device_context = extractDeviceContext(req);

      // DETAILED VALIDATION WITH SPECIFIC ERROR MESSAGES
      if (!user_id && !code) {
        logger.error('2FA setup verification - both fields missing', { 
          body: req.body 
        });
        return sendError(
          res, 
          AUTH_ERROR_CODES.MISSING_FIELDS,
          undefined,
          'Both user_id and code are required'
        );
      }

      if (!user_id) {
        logger.error('2FA setup verification - user_id missing', { 
          body: req.body,
          received_code: !!code 
        });
        return sendError(
          res, 
          AUTH_ERROR_CODES.MISSING_FIELDS,
          undefined,
          'user_id is required'
        );
      }

      if (!code) {
        logger.error('2FA setup verification - code missing', { 
          body: req.body,
          received_user_id: !!user_id 
        });
        return sendError(
          res, 
          AUTH_ERROR_CODES.MISSING_FIELDS,
          undefined,
          'code is required (6-digit code from authenticator app)'
        );
      }

      // LOG WHAT WE RECEIVED FOR DEBUGGING
      logger.info('Attempting 2FA setup verification', {
        user_id,
        code_length: code.length,
        code_type: typeof code,
        has_device_context: !!device_context
      });

      const result = await twoFactorService.verifyTOTPSetup(
        user_id,
        code,
        device_context
      );

      if (!result.success) {
        logger.error('2FA setup verification failed', {
          user_id,
          error: result.error
        });

        return sendError(
          res,
          result.error || AUTH_ERROR_CODES.TWO_FA_SETUP_FAILED,
          undefined,
          result.error === AUTH_ERROR_CODES.TWO_FA_INVALID_CODE 
            ? 'Invalid verification code. Please try again with a fresh code from your authenticator app.' 
            : result.error === AUTH_ERROR_CODES.TWO_FA_NOT_INITIATED
            ? 'No 2FA setup found. Please scan the QR code first.'
            : 'Failed to verify 2FA setup. Please try again.'
        );
      }

      logger.info('Admin 2FA setup completed successfully', { 
        user_id,
        backup_codes_count: result.backup_codes?.length || 0
      });

      return sendSuccess(res, {
        enabled: true,
        backup_codes: result.backup_codes,
        message: 'Two-factor authentication has been enabled successfully. Save your backup codes in a safe place!'
      });
    } catch (error: any) {
      logger.error('Admin 2FA setup verification error:', {
        error: error.message,
        stack: error.stack,
        body: req.body
      });
      return sendError(
        res, 
        AUTH_ERROR_CODES.TWO_FA_SETUP_FAILED,
        undefined,
        'An unexpected error occurred during 2FA setup verification'
      );
    }
  }

  async getAuthStatus(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
      }

      const user = await userService.getUserProfile(user_id);

      if (!user) {
        return sendError(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      const user_data = {
        user_id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
        first_name: user.profile.first_name,
        last_name: user.profile.last_name,
        avatar_url: user.profile.avatar_url,
        is_verified: user.verification_status.email_verified,
        is_active: user.is_active,
        last_login: user.last_login,
        created_at: user.created_at
      };

      return sendSuccess(res, {
        authenticated: true,
        user: user_data
      });
    } catch (error: any) {
      logger.error('Get auth status error:', error);
      return sendError(res, AUTH_ERROR_CODES.AUTH_CHECK_FAILED);
    }
  }

  private async get2FAMethod(user_id: string | undefined): Promise<string> {
    if (!user_id) return 'none';
    
    try {
      const status = await twoFactorService.getStatus(user_id);
      return status.method;
    } catch {
      return 'authenticator_app';
    }
  }
}

export const loginController = new LoginController();