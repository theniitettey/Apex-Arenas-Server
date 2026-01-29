import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { otpService } from '../services/auth.otp.service';
import { AuditService } from '../services/auth.audit.service';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-register-controller');

/**
 * Register Controller
 * Handles user registration, email verification, and availability checks
 */

export class RegisterController {

  // ============================================
  // USER REGISTRATION
  // ============================================

  /**
   * POST /auth/register
   * Register a new user (player or organizer)
   */
  async register(req: Request, res: Response) {
    try {
      const { email, username, password, first_name, last_name, role } = req.body;
      const ip_address = (req.ip as string) || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      // Register user via user service
      const user = await userService.registerUser(
        {
          email,
          username,
          password,
          first_name,
          last_name,
          role: role || 'player'
        },
        {
          ip_address,
          user_agent
        }
      );

      // Generate email verification OTP (this now sends the email automatically)
      const { otp_id } = await otpService.generateOTP({
        user_id: user._id.toString(),
        type: 'email_verification',
        metadata: {
          ip_address,
          user_agent,
          request_reason: 'registration'
        }
      });

      logger.info('Registration successful, verification email sent', {
        user_id: user._id.toString(),
        email: user.email,
        otp_id
      });

      // Return user data (excluding sensitive information)
      const user_data = {
        user_id: user._id,
        email: user.email,
        username: user.username,
        first_name: user.profile.first_name,
        last_name: user.profile.last_name,
        role: user.role,
        created_at: user.created_at
      };

      res.status(201).json({
        success: true,
        message: 'Registration successful. Please check your email for verification code.',
        data: {
          user: user_data,
          requires_verification: true
        }
      });
    } catch (error: any) {
      logger.error('Registration error:', error);

      // SECURITY FIX: Use generic error message for email/username conflicts
      // to prevent enumeration attacks
      if (error.message === 'EMAIL_ALREADY_EXISTS' || error.message === 'USERNAME_ALREADY_EXISTS') {
        // Log the specific reason internally for debugging
        logger.warn('Registration conflict', { 
          reason: error.message,
          ip: req.ip 
        });
        
        // Return generic message to prevent enumeration
        return res.status(400).json({
          success: false,
          error: 'Unable to create account with the provided details. Please try different credentials.',
          error_code: 'REGISTRATION_FAILED'
        });
      }

      if (error.message.startsWith('WEAK_PASSWORD')) {
        const errors = error.message.replace('WEAK_PASSWORD:', '').split('|');
        return res.status(400).json({
          success: false,
          error: 'Password does not meet requirements',
          error_code: 'WEAK_PASSWORD',
          details: errors
        });
      }

      if (error.message === 'PASSWORD_COMPROMISED') {
        return res.status(400).json({
          success: false,
          error: 'This password has been found in data breaches. Please choose a different one.',
          error_code: 'PASSWORD_COMPROMISED'
        });
      }

      if (error.message === 'INVALID_ROLE') {
        return res.status(400).json({
          success: false,
          error: 'Invalid role specified',
          error_code: 'INVALID_ROLE'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Registration failed. Please try again.',
        error_code: 'REGISTRATION_FAILED'
      });
    }
  }

  // ============================================
  // EMAIL VERIFICATION
  // ============================================

  /**
   * POST /auth/verify-email
   * Verify email with OTP after registration
   */
  async verifyEmail(req: Request, res: Response) {
    try {
      const { email, otp } = req.body;
      const ip_address = (req.ip as string) || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      // Find user by email
      const user = await userService.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          error_code: 'USER_NOT_FOUND'
        });
      }

      // Check if already verified
      if (user.verification_status.email_verified) {
        return res.json({
          success: true,
          message: 'Email is already verified',
          data: {
            already_verified: true
          }
        });
      }

      // Verify OTP
      const otp_result = await otpService.verifyOTP({
        user_id: user._id.toString(),
        otp,
        type: 'email_verification',
        metadata: {
          ip_address,
          user_agent
        }
      });

      if (!otp_result.valid) {
        return res.status(400).json({
          success: false,
          error: otp_result.error === 'OTP_MAX_ATTEMPTS_EXCEEDED'
            ? 'Too many failed attempts. Please request a new code.'
            : 'Invalid or expired verification code',
          error_code: otp_result.error || 'INVALID_OTP'
        });
      }

      // Mark email as verified
      await userService.verifyUserEmail(user._id.toString());

      // Log the verification
      await AuditService.logAuthEvent({
        user_id: user._id.toString(),
        event_type: 'otp_verified',
        success: true,
        metadata: {
          ip_address,
          user_agent
        }
      });

      logger.info('Email verified successfully', { user_id: user._id.toString(), email: user.email });

      res.json({
        success: true,
        message: 'Email verified successfully. You can now login.',
        data: {
          verified: true
        }
      });
    } catch (error: any) {
      logger.error('Email verification error:', error);

      res.status(500).json({
        success: false,
        error: 'Email verification failed',
        error_code: 'VERIFICATION_FAILED'
      });
    }
  }

  // ============================================
  // RESEND VERIFICATION
  // ============================================

  /**
   * POST /auth/resend-verification
   * Resend email verification OTP
   */
  async resendVerification(req: Request, res: Response) {
    try {
      const { email } = req.body;
      const ip_address = (req.ip as string) || 'unknown';
      const user_agent = req.get('user-agent') || 'unknown';

      const user = await userService.getUserByEmail(email);

      if (!user) {
        logger.warn('Resend verification for non-existent email', { email, ip_address });
        return res.json({
          success: true,
          message: 'If the email exists, a new verification code has been sent'
        });
      }

      if (user.verification_status.email_verified) {
        return res.json({
          success: true,
          message: 'Email is already verified'
        });
      }

      // Invalidate any existing OTPs
      await otpService.invalidateAllUserOTPs(user._id.toString());

      // Generate new OTP (this now sends the email automatically)
      const { otp_id } = await otpService.generateOTP({
        user_id: user._id.toString(),
        type: 'email_verification',
        metadata: {
          ip_address,
          user_agent,
          request_reason: 'resend_verification'
        }
      });

      logger.info('Verification email resent', {
        user_id: user._id.toString(),
        otp_id
      });

      res.json({
        success: true,
        message: 'If the email exists, a new verification code has been sent'
      });
    } catch (error: any) {
      logger.error('Resend verification error:', error);

      // Return success to prevent enumeration
      res.json({
        success: true,
        message: 'If the email exists, a new verification code has been sent'
      });
    }
  }

  // ============================================
  // AVAILABILITY CHECKS
  // ============================================

  /**
   * GET /auth/check-email
   * Check if email is available
   * SECURITY: Rate limited to prevent enumeration
   */
  async checkEmailAvailability(req: Request, res: Response) {
    try {
      const { email } = req.query;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Email parameter is required',
          error_code: 'MISSING_EMAIL'
        });
      }

      const user = await userService.getUserByEmail(email);

      // SECURITY: Add slight delay to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));

      res.json({
        success: true,
        data: {
          email,
          available: !user
        }
      });
    } catch (error: any) {
      logger.error('Email availability check error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to check email availability',
        error_code: 'CHECK_FAILED'
      });
    }
  }

  /**
   * GET /auth/check-username
   * Check if username is available
   * SECURITY: Rate limited to prevent enumeration
   */
  async checkUsernameAvailability(req: Request, res: Response) {
    try {
      const { username } = req.query;

      if (!username || typeof username !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Username parameter is required',
          error_code: 'MISSING_USERNAME'
        });
      }

      const user = await userService.getUserByUsername(username);

      // SECURITY: Add slight delay to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));

      res.json({
        success: true,
        data: {
          username,
          available: !user
        }
      });
    } catch (error: any) {
      logger.error('Username availability check error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to check username availability',
        error_code: 'CHECK_FAILED'
      });
    }
  }
}

export const registerController = new RegisterController();
