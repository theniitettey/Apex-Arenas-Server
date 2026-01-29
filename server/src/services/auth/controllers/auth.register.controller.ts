import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { otpService } from '../services/auth.otp.service';
import { AuditService } from '../services/auth.audit.service';
import { createLogger } from '../../../shared/utils/logger.utils';
import { sendSuccess, sendError, sendCreated, sendNotFound } from '../../../shared/utils/response.utils';
import { extractDeviceContext } from '../../../shared/utils/request.utils';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes';

const logger = createLogger('auth-register-controller');

export class RegisterController {

  async register(req: Request, res: Response) {
    try {
      const { email, username, password, first_name, last_name, role } = req.body;
      const device_context = extractDeviceContext(req);

      const user = await userService.registerUser(
        {
          email,
          username,
          password,
          first_name,
          last_name,
          role: role || 'player'
        },
        device_context
      );

      const { otp_id } = await otpService.generateOTP({
        user_id: user._id.toString(),
        type: 'email_verification',
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          request_reason: 'registration'
        }
      });

      logger.info('Registration successful, verification email sent', {
        user_id: user._id.toString(),
        email: user.email,
        otp_id
      });

      const user_data = {
        user_id: user._id,
        email: user.email,
        username: user.username,
        first_name: user.profile.first_name,
        last_name: user.profile.last_name,
        role: user.role,
        created_at: user.created_at
      };

      return sendCreated(res, {
        user: user_data,
        requires_verification: true
      }, 'Registration successful. Please check your email for verification code.');
    } catch (error: any) {
      logger.error('Registration error:', error);

      if (error.message === 'EMAIL_ALREADY_EXISTS' || error.message === 'USERNAME_ALREADY_EXISTS') {
        logger.warn('Registration conflict', { 
          reason: error.message,
          ip: req.ip 
        });
        
        return sendError(res, AUTH_ERROR_CODES.REGISTRATION_FAILED, undefined, 'Unable to create account with the provided details. Please try different credentials.');
      }

      if (error.message.startsWith('WEAK_PASSWORD')) {
        const errors = error.message.replace('WEAK_PASSWORD:', '').split('|');
        return sendError(res, AUTH_ERROR_CODES.WEAK_PASSWORD, errors);
      }

      if (error.message === 'PASSWORD_COMPROMISED') {
        return sendError(res, AUTH_ERROR_CODES.PASSWORD_COMPROMISED);
      }

      if (error.message === 'INVALID_ROLE') {
        return sendError(res, AUTH_ERROR_CODES.INVALID_ROLE);
      }

      return sendError(res, AUTH_ERROR_CODES.REGISTRATION_FAILED);
    }
  }

  async verifyEmail(req: Request, res: Response) {
    try {
      const { email, otp } = req.body;
      const device_context = extractDeviceContext(req);

      const user = await userService.getUserByEmail(email);
      if (!user) {
        return sendNotFound(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      if (user.verification_status.email_verified) {
        return sendSuccess(res, { already_verified: true }, 'Email is already verified');
      }

      const otp_result = await otpService.verifyOTP({
        user_id: user._id.toString(),
        otp,
        type: 'email_verification',
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      if (!otp_result.valid) {
        const error_code = otp_result.error || AUTH_ERROR_CODES.INVALID_OTP;
        return sendError(res, error_code);
      }

      await userService.verifyUserEmail(user._id.toString());

      await AuditService.logAuthEvent({
        user_id: user._id.toString(),
        event_type: 'otp_verified',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      logger.info('Email verified successfully', { user_id: user._id.toString(), email: user.email });

      return sendSuccess(res, { verified: true }, 'Email verified successfully. You can now login.');
    } catch (error: any) {
      logger.error('Email verification error:', error);
      return sendError(res, AUTH_ERROR_CODES.VERIFICATION_FAILED);
    }
  }

  async resendVerification(req: Request, res: Response) {
    try {
      const { email } = req.body;
      const device_context = extractDeviceContext(req);

      const user = await userService.getUserByEmail(email);

      if (!user) {
        logger.warn('Resend verification for non-existent email', { email, ip_address: device_context.ip_address });
        return sendSuccess(res, undefined, 'If the email exists, a new verification code has been sent');
      }

      if (user.verification_status.email_verified) {
        return sendSuccess(res, undefined, 'Email is already verified');
      }

      await otpService.invalidateAllUserOTPs(user._id.toString());

      const { otp_id } = await otpService.generateOTP({
        user_id: user._id.toString(),
        type: 'email_verification',
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          request_reason: 'resend_verification'
        }
      });

      logger.info('Verification email resent', {
        user_id: user._id.toString(),
        otp_id
      });

      return sendSuccess(res, undefined, 'If the email exists, a new verification code has been sent');
    } catch (error: any) {
      logger.error('Resend verification error:', error);
      return sendSuccess(res, undefined, 'If the email exists, a new verification code has been sent');
    }
  }

  async checkEmailAvailability(req: Request, res: Response) {
    try {
      const { email } = req.query;

      if (!email || typeof email !== 'string') {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Email parameter is required');
      }

      const user = await userService.getUserByEmail(email);

      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));

      return sendSuccess(res, {
        email,
        available: !user
      });
    } catch (error: any) {
      logger.error('Email availability check error:', error);
      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }

  async checkUsernameAvailability(req: Request, res: Response) {
    try {
      const { username } = req.query;

      if (!username || typeof username !== 'string') {
        return sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Username parameter is required');
      }

      const user = await userService.getUserByUsername(username);

      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));

      return sendSuccess(res, {
        username,
        available: !user
      });
    } catch (error: any) {
      logger.error('Username availability check error:', error);
      return sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }
}

export const registerController = new RegisterController();