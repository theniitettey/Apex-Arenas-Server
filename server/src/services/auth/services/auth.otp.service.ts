import { OTP, IApexOTP, User, AuthLog } from "../../../models/user.model";
import { CryptoUtils } from "../../../shared/utils/crypto.utils";
import { env } from "../../../configs/env.config";
import { createLogger } from "../../../shared/utils/logger.utils";

const logger = createLogger("auth-otp-service");

export interface OTPGenerateOptions {
  user_id: string;
  type: 'email_verification' | 'password_reset' | 'phone_verification' | '2fa_login' | 'withdrawal_confirmation';
  metadata: {
    ip_address: string;
    user_agent: string;
    device_fingerprint?: string;
    request_reason?: string;
  };
}

export interface OTPVerificationResult {
  valid: boolean;
  error?: string;
  otp_record?: IApexOTP;
}

export interface OTPVerifyOptions {
  user_id: string;
  otp: string;
  type: 'email_verification' | 'password_reset' | 'phone_verification' | '2fa_login' | 'withdrawal_confirmation';
  metadata: {
    ip_address: string;
    user_agent: string;
  };
}

/**
 * OTP service for generation, storage and verification
 * Supports: email verification, password reset, phone verification, 2FA, withdrawal confirmation
 */

export class OTPService {

  // ============================================
  // OTP GENERATION
  // ============================================

  /**
   * Generate OTP and store in MongoDB
   */
  async generateOTP(options: OTPGenerateOptions): Promise<{ otp: string; otp_id: string }> {
    try {
      const { user_id, type, metadata } = options;

      // Invalidate any existing unused OTPs for this user and type
      await OTP.updateMany(
        { user_id, type, used: false },
        { used: true, used_at: new Date() }
      );

      // Generate OTP
      const otp = CryptoUtils.generateSecureRandom(env.OTP_LENGTH || 6);

      // Hash OTP for secure storage
      const hashed_otp = await CryptoUtils.hashSensitive(otp);

      // Calculate expiration
      const expires_at = new Date();
      expires_at.setMinutes(expires_at.getMinutes() + (env.OTP_EXPIRY_MINUTES || 10));

      // Store in MongoDB (hashed)
      const otpRecord = await OTP.create({
        user_id,
        type,
        hashed_otp,
        expires_at,
        used: false,
        attempts: 0,
        max_attempts: env.OTP_MAX_ATTEMPTS || 3,
        metadata: {
          ip_address: metadata.ip_address,
          user_agent: metadata.user_agent,
          device_fingerprint: metadata.device_fingerprint,
          request_reason: metadata.request_reason || 'user_requested'
        }
      });

      // Log OTP generation
      await this.logAuthEvent({
        user_id,
        event_type: 'otp_requested',
        success: true,
        metadata: {
          ip_address: metadata.ip_address,
          user_agent: metadata.user_agent,
          otp_type: type
        }
      });

      logger.info('OTP generated', { user_id, type, otp_id: otpRecord._id, expires_at });

      return { otp, otp_id: otpRecord._id.toString() };
    } catch (error: any) {
      logger.error('Error generating OTP:', error);
      throw new Error('OTP_GENERATION_FAILED');
    }
  }

  // ============================================
  // OTP VERIFICATION
  // ============================================

  /**
   * Verify OTP
   */
  async verifyOTP(options: OTPVerifyOptions): Promise<OTPVerificationResult> {
    try {
      const { user_id, otp, type, metadata } = options;

      // Find the latest non-expired, non-used, non-locked OTP for this user and type
      const otpRecord = await OTP.findOne({
        user_id,
        type,
        used: false,
        expires_at: { $gt: new Date() },
        $or: [
          { locked_until: { $exists: false } },
          { locked_until: null },
          { locked_until: { $lt: new Date() } }
        ]
      }).sort({ created_at: -1 });

      if (!otpRecord) {
        await this.logAuthEvent({
          user_id,
          event_type: 'otp_failed',
          success: false,
          metadata: {
            ip_address: metadata.ip_address,
            user_agent: metadata.user_agent,
            failure_reason: 'No active OTP found'
          }
        });

        return { valid: false, error: 'OTP_NOT_FOUND_OR_EXPIRED' };
      }

      // Check if max attempts reached
      if (otpRecord.attempts >= otpRecord.max_attempts) {
        // Lock the OTP for 15 minutes
        const locked_until = new Date();
        locked_until.setMinutes(locked_until.getMinutes() + 15);

        await OTP.updateOne(
          { _id: otpRecord._id },
          { locked_until }
        );

        await this.logAuthEvent({
          user_id,
          event_type: 'otp_max_attempts',
          success: false,
          metadata: {
            ip_address: metadata.ip_address,
            user_agent: metadata.user_agent,
            failure_reason: 'Max attempts reached'
          }
        });

        return { valid: false, error: 'OTP_MAX_ATTEMPTS_EXCEEDED' };
      }

      // Verify OTP
      const isValid = await CryptoUtils.compareHash(otp, otpRecord.hashed_otp);

      if (!isValid) {
        // Increment attempts
        await OTP.updateOne(
          { _id: otpRecord._id },
          { $inc: { attempts: 1 } }
        );

        await this.logAuthEvent({
          user_id,
          event_type: 'otp_failed',
          success: false,
          metadata: {
            ip_address: metadata.ip_address,
            user_agent: metadata.user_agent,
            failure_reason: 'Invalid OTP code',
            attempts: otpRecord.attempts + 1
          }
        });

        return { valid: false, error: 'INVALID_OTP' };
      }

      // Mark OTP as used
      await OTP.updateOne(
        { _id: otpRecord._id },
        { used: true, used_at: new Date() }
      );

      await this.logAuthEvent({
        user_id,
        event_type: 'otp_verified',
        success: true,
        metadata: {
          ip_address: metadata.ip_address,
          user_agent: metadata.user_agent,
          otp_type: type
        }
      });

      logger.info('OTP verified successfully', { user_id, type });

      return { valid: true, otp_record: otpRecord };
    } catch (error: any) {
      logger.error('Error verifying OTP:', error);
      return { valid: false, error: 'OTP_VERIFICATION_FAILED' };
    }
  }

  // ============================================
  // OTP MANAGEMENT
  // ============================================

  /**
   * Check if OTP is expired
   */
  async isOTPExpired(otp_id: string): Promise<boolean> {
    try {
      const otpRecord = await OTP.findById(otp_id);
      if (!otpRecord) return true;

      return otpRecord.expires_at < new Date();
    } catch (error: any) {
      logger.error('Error checking OTP expiration:', error);
      return true;
    }
  }

  /**
   * Invalidate OTP (mark as used)
   */
  async invalidateOTP(otp_id: string): Promise<void> {
    try {
      await OTP.findByIdAndUpdate(otp_id, { used: true, used_at: new Date() });
      logger.info('OTP invalidated', { otp_id });
    } catch (error: any) {
      logger.error('Error invalidating OTP:', error);
      throw new Error('OTP_INVALIDATION_FAILED');
    }
  }

  /**
   * Invalidate all OTPs for a user (e.g., after password change)
   */
  async invalidateAllUserOTPs(user_id: string): Promise<void> {
    try {
      const result = await OTP.updateMany(
        { user_id, used: false },
        { used: true, used_at: new Date() }
      );
      logger.info('All user OTPs invalidated', { user_id, count: result.modifiedCount });
    } catch (error: any) {
      logger.error('Error invalidating all user OTPs:', error);
      throw new Error('OTP_BULK_INVALIDATION_FAILED');
    }
  }

  /**
   * Check if user can request new OTP (rate limiting)
   */
  async canRequestOTP(user_id: string, type: string): Promise<{ allowed: boolean; wait_seconds?: number }> {
    try {
      const cooldownSeconds = env.OTP_COOLDOWN_SECONDS;

      // Find the most recent OTP request
      const recentOTP = await OTP.findOne({
        user_id,
        type
      }).sort({ created_at: -1 });

      if (!recentOTP) {
        return { allowed: true };
      }

      const timeSinceLastRequest = (Date.now() - recentOTP.created_at.getTime()) / 1000;

      if (timeSinceLastRequest < cooldownSeconds) {
        return {
          allowed: false,
          wait_seconds: Math.ceil(cooldownSeconds - timeSinceLastRequest)
        };
      }

      return { allowed: true };
    } catch (error: any) {
      logger.error('Error checking OTP rate limit:', error);
      return { allowed: true }; // Allow on error to not block users
    }
  }

  // ============================================
  // CLEANUP & STATISTICS
  // ============================================

  /**
   * Clean up expired OTPs (can be called by a scheduled job)
   */
  async cleanupExpiredOTPs(): Promise<number> {
    try {
      const result = await OTP.deleteMany({
        expires_at: { $lt: new Date() }
      });

      logger.info('Expired OTPs cleaned up', { deleted_count: result.deletedCount });
      return result.deletedCount || 0;
    } catch (error: any) {
      logger.error('Error cleaning up expired OTPs:', error);
      throw new Error('OTP_CLEANUP_FAILED');
    }
  }

  /**
   * Get OTP usage statistics for a user
   */
  async getOTPStats(user_id: string): Promise<{ total: number; used: number; expired: number; active: number }> {
    try {
      const now = new Date();

      const [total, used, expired, active] = await Promise.all([
        OTP.countDocuments({ user_id }),
        OTP.countDocuments({ user_id, used: true }),
        OTP.countDocuments({ user_id, expires_at: { $lt: now }, used: false }),
        OTP.countDocuments({ user_id, expires_at: { $gt: now }, used: false })
      ]);

      return { total, used, expired, active };
    } catch (error: any) {
      logger.error('Error getting OTP stats:', error);
      throw new Error('OTP_STATS_FETCH_FAILED');
    }
  }

  /**
   * Get remaining attempts for active OTP
   */
  async getRemainingAttempts(user_id: string, type: string): Promise<number> {
    try {
      const otpRecord = await OTP.findOne({
        user_id,
        type,
        used: false,
        expires_at: { $gt: new Date() }
      }).sort({ created_at: -1 });

      if (!otpRecord) {
        return 0;
      }

      return Math.max(0, otpRecord.max_attempts - otpRecord.attempts);
    } catch (error: any) {
      logger.error('Error getting remaining attempts:', error);
      return 0;
    }
  }

  // ============================================
  // AUDIT LOGGING
  // ============================================

  /**
   * Log authentication event
   */
  private async logAuthEvent(params: {
    user_id?: string;
    event_type: string;
    success: boolean;
    identifier?: string;
    metadata: {
      ip_address: string;
      user_agent: string;
      failure_reason?: string;
      [key: string]: any;
    };
  }): Promise<void> {
    try {
      await AuthLog.create({
        user_id: params.user_id,
        event_type: params.event_type,
        success: params.success,
        identifier: params.identifier,
        metadata: {
          ip_address: params.metadata.ip_address,
          user_agent: params.metadata.user_agent,
          failure_reason: params.metadata.failure_reason,
          is_suspicious: false
        }
      });
    } catch (error: any) {
      logger.error('Failed to log auth event', { error: error.message });
    }
  }
}

export const otpService = new OTPService();