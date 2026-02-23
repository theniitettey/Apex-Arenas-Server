import { Request, Response } from "express";
import { PasswordService } from "../services/auth.password.service";
import { otpService } from "../services/auth.otp.service";
import { userService } from "../services/auth.user.service";
import { tokenService } from "../services/auth.token.service";
import { AuditService } from "../services/auth.audit.service";
import { AuthRequest } from "../middlewares/auth.jwt.middleware";
import { User, UserSecurity } from "../../../models/user.model";
import { createLogger } from "../../../shared/utils/logger.utils";
import {
  sendSuccess,
  sendError,
  sendUnauthorized,
} from "../../../shared/utils/response.utils";
import { extractDeviceContext } from "../../../shared/utils/request.utils";
import { AUTH_ERROR_CODES } from "../../../shared/constants/error-codes";
import { env } from "../../../configs/env.config";

const logger = createLogger("auth-password-controller");

/**
 * Password Controller
 * Handles password change, reset, and validation for users and admins
 */

export class PasswordController {
  // ============================================
  // PASSWORD CHANGE (Authenticated)
  // ============================================

  /**
   * POST /auth/password/change
   * Change password for authenticated user
   */
  async changePassword(req: AuthRequest, res: Response) {
    try {
      const user_id = req.user?.user_id;
      const { current_password, new_password } = req.body;
      const device_context = extractDeviceContext(req);

      if (!user_id) {
        return sendUnauthorized(res, AUTH_ERROR_CODES.AUTH_REQUIRED);
      }

      await userService.changePassword(
        user_id,
        current_password,
        new_password,
        device_context,
      );

      return sendSuccess(
        res,
        undefined,
        "Password changed successfully. Please login again with your new password.",
      );
    } catch (error: any) {
      logger.error("Password change error:", error);

      if (error.message === AUTH_ERROR_CODES.USER_NOT_FOUND) {
        return sendError(res, AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      if (error.message === AUTH_ERROR_CODES.INVALID_CURRENT_PASSWORD) {
        return sendError(res, AUTH_ERROR_CODES.INVALID_CURRENT_PASSWORD);
      }

      if (error.message.startsWith(AUTH_ERROR_CODES.WEAK_PASSWORD)) {
        const errors = error.message
          .replace(`${AUTH_ERROR_CODES.WEAK_PASSWORD}:`, "")
          .split("|");
        return sendError(res, AUTH_ERROR_CODES.WEAK_PASSWORD, errors);
      }

      if (error.message === AUTH_ERROR_CODES.PASSWORD_RECENTLY_USED) {
        return sendError(res, AUTH_ERROR_CODES.PASSWORD_RECENTLY_USED);
      }

      return sendError(res, AUTH_ERROR_CODES.PASSWORD_CHANGE_FAILED);
    }
  }

  // ============================================
  // PASSWORD RESET (Forgot Password)
  // ============================================

  /**
   * POST /auth/password/reset
   * Request password reset - sends OTP to email
   * Always returns success to prevent email enumeration
   */
  async requestPasswordReset(req: Request, res: Response) {
    try {
      const { email } = req.body;
      const device_context = extractDeviceContext(req);

      const user = await userService.getUserByEmail(email);

      if (!user || !user.is_active || user.is_banned) {
        logger.warn("Password reset attempt for invalid account", {
          email,
          ip_address: device_context.ip_address,
        });
        return sendSuccess(
          res,
          undefined,
          "If the email exists, a reset code has been sent",
        );
      }

      const { otp, otp_id } = await otpService.generateOTP({
        user_id: user._id.toString(),
        type: "password_reset",
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          request_reason: "user_requested",
        },
      });

      await AuditService.logAuthEvent({
        user_id: user._id.toString(),
        event_type: "password_reset_requested",
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
        },
      });

      logger.info("Password reset OTP generated", {
        user_id: user._id.toString(),
        otp_id,
        otp: env.NODE_ENV === "development" ? otp : undefined,
      });

      return sendSuccess(
        res,
        undefined,
        "If the email exists, a reset code has been sent",
      );
    } catch (error: any) {
      logger.error("Password reset request error:", error);
      return sendSuccess(
        res,
        undefined,
        "If the email exists, a reset code has been sent",
      );
    }
  }

  /**
   * POST /auth/password/reset/confirm
   * Confirm password reset with OTP
   */
  async confirmPasswordReset(req: Request, res: Response) {
    try {
      const { email, otp, new_password } = req.body;
      const device_context = extractDeviceContext(req);

      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return sendError(
          res,
          AUTH_ERROR_CODES.INVALID_CODE,
          undefined,
          "Invalid reset request",
        );
      }

      const otp_result = await otpService.verifyOTP({
        user_id: user._id.toString(),
        otp,
        type: "password_reset",
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
        },
      });

      if (!otp_result.valid) {
        await AuditService.logAuthEvent({
          user_id: user._id.toString(),
          event_type: "password_reset_failed",
          success: false,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: otp_result.error || "Invalid OTP",
          },
        });

        return sendError(
          res,
          otp_result.error || AUTH_ERROR_CODES.INVALID_OTP,
          undefined,
          otp_result.error === AUTH_ERROR_CODES.OTP_MAX_ATTEMPTS
            ? "Too many attempts. Please request a new code."
            : "Invalid or expired reset code",
        );
      }

      const password_validation =
        PasswordService.validatePasswordStrength(new_password);
      if (!password_validation.is_valid) {
        return sendError(
          res,
          AUTH_ERROR_CODES.WEAK_PASSWORD,
          password_validation.errors,
        );
      }

      const security = await UserSecurity.findOne({ user_id: user._id });
      if (security?.password.previous_hashes) {
        const is_reused = await PasswordService.isPasswordReused(
          new_password,
          security.password.previous_hashes,
        );
        if (is_reused) {
          return sendError(res, AUTH_ERROR_CODES.PASSWORD_RECENTLY_USED);
        }
      }

      const old_hash = user.password_hash;
      const new_hash = await PasswordService.hashPassword(new_password);

      user.password_hash = new_hash;
      await user.save();

      if (security) {
        const previous_hashes = security.password.previous_hashes || [];
        previous_hashes.unshift(old_hash as string);
        security.password.previous_hashes = previous_hashes.slice(0, 5);
        security.password.last_changed_at = new Date();
        security.password.change_required = false;
        security.password.strength_score = password_validation.strength_score;
        await security.save();
      }

      await tokenService.revokeAllUserTokens(
        user._id.toString(),
        "password_change",
      );
      await otpService.invalidateAllUserOTPs(user._id.toString());

      await AuditService.logAuthEvent({
        user_id: user._id.toString(),
        event_type: "password_reset_completed",
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
        },
      });

      logger.info("Password reset completed", { user_id: user._id.toString() });

      return sendSuccess(
        res,
        undefined,
        "Password reset successfully. Please login with your new password.",
      );
    } catch (error: any) {
      logger.error("Password reset confirmation error:", error);
      return sendError(res, AUTH_ERROR_CODES.PASSWORD_RESET_FAILED);
    }
  }

  // ============================================
  // ADMIN PASSWORD RESET (Request)
  // ============================================

  /**
   * POST /auth/admin/password/reset
   * Request password reset for admin - more restricted
   */
  async requestAdminPasswordReset(req: Request, res: Response) {
    try {
      const { email } = req.body;
      const device_context = extractDeviceContext(req);

      const admin = await User.findOne({
        email: email.toLowerCase(),
        role: "admin",
        is_active: true,
      });

      if (!admin) {
        logger.warn("Admin password reset attempt for non-admin email", {
          email,
          ip_address: device_context.ip_address,
        });

        await AuditService.logSuspiciousActivity(
          undefined,
          "Admin password reset attempt for non-admin",
          {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            risk_factors: ["admin_reset_attempt", "email_mismatch"],
            attempted_email: email,
          },
        );

        return sendSuccess(
          res,
          undefined,
          "If the email exists, a reset code has been sent",
        );
      }

      const { otp, otp_id } = await otpService.generateOTP({
        user_id: admin._id.toString(),
        type: "password_reset",
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          request_reason: "admin_requested",
        },
      });

      await AuditService.logAuthEvent({
        user_id: admin._id.toString(),
        event_type: "password_reset_requested",
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
        },
      });

      logger.info("Admin password reset OTP generated", {
        user_id: admin._id.toString(),
        otp_id,
        otp: env.NODE_ENV === "development" ? otp : undefined,
      });

      return sendSuccess(
        res,
        undefined,
        "If the email exists, a reset code has been sent",
      );
    } catch (error: any) {
      logger.error("Admin password reset request error:", error);
      return sendSuccess(
        res,
        undefined,
        "If the email exists, a reset code has been sent",
      );
    }
  }

  // ============================================
  // PASSWORD VALIDATION
  // ============================================

  /**
   * POST /auth/password/validate
   * Validate password strength (public endpoint for client-side feedback)
   */
  async validatePassword(req: Request, res: Response) {
    try {
      const { password } = req.body;

      const validation = PasswordService.validatePasswordStrength(password);
      const is_breached = await PasswordService.checkPasswordBreach(password);

      return sendSuccess(res, {
        is_valid: validation.is_valid && !is_breached,
        strength_score: validation.strength_score,
        errors: validation.errors,
        is_breached,
        suggestions: this.getPasswordSuggestions(validation, is_breached),
      });
    } catch (error: any) {
      logger.error("Password validation error:", error);
      return sendError(res, AUTH_ERROR_CODES.VALIDATION_ERROR);
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  /**
   * Get password improvement suggestions
   */
  private getPasswordSuggestions(
    validation: {
      is_valid: boolean;
      errors: string[];
      strength_score?: number;
    },
    is_breached: boolean,
  ): string[] {
    const suggestions: string[] = [];

    if (is_breached) {
      suggestions.push(
        "This password has been found in data breaches. Please choose a different one.",
      );
    }

    if ((validation.strength_score || 0) < 60) {
      suggestions.push("Consider using a longer password with more variety.");
    }

    if ((validation.strength_score || 0) < 80) {
      suggestions.push(
        "Try adding more special characters to make your password stronger.",
      );
    }

    if (suggestions.length === 0 && validation.is_valid && !is_breached) {
      suggestions.push("Good password! You're all set.");
    }

    return suggestions;
  }
}

export const passwordController = new PasswordController();
