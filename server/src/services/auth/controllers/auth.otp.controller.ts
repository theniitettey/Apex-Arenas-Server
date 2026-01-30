import { Request, Response } from 'express';
import { otpService } from '../services/auth.otp.service';
import { userService } from '../services/auth.user.service';
import { createLogger } from '../../../shared/utils/logger.utils';
import { sendSuccess, sendError, sendUnauthorized, sendRateLimited } from '../../../shared/utils/response.utils';
import { extractDeviceContext } from '../../../shared/utils/request.utils';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes';

const logger = createLogger('auth-otp-controller');

const VALID_OTP_TYPES = [
  'email_verification',
  'password_reset',
  'phone_verification',
  '2fa_login',
  'withdrawal_confirmation'
] as const;

type OTPType = typeof VALID_OTP_TYPES[number];

export class OTPController {

  async generateOTP(req: Request, res: Response): Promise<void> {
    try {
      const { email, type } = req.body;
      const device_context = extractDeviceContext(req);

      if (!email || !type) {
        sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Email and OTP type are required');
        return;
      }

      if (!VALID_OTP_TYPES.includes(type as OTPType)) {
        sendError(res, AUTH_ERROR_CODES.VALIDATION_ERROR, undefined, `Invalid OTP type. Must be one of: ${VALID_OTP_TYPES.join(', ')}`);
        return;
      }

      const user = await userService.getUserByEmail(email);

      if (!user) {
        logger.warn('OTP generation attempt for non-existent email', { email, type, ip_address: device_context.ip_address });
        sendSuccess(res, undefined, 'If the email exists, an OTP has been sent');
        return;
      }

      const can_request = await otpService.canRequestOTP(user._id.toString(), type);
      if (!can_request.allowed) {
        sendRateLimited(res, can_request.wait_seconds, AUTH_ERROR_CODES.OTP_COOLDOWN);
        return;
      }

      const { otp_id } = await otpService.generateOTP({
        user_id: user._id.toString(),
        type: type as OTPType,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          request_reason: 'user_requested'
        }
      });

      logger.info('OTP generated successfully', { user_id: user._id, type });

      sendSuccess(res, type === '2fa_login' ? { otp_id } : undefined, 'If the email exists, an OTP has been sent');

    } catch (error: any) {
      logger.error('OTP generation error:', error);
      sendSuccess(res, undefined, 'If the email exists, an OTP has been sent');
    }
  }

  async verifyOTP(req: Request, res: Response): Promise<void> {
    try {
      const { email, otp, type } = req.body;
      const device_context = extractDeviceContext(req);

      if (!email || !otp || !type) {
        sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Email, OTP, and type are required');
        return;
      }

      if (!VALID_OTP_TYPES.includes(type as OTPType)) {
        sendError(res, AUTH_ERROR_CODES.VALIDATION_ERROR, undefined, 'Invalid OTP type');
        return;
      }

      const user = await userService.getUserByEmail(email);
      if (!user) {
        sendError(res, AUTH_ERROR_CODES.VALIDATION_ERROR, undefined, 'Invalid verification request');
        return;
      }

      const verification_result = await otpService.verifyOTP({
        user_id: user._id.toString(),
        otp,
        type: type as OTPType,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      if (!verification_result.valid) {
        const error_code = verification_result.error || AUTH_ERROR_CODES.INVALID_OTP;
        sendError(res, error_code);
        return;
      }

      let additional_data: Record<string, any> = {};

      switch (type) {
        case 'email_verification':
          await userService.verifyUserEmail(user._id.toString());
          additional_data = { email_verified: true };
          logger.info('Email verified via OTP', { user_id: user._id });
          break;

        case 'password_reset':
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

      sendSuccess(res, {
        verified: true,
        type,
        ...additional_data
      }, 'OTP verified successfully');

    } catch (error: any) {
      logger.error('OTP verification error:', error);
      sendError(res, AUTH_ERROR_CODES.OTP_VERIFICATION_FAILED);
    }
  }

  async resendOTP(req: Request, res: Response): Promise<void> {
    try {
      const { email, type } = req.body;
      const device_context = extractDeviceContext(req);

      if (!email || !type) {
        sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Email and OTP type are required');
        return;
      }

      if (!VALID_OTP_TYPES.includes(type as OTPType)) {
        sendError(res, AUTH_ERROR_CODES.VALIDATION_ERROR, undefined, 'Invalid OTP type');
        return;
      }

      const user = await userService.getUserByEmail(email);

      if (!user) {
        logger.warn('OTP resend attempt for non-existent email', { email, type, ip_address: device_context.ip_address });
        sendSuccess(res, undefined, 'If the email exists, an OTP has been sent');
        return;
      }

      const can_request = await otpService.canRequestOTP(user._id.toString(), type);
      if (!can_request.allowed) {
        sendRateLimited(res, can_request.wait_seconds, AUTH_ERROR_CODES.OTP_COOLDOWN);
        return;
      }

      await otpService.generateOTP({
        user_id: user._id.toString(),
        type: type as OTPType,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          request_reason: 'resend_requested'
        }
      });

      logger.info('OTP resent successfully', { user_id: user._id, type });

      sendSuccess(res, undefined, 'If the email exists, an OTP has been sent');

    } catch (error: any) {
      logger.error('OTP resend error:', error);
      sendSuccess(res, undefined, 'If the email exists, an OTP has been sent');
    }
  }

  async getRemainingAttempts(req: Request, res: Response): Promise<void> {
    try {
      const { type } = req.params;
      const user = (req as any).user;

      if (!user) {
        sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
        return;
      }

      if (!VALID_OTP_TYPES.includes(type as OTPType)) {
        sendError(res, AUTH_ERROR_CODES.VALIDATION_ERROR, undefined, 'Invalid OTP type');
        return;
      }

      const remaining = await otpService.getRemainingAttempts(user.user_id, type as string);

      sendSuccess(res, {
        remaining_attempts: remaining,
        type
      });

    } catch (error: any) {
      logger.error('Get remaining attempts error:', error);
      sendError(res, AUTH_ERROR_CODES.OTP_STATS_FETCH_FAILED);
    }
  }

  async canRequestOTP(req: Request, res: Response): Promise<void> {
    try {
      const { type } = req.params;
      const { email } = req.query;

      if (!email || !type) {
        sendError(res, AUTH_ERROR_CODES.MISSING_FIELDS, undefined, 'Email and type are required');
        return;
      }

      if (!VALID_OTP_TYPES.includes(type as OTPType)) {
        sendError(res, AUTH_ERROR_CODES.VALIDATION_ERROR, undefined, 'Invalid OTP type');
        return;
      }

      const user = await userService.getUserByEmail(email as string);

      if (!user) {
        sendSuccess(res, { allowed: true });
        return;
      }

      const can_request = await otpService.canRequestOTP(user._id.toString(), type as string);

      sendSuccess(res, {
        allowed: can_request.allowed,
        wait_seconds: can_request.wait_seconds
      });

    } catch (error: any) {
      logger.error('Can request OTP check error:', error);
      sendError(res, AUTH_ERROR_CODES.FETCH_FAILED);
    }
  }
}

export const otpController = new OTPController();