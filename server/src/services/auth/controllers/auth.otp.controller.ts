import { Request, Response } from 'express';
import { otpService } from '../services/auth.otp.service';
import { userService } from '../services/auth.user.service';
import { AuditService } from '../services/auth.audit.service';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-otp-controller');

// Valid OTP types
const VALID_OTP_TYPES = [
  'email_verification',
  'password_reset',
  'phone_verification',
  '2fa_login',
  'withdrawal_confirmation'
] as const;

type OTPType = typeof VALID_OTP_TYPES[number];

export class OTPController {
  /**
   * Generate OTP for various purposes
   * POST /auth/otp/generate
   */
  async generateOTP(req: Request, res: Response): Promise<void> {
    try {
      const { email, type } = req.body;
      const ip_address = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const user_agent = req.get('User-Agent') || 'unknown';

      // Validate required fields
      if (!email || !type) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'Email and OTP type are required'
          }
        });
        return;
      }

      // Validate OTP type
      if (!VALID_OTP_TYPES.includes(type as OTPType)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_OTP_TYPE',
            message: `Invalid OTP type. Must be one of: ${VALID_OTP_TYPES.join(', ')}`
          }
        });
        return;
      }

      // Get user by email
      const user = await userService.getUserByEmail(email);

      // For security, don't reveal if user exists
      if (!user) {
        logger.warn('OTP generation attempt for non-existent email', { email, type, ip_address });
        res.json({
          success: true,
          message: 'If the email exists, an OTP has been sent'
        });
        return;
      }

      // Check rate limit for OTP requests
      const can_request = await otpService.canRequestOTP(user._id.toString(), type);
      if (!can_request.allowed) {
        res.status(429).json({
          success: false,
          error: {
            code: 'OTP_COOLDOWN',
            message: `Please wait ${can_request.wait_seconds} seconds before requesting a new OTP`
          },
          data: {
            wait_seconds: can_request.wait_seconds
          }
        });
        return;
      }

      // Generate OTP
      const { otp_id } = await otpService.generateOTP({
        user_id: user._id.toString(),
        type: type as OTPType,
        metadata: {
          ip_address,
          user_agent,
          request_reason: 'user_requested'
        }
      });

      logger.info('OTP generated successfully', { user_id: user._id, type });

      // Return otp_id only for 2fa_login type (needed for verification flow)
      res.json({
        success: true,
        message: 'If the email exists, an OTP has been sent',
        data: type === '2fa_login' ? { otp_id } : undefined
      });

    } catch (error: any) {
      logger.error('OTP generation error:', error);

      // Still return success to prevent email enumeration
      res.json({
        success: true,
        message: 'If the email exists, an OTP has been sent'
      });
    }
  }

  /**
   * Verify OTP
   * POST /auth/otp/verify
   */
  async verifyOTP(req: Request, res: Response): Promise<void> {
    try {
      const { email, otp, type } = req.body;
      const ip_address = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const user_agent = req.get('User-Agent') || 'unknown';

      // Validate required fields
      if (!email || !otp || !type) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'Email, OTP, and type are required'
          }
        });
        return;
      }

      // Validate OTP type
      if (!VALID_OTP_TYPES.includes(type as OTPType)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_OTP_TYPE',
            message: 'Invalid OTP type'
          }
        });
        return;
      }

      // Get user by email
      const user = await userService.getUserByEmail(email);
      if (!user) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_VERIFICATION_REQUEST',
            message: 'Invalid verification request'
          }
        });
        return;
      }

      // Verify OTP
      const verification_result = await otpService.verifyOTP({
        user_id: user._id.toString(),
        otp,
        type: type as OTPType,
        metadata: {
          ip_address,
          user_agent
        }
      });

      if (!verification_result.valid) {
        const error_messages: Record<string, string> = {
          'OTP_NOT_FOUND_OR_EXPIRED': 'OTP not found or has expired',
          'OTP_MAX_ATTEMPTS_EXCEEDED': 'Too many failed attempts. Please request a new OTP',
          'INVALID_OTP': 'Invalid OTP code',
          'OTP_VERIFICATION_FAILED': 'OTP verification failed'
        };

        res.status(400).json({
          success: false,
          error: {
            code: verification_result.error || 'INVALID_OTP',
            message: error_messages[verification_result.error || ''] || 'Invalid OTP'
          }
        });
        return;
      }

      // Handle different OTP types
      let additional_data: Record<string, any> = {};

      switch (type) {
        case 'email_verification':
          await userService.verifyUserEmail(user._id.toString());
          additional_data = { email_verified: true };
          logger.info('Email verified via OTP', { user_id: user._id });
          break;

        case 'password_reset':
          // Password reset token will be handled by password reset flow
          additional_data = { can_reset_password: true };
          break;

        case '2fa_login':
          additional_data = { two_factor_verified: true };
          break;

        case 'withdrawal_confirmation':
          additional_data = { withdrawal_authorized: true };
          break;

        case 'phone_verification':
          additional_data = { phone_verified: true };
          break;
      }

      res.json({
        success: true,
        message: 'OTP verified successfully',
        data: {
          verified: true,
          type,
          ...additional_data
        }
      });

    } catch (error: any) {
      logger.error('OTP verification error:', error);

      res.status(500).json({
        success: false,
        error: {
          code: 'OTP_VERIFICATION_FAILED',
          message: 'OTP verification failed'
        }
      });
    }
  }

  /**
   * Resend OTP
   * POST /auth/otp/resend
   */
  async resendOTP(req: Request, res: Response): Promise<void> {
    try {
      const { email, type } = req.body;
      const ip_address = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const user_agent = req.get('User-Agent') || 'unknown';

      // Validate required fields
      if (!email || !type) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'Email and OTP type are required'
          }
        });
        return;
      }

      // Validate OTP type
      if (!VALID_OTP_TYPES.includes(type as OTPType)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_OTP_TYPE',
            message: 'Invalid OTP type'
          }
        });
        return;
      }

      // Get user by email
      const user = await userService.getUserByEmail(email);

      // For security, don't reveal if user exists
      if (!user) {
        logger.warn('OTP resend attempt for non-existent email', { email, type, ip_address });
        res.json({
          success: true,
          message: 'If the email exists, an OTP has been sent'
        });
        return;
      }

      // Check rate limit for OTP requests
      const can_request = await otpService.canRequestOTP(user._id.toString(), type);
      if (!can_request.allowed) {
        res.status(429).json({
          success: false,
          error: {
            code: 'OTP_COOLDOWN',
            message: `Please wait ${can_request.wait_seconds} seconds before requesting a new OTP`
          },
          data: {
            wait_seconds: can_request.wait_seconds
          }
        });
        return;
      }

      // Generate new OTP (this also invalidates previous OTPs)
      await otpService.generateOTP({
        user_id: user._id.toString(),
        type: type as OTPType,
        metadata: {
          ip_address,
          user_agent,
          request_reason: 'resend_requested'
        }
      });

      logger.info('OTP resent successfully', { user_id: user._id, type });

      res.json({
        success: true,
        message: 'If the email exists, an OTP has been sent'
      });

    } catch (error: any) {
      logger.error('OTP resend error:', error);

      // Still return success to prevent email enumeration
      res.json({
        success: true,
        message: 'If the email exists, an OTP has been sent'
      });
    }
  }

  /**
   * Get remaining OTP attempts
   * GET /auth/otp/attempts/:type
   */
  async getRemainingAttempts(req: Request, res: Response): Promise<void> {
    try {
      const { type } = req.params;
      const user = (req as any).user;

      if (!user) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        });
        return;
      }

      if (!VALID_OTP_TYPES.includes(type as OTPType)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_OTP_TYPE',
            message: 'Invalid OTP type'
          }
        });
        return;
      }

      const remaining = await otpService.getRemainingAttempts(user.user_id, type as string);

      res.json({
        success: true,
        data: {
          remaining_attempts: remaining,
          type
        }
      });

    } catch (error: any) {
      logger.error('Get remaining attempts error:', error);

      res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to get remaining attempts'
        }
      });
    }
  }

  /**
   * Check if user can request OTP
   * GET /auth/otp/can-request/:type
   */
  async canRequestOTP(req: Request, res: Response): Promise<void> {
    try {
      const { type } = req.params;
      const { email } = req.query;

      if (!email || !type) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'Email and type are required'
          }
        });
        return;
      }

      if (!VALID_OTP_TYPES.includes(type as OTPType)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_OTP_TYPE',
            message: 'Invalid OTP type'
          }
        });
        return;
      }

      const user = await userService.getUserByEmail(email as string);

      // Don't reveal if user exists
      if (!user) {
        res.json({
          success: true,
          data: {
            allowed: true
          }
        });
        return;
      }

      const can_request = await otpService.canRequestOTP(user._id.toString(), type as string);

      res.json({
        success: true,
        data: {
          allowed: can_request.allowed,
          wait_seconds: can_request.wait_seconds
        }
      });

    } catch (error: any) {
      logger.error('Can request OTP check error:', error);

      res.status(500).json({
        success: false,
        error: {
          code: 'CHECK_FAILED',
          message: 'Failed to check OTP availability'
        }
      });
    }
  }
}

export const otpController = new OTPController();
