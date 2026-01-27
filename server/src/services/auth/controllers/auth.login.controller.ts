import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { twoFactorService } from '../services/auth.2fa.service';
import { AuditService } from '../services/auth.audit.service';
import { AuthRequest } from '../middlewares/auth.jwt.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-login-controller');

/**
 * Login Controller
 * Handles user and admin login, 2FA verification, and auth status
 */

export class LoginController {

  // ============================================
  // USER LOGIN
  // ============================================

  /**
   * POST /auth/login
   * User login with email and password (players/organizers)
   */
  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const ip_address = (req.ip as string) || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      // Attempt login via user service
      const login_result = await userService.loginUser({
        email,
        password,
        ip_address,
        user_agent
      });

      // Handle unsuccessful login
      if (!login_result.success) {
        // Handle email not verified
        if (login_result.error_code === 'EMAIL_NOT_VERIFIED') {
          return res.status(403).json({
            success: false,
            error: 'Please verify your email before logging in',
            error_code: 'EMAIL_NOT_VERIFIED',
            data: {
              requires_verification: true,
              user_id: login_result.user?._id
            }
          });
        }

        // Handle 2FA required
        if (login_result.error_code === '2FA_REQUIRED') {
          return res.status(200).json({
            success: false,
            error: '2FA verification required',
            error_code: '2FA_REQUIRED',
            data: {
              requires_2fa: true,
              user_id: login_result.user?._id,
              // Get 2FA status to know which method
              two_factor_method: await this.get2FAMethod(login_result.user?._id.toString())
            }
          });
        }

        // Handle account locked
        if (login_result.error_code === 'ACCOUNT_LOCKED') {
          return res.status(423).json({
            success: false,
            error: 'Account is temporarily locked due to too many failed attempts',
            error_code: 'ACCOUNT_LOCKED',
            data: {
              is_locked: true,
              lock_until: login_result.lock_until
            }
          });
        }

        // Handle banned
        if (login_result.error_code === 'ACCOUNT_BANNED') {
          return res.status(403).json({
            success: false,
            error: login_result.error || 'Account is banned',
            error_code: 'ACCOUNT_BANNED'
          });
        }

        // Generic login failure
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password',
          error_code: login_result.error_code || 'INVALID_CREDENTIALS'
        });
      }

      // Successful login - return tokens
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

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: user_data,
          access_token: login_result.access_token,
          refresh_token: login_result.refresh_token
        }
      });
    } catch (error: any) {
      logger.error('Login error:', error);

      res.status(500).json({
        success: false,
        error: 'Login failed. Please try again.',
        error_code: 'LOGIN_FAILED'
      });
    }
  }

  // ============================================
  // ADMIN LOGIN
  // ============================================

  /**
   * POST /auth/admin/login
   * Admin login with enhanced security
   */
  async adminLogin(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const ip_address = (req.ip as string) || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      // Attempt admin login via user service
      const login_result = await userService.loginAdmin({
        email,
        password,
        ip_address,
        user_agent
      });

      // Handle unsuccessful login
      if (!login_result.success) {
        // Handle 2FA setup required
        if (login_result.error_code === '2FA_SETUP_REQUIRED') {
          // Generate 2FA setup data
          const setup_data = await twoFactorService.setupTOTP(login_result.user?._id.toString() || '');

          return res.status(200).json({
            success: false,
            error: 'Please complete 2FA setup to continue',
            error_code: '2FA_SETUP_REQUIRED',
            data: {
              requires_2fa_setup: true,
              user_id: login_result.user?._id,
              setup: {
                qr_code_data_url: setup_data.qr_code_data_url,
                manual_entry_key: setup_data.manual_entry_key,
                issuer: setup_data.issuer
              }
            }
          });
        }

        // Handle 2FA required
        if (login_result.error_code === '2FA_REQUIRED') {
          return res.status(200).json({
            success: false,
            error: '2FA verification required',
            error_code: '2FA_REQUIRED',
            data: {
              requires_2fa: true,
              user_id: login_result.user?._id,
              two_factor_method: 'authenticator_app'
            }
          });
        }

        // Handle 2FA not enabled (required for admin)
        if (login_result.error_code === '2FA_NOT_ENABLED') {
          return res.status(403).json({
            success: false,
            error: '2FA must be enabled for admin accounts. Please contact super admin.',
            error_code: '2FA_NOT_ENABLED'
          });
        }

        // Handle account locked
        if (login_result.error_code === 'ACCOUNT_LOCKED') {
          return res.status(423).json({
            success: false,
            error: 'Admin account is temporarily locked',
            error_code: 'ACCOUNT_LOCKED',
            data: {
              is_locked: true,
              lock_until: login_result.lock_until
            }
          });
        }

        // Handle admin not setup
        if (login_result.error_code === 'ADMIN_NOT_SETUP') {
          return res.status(404).json({
            success: false,
            error: 'Admin account not set up. Please contact system administrator.',
            error_code: 'ADMIN_NOT_SETUP'
          });
        }

        // Generic login failure
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials',
          error_code: login_result.error_code || 'INVALID_CREDENTIALS'
        });
      }

      // Successful admin login
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

      res.json({
        success: true,
        message: 'Admin login successful',
        data: {
          user: admin_data,
          access_token: login_result.access_token,
          refresh_token: login_result.refresh_token,
          is_admin: true
        }
      });
    } catch (error: any) {
      logger.error('Admin login error:', error);

      res.status(500).json({
        success: false,
        error: 'Login failed',
        error_code: 'LOGIN_FAILED'
      });
    }
  }

  // ============================================
  // 2FA VERIFICATION (Login Completion)
  // ============================================

  /**
   * POST /auth/login/2fa
   * Complete user login with 2FA code
   */
  async verify2FALogin(req: Request, res: Response) {
    try {
      const { user_id, code, use_backup_code } = req.body;
      const ip_address = (req.ip as string) || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      if (!user_id || !code) {
        return res.status(400).json({
          success: false,
          error: 'User ID and code are required',
          error_code: 'MISSING_FIELDS'
        });
      }

      // Complete 2FA login via user service
      const result = await userService.complete2FALogin(
        user_id,
        code,
        use_backup_code || false,
        { ip_address, user_agent }
      );

      if (!result.success) {
        return res.status(401).json({
          success: false,
          error: result.error || 'Invalid verification code',
          error_code: result.error_code || 'INVALID_CODE'
        });
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

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: user_data,
          access_token: result.access_token,
          refresh_token: result.refresh_token
        }
      });
    } catch (error: any) {
      logger.error('2FA login verification error:', error);

      res.status(500).json({
        success: false,
        error: 'Verification failed',
        error_code: '2FA_VERIFICATION_FAILED'
      });
    }
  }

  /**
   * POST /auth/admin/login/2fa
   * Complete admin login with 2FA code
   */
  async verifyAdmin2FALogin(req: Request, res: Response) {
    try {
      const { user_id, code, use_backup_code } = req.body;
      const ip_address = (req.ip as string) || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      if (!user_id || !code) {
        return res.status(400).json({
          success: false,
          error: 'User ID and code are required',
          error_code: 'MISSING_FIELDS'
        });
      }

      // Complete admin 2FA login
      const result = await userService.completeAdmin2FALogin(
        user_id,
        code,
        use_backup_code || false,
        { ip_address, user_agent }
      );

      if (!result.success) {
        return res.status(401).json({
          success: false,
          error: result.error || 'Invalid verification code',
          error_code: result.error_code || 'INVALID_CODE'
        });
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

      res.json({
        success: true,
        message: 'Admin login successful',
        data: {
          user: admin_data,
          access_token: result.access_token,
          refresh_token: result.refresh_token,
          is_admin: true
        }
      });
    } catch (error: any) {
      logger.error('Admin 2FA login verification error:', error);

      res.status(500).json({
        success: false,
        error: 'Verification failed',
        error_code: 'ADMIN_2FA_VERIFICATION_FAILED'
      });
    }
  }

  /**
   * POST /auth/admin/2fa/setup/verify
   * Verify admin 2FA setup and enable 2FA
   */
  async verifyAdmin2FASetup(req: Request, res: Response) {
    try {
      const { user_id, code } = req.body;
      const ip_address = (req.ip as string) || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      if (!user_id || !code) {
        return res.status(400).json({
          success: false,
          error: 'User ID and code are required',
          error_code: 'MISSING_FIELDS'
        });
      }

      // Verify 2FA setup
      const result = await twoFactorService.verifyTOTPSetup(
        user_id,
        code,
        { ip_address, user_agent }
      );

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error === 'INVALID_CODE'
            ? 'Invalid verification code. Please try again.'
            : 'Setup verification failed',
          error_code: result.error || '2FA_SETUP_FAILED'
        });
      }

      logger.info('Admin 2FA setup completed', { user_id });

      res.json({
        success: true,
        message: '2FA enabled successfully. Please save your backup codes.',
        data: {
          enabled: true,
          backup_codes: result.backup_codes
        }
      });
    } catch (error: any) {
      logger.error('Admin 2FA setup verification error:', error);

      res.status(500).json({
        success: false,
        error: 'Setup verification failed',
        error_code: '2FA_SETUP_FAILED'
      });
    }
  }

  // ============================================
  // AUTH STATUS
  // ============================================

  /**
   * GET /auth/me
   * Get current authenticated user's profile
   */
  async getAuthStatus(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;

      if (!user_id) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated',
          error_code: 'NOT_AUTHENTICATED'
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
        first_name: user.profile.first_name,
        last_name: user.profile.last_name,
        avatar_url: user.profile.avatar_url,
        is_verified: user.verification_status.email_verified,
        is_active: user.is_active,
        last_login: user.last_login,
        created_at: user.created_at
      };

      res.json({
        success: true,
        data: {
          authenticated: true,
          user: user_data
        }
      });
    } catch (error: any) {
      logger.error('Get auth status error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to get authentication status',
        error_code: 'AUTH_CHECK_FAILED'
      });
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  /**
   * Get 2FA method for user
   */
  private async get2FAMethod(user_id: string | undefined): Promise<string> {
    if (!user_id) return 'none';
    
    try {
      const status = await twoFactorService.getStatus(user_id);
      return status.method;
    } catch {
      return 'authenticator_app'; // Default assumption
    }
  }
}

export const loginController = new LoginController();
