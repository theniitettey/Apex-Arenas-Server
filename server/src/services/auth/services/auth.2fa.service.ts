import * as OTPAuth from 'otpauth';
import * as QRCode from 'qrcode';
import { UserSecurity, User } from '../../../models/user.model';
import { PasswordService } from './auth.password.service';
import { AuditService } from './auth.audit.service';
import { CryptoUtils } from '../../../shared/utils/crypto.utils';
import { emailService } from '../../../shared/utils/email.util';
import { env } from '../../../configs/env.config';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-2fa-service');

export interface TOTPSetupResult {
  secret: string;
  qr_code_url: string;
  qr_code_data_url: string;
  manual_entry_key: string;
  issuer: string;
  account_name: string;
}

export interface TOTPVerifyResult {
  valid: boolean;
  error?: string;
}

export interface BackupCodesResult {
  codes: string[];
  generated_at: Date;
}

export interface TwoFactorStatus {
  is_enabled: boolean;
  method: 'none' | 'sms' | 'email' | 'authenticator_app';
  enabled_at?: Date;
  has_backup_codes: boolean;
  backup_codes_count: number;
  recovery_email?: string;
  recovery_phone?: string;
}

export interface DeviceContext {
  ip_address: string;
  user_agent: string;
}

/**
 * Two-Factor Authentication Service
 * Handles TOTP (Authenticator App) setup, verification, and backup codes
 */

export class TwoFactorService {
  private readonly ISSUER = env.APP_NAME || 'ApexArenas';
  private readonly BACKUP_CODES_COUNT = 10;
  private readonly BACKUP_CODE_LENGTH = 8;
  private readonly TOTP_DIGITS = 6;
  private readonly TOTP_PERIOD = 30; // seconds

  // ============================================
  // TOTP SETUP
  // ============================================

  /**
   * Initialize TOTP setup - generates secret and QR code
   * Does NOT enable 2FA yet - user must verify first
   */
  async setupTOTP(user_id: string): Promise<TOTPSetupResult> {
    try {
      logger.info('Initiating 2FA setup', { user_id });

      // Get user for account name
      const user = await User.findById(user_id).select('email username');
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      // Generate new secret
      const secret = new OTPAuth.Secret({ size: 20 });

      // Create TOTP instance
      const totp = new OTPAuth.TOTP({
        issuer: this.ISSUER,
        label: user.email,
        algorithm: 'SHA1',
        digits: this.TOTP_DIGITS,
        period: this.TOTP_PERIOD,
        secret: secret
      });

      // Get otpauth URL for QR code
      const otp_auth_url = totp.toString();

      // Generate QR code as data URL
      const qr_code_data_url = await QRCode.toDataURL(otp_auth_url, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Encrypt and store secret (not verified yet)
      const encrypted_secret = CryptoUtils.encrypt(secret.base32);

      await UserSecurity.findOneAndUpdate(
        { user_id },
        {
          'two_factor.totp_secret': encrypted_secret,
          'two_factor.totp_verified': false,
          'two_factor.method': 'authenticator_app'
          // is_enabled stays false until verified
        },
        { upsert: true }
      );

      logger.info('2FA setup initiated', { user_id });

      return {
        secret: secret.base32, // Show once for manual entry
        qr_code_url: otp_auth_url,
        qr_code_data_url,
        manual_entry_key: this.formatSecretForDisplay(secret.base32),
        issuer: this.ISSUER,
        account_name: user.email
      };
    } catch (error: any) {
      logger.error('Error setting up 2FA:', error);
      throw new Error('2FA_SETUP_FAILED');
    }
  }

  /**
   * Verify TOTP setup by checking user's first code
   * Enables 2FA and generates backup codes on success
   */
  async verifyTOTPSetup(
    user_id: string,
    code: string,
    device_context: DeviceContext
  ): Promise<{ success: boolean; backup_codes?: string[]; error?: string }> {
    try {
      logger.info('Verifying 2FA setup', { user_id });

      const security = await UserSecurity.findOne({ user_id });
      if (!security || !security.two_factor.totp_secret) {
        return { success: false, error: '2FA_NOT_INITIATED' };
      }

      // Decrypt secret
      const secret_base32 = CryptoUtils.decrypt(security.two_factor.totp_secret);

      // Verify the code
      const is_valid = this.verifyCode(secret_base32, code);

      if (!is_valid) {
        await AuditService.logAuthEvent({
          user_id,
          event_type: '2fa_failed',
          success: false,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Invalid verification code during setup'
          }
        });
        return { success: false, error: 'INVALID_CODE' };
      }

      // Generate backup codes
      const backup_codes = this.generateBackupCodes();
      const hashed_backup_codes = await this.hashBackupCodes(backup_codes);

      // Enable 2FA
      security.two_factor.is_enabled = true;
      security.two_factor.totp_verified = true;
      security.two_factor.enabled_at = new Date();
      security.two_factor.setup_required = false;
      security.two_factor.backup_codes = hashed_backup_codes;
      security.two_factor.backup_codes_generated_at = new Date();
      await security.save();

      await AuditService.logAuthEvent({
        user_id,
        event_type: '2fa_enabled',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      // Send 2FA enabled notification email
      const user = await User.findById(user_id).select('email profile.first_name');
      if (user) {
        await emailService.send2FAEnabledEmail(user.email, {
          user_name: user.profile?.first_name || 'User',
          method: 'Authenticator App',
          enabled_at: new Date()
        });
      }

      logger.info('2FA enabled successfully', { user_id });

      // Return plain backup codes (show once)
      return { success: true, backup_codes };
    } catch (error: any) {
      logger.error('Error verifying 2FA setup:', error);
      return { success: false, error: '2FA_VERIFICATION_FAILED' };
    }
  }

  // ============================================
  // TOTP VERIFICATION (Login)
  // ============================================

  /**
   * Verify TOTP code during login
   */
  async verifyTOTPCode(
    user_id: string,
    code: string,
    device_context: DeviceContext
  ): Promise<TOTPVerifyResult> {
    try {
      logger.info('Verifying 2FA code for login', { user_id });

      const security = await UserSecurity.findOne({ user_id });
      if (!security || !security.two_factor.is_enabled) {
        return { valid: false, error: '2FA_NOT_ENABLED' };
      }

      if (!security.two_factor.totp_secret || !security.two_factor.totp_verified) {
        return { valid: false, error: '2FA_NOT_SETUP' };
      }

      // Decrypt secret
      const secret_base32 = CryptoUtils.decrypt(security.two_factor.totp_secret);

      // Verify the code
      const is_valid = this.verifyCode(secret_base32, code);

      if (!is_valid) {
        await AuditService.logAuthEvent({
          user_id,
          event_type: '2fa_failed',
          success: false,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Invalid 2FA code'
          }
        });
        return { valid: false, error: 'INVALID_CODE' };
      }

      await AuditService.logAuthEvent({
        user_id,
        event_type: '2fa_verified',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      logger.info('2FA code verified successfully', { user_id });
      return { valid: true };
    } catch (error: any) {
      logger.error('Error verifying 2FA code:', error);
      return { valid: false, error: '2FA_VERIFICATION_FAILED' };
    }
  }

  // ============================================
  // BACKUP CODES
  // ============================================

  /**
   * Verify backup code (when user can't access authenticator)
   */
  async verifyBackupCode(
    user_id: string,
    code: string,
    device_context: DeviceContext
  ): Promise<TOTPVerifyResult> {
    try {
      logger.info('Verifying backup code', { user_id });

      const security = await UserSecurity.findOne({ user_id });
      if (!security || !security.two_factor.backup_codes) {
        return { valid: false, error: 'NO_BACKUP_CODES' };
      }

      // Normalize code (remove spaces/dashes)
      const normalized_code = code.replace(/[\s-]/g, '').toUpperCase();

      // Find matching unused backup code
      let found_index = -1;
      for (let i = 0; i < security.two_factor.backup_codes.length; i++) {
        const backup_code = security.two_factor.backup_codes[i];
        if (!backup_code.used) {
          const matches = await PasswordService.comparePassword(
            normalized_code,
            backup_code.code_hash
          );
          if (matches) {
            found_index = i;
            break;
          }
        }
      }

      if (found_index === -1) {
        await AuditService.logAuthEvent({
          user_id,
          event_type: '2fa_failed',
          success: false,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Invalid or used backup code'
          }
        });
        return { valid: false, error: 'INVALID_BACKUP_CODE' };
      }

      // Mark code as used
      security.two_factor.backup_codes[found_index].used = true;
      security.two_factor.backup_codes[found_index].used_at = new Date();
      await security.save();

      // Count remaining codes
      const remaining_codes = security.two_factor.backup_codes.filter(c => !c.used).length;

      await AuditService.logAuthEvent({
        user_id,
        event_type: '2fa_verified',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          remaining_backup_codes: remaining_codes
        }
      });

      logger.info('Backup code verified', { user_id, remaining_codes });

      // Warn if running low on backup codes
      if (remaining_codes <= 2) {
        logger.warn('User running low on backup codes', { user_id, remaining_codes });
      }

      return { valid: true };
    } catch (error: any) {
      logger.error('Error verifying backup code:', error);
      return { valid: false, error: 'BACKUP_CODE_VERIFICATION_FAILED' };
    }
  }

  /**
   * Regenerate backup codes (invalidates old ones)
   */
  async regenerateBackupCodes(
    user_id: string,
    password: string,
    device_context: DeviceContext
  ): Promise<BackupCodesResult | { error: string }> {
    try {
      logger.info('Regenerating backup codes', { user_id });

      // Verify password first
      const user = await User.findById(user_id);
      if (!user) {
        return { error: 'USER_NOT_FOUND' };
      }

      const is_password_valid = await PasswordService.comparePassword(password, user.password_hash);
      if (!is_password_valid) {
        await AuditService.logAuthEvent({
          user_id,
          event_type: '2fa_failed',
          success: false,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Invalid password for backup code regeneration'
          }
        });
        return { error: 'INVALID_PASSWORD' };
      }

      const security = await UserSecurity.findOne({ user_id });
      if (!security || !security.two_factor.is_enabled) {
        return { error: '2FA_NOT_ENABLED' };
      }

      // Generate new backup codes
      const backup_codes = this.generateBackupCodes();
      const hashed_backup_codes = await this.hashBackupCodes(backup_codes);

      // Replace old codes
      security.two_factor.backup_codes = hashed_backup_codes;
      security.two_factor.backup_codes_generated_at = new Date();
      await security.save();

      await AuditService.logAuthEvent({
        user_id,
        event_type: '2fa_enabled',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      // Send backup codes regenerated notification
      await emailService.sendBackupCodesGeneratedEmail(user.email, {
        user_name: user.profile?.first_name || 'User',
        generated_at: new Date()
      });

      logger.info('Backup codes regenerated', { user_id });

      return {
        codes: backup_codes,
        generated_at: new Date()
      };
    } catch (error: any) {
      logger.error('Error regenerating backup codes:', error);
      return { error: 'BACKUP_CODES_REGENERATION_FAILED' };
    }
  }

  // ============================================
  // DISABLE 2FA
  // ============================================

  /**
   * Disable 2FA (requires password confirmation)
   */
  async disableTOTP(
    user_id: string,
    password: string,
    device_context: DeviceContext
  ): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info('Disabling 2FA', { user_id });

      // Verify password first
      const user = await User.findById(user_id);
      if (!user) {
        return { success: false, error: 'USER_NOT_FOUND' };
      }

      const is_password_valid = await PasswordService.comparePassword(password, user.password_hash);
      if (!is_password_valid) {
        await AuditService.logAuthEvent({
          user_id,
          event_type: '2fa_failed',
          success: false,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Invalid password for 2FA disable'
          }
        });
        return { success: false, error: 'INVALID_PASSWORD' };
      }

      // Disable 2FA
      await UserSecurity.findOneAndUpdate(
        { user_id },
        {
          'two_factor.is_enabled': false,
          'two_factor.method': 'none',
          'two_factor.totp_secret': null,
          'two_factor.totp_verified': false,
          'two_factor.enabled_at': null,
          'two_factor.backup_codes': [],
          'two_factor.backup_codes_generated_at': null
        }
      );

      await AuditService.logAuthEvent({
        user_id,
        event_type: '2fa_disabled',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      // Send 2FA disabled notification
      await emailService.send2FADisabledEmail(user.email, {
        user_name: user.profile?.first_name || 'User',
        disabled_at: new Date(),
        ip_address: device_context.ip_address
      });

      logger.info('2FA disabled successfully', { user_id });

      return { success: true };
    } catch (error: any) {
      logger.error('Error disabling 2FA:', error);
      return { success: false, error: '2FA_DISABLE_FAILED' };
    }
  }

  // ============================================
  // STATUS & INFO
  // ============================================

  /**
   * Get 2FA status for a user
   */
  async getStatus(user_id: string): Promise<TwoFactorStatus> {
    try {
      const security = await UserSecurity.findOne({ user_id });

      if (!security) {
        return {
          is_enabled: false,
          method: 'none',
          has_backup_codes: false,
          backup_codes_count: 0
        };
      }

      const unused_backup_codes = security.two_factor.backup_codes?.filter(c => !c.used).length || 0;

      return {
        is_enabled: security.two_factor.is_enabled,
        method: security.two_factor.method,
        enabled_at: security.two_factor.enabled_at,
        has_backup_codes: unused_backup_codes > 0,
        backup_codes_count: unused_backup_codes,
        recovery_email: security.two_factor.recovery_email,
        recovery_phone: security.two_factor.recovery_phone
      };
    } catch (error: any) {
      logger.error('Error getting 2FA status:', error);
      throw new Error('2FA_STATUS_FETCH_FAILED');
    }
  }

  /**
   * Check if user has 2FA enabled
   */
  async isEnabled(user_id: string): Promise<boolean> {
    try {
      const security = await UserSecurity.findOne({ user_id });
      return security?.two_factor.is_enabled || false;
    } catch (error: any) {
      logger.error('Error checking 2FA status:', error);
      return false;
    }
  }

  // ============================================
  // RECOVERY OPTIONS
  // ============================================

  /**
   * Set recovery email for 2FA
   */
  async setRecoveryEmail(
    user_id: string,
    recovery_email: string,
    device_context: DeviceContext
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await UserSecurity.findOneAndUpdate(
        { user_id },
        { 'two_factor.recovery_email': recovery_email.toLowerCase() }
      );

      await AuditService.logAuthEvent({
        user_id,
        event_type: '2fa_enabled',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      logger.info('Recovery email set', { user_id });
      return { success: true };
    } catch (error: any) {
      logger.error('Error setting recovery email:', error);
      return { success: false, error: 'RECOVERY_EMAIL_SET_FAILED' };
    }
  }

  /**
   * Set recovery phone for 2FA
   */
  async setRecoveryPhone(
    user_id: string,
    recovery_phone: string,
    device_context: DeviceContext
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await UserSecurity.findOneAndUpdate(
        { user_id },
        { 'two_factor.recovery_phone': recovery_phone }
      );

      await AuditService.logAuthEvent({
        user_id,
        event_type: '2fa_enabled',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      logger.info('Recovery phone set', { user_id });
      return { success: true };
    } catch (error: any) {
      logger.error('Error setting recovery phone:', error);
      return { success: false, error: 'RECOVERY_PHONE_SET_FAILED' };
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Verify TOTP code against secret
   */
  private verifyCode(secret_base32: string, code: string): boolean {
    try {
      const totp = new OTPAuth.TOTP({
        issuer: this.ISSUER,
        label: 'user',
        algorithm: 'SHA1',
        digits: this.TOTP_DIGITS,
        period: this.TOTP_PERIOD,
        secret: OTPAuth.Secret.fromBase32(secret_base32)
      });

      // Validate with window of 1 (allows 1 period before/after)
      const delta = totp.validate({ token: code, window: 1 });
      return delta !== null;
    } catch (error: any) {
      logger.error('Error verifying TOTP code:', error);
      return false;
    }
  }

  /**
   * Generate backup codes
   */
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0, O, 1, I)

    for (let i = 0; i < this.BACKUP_CODES_COUNT; i++) {
      let code = '';
      for (let j = 0; j < this.BACKUP_CODE_LENGTH; j++) {
        code += chars[CryptoUtils.randomInt(chars.length)];
      }
      // Format as XXXX-XXXX for readability
      codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
    }

    return codes;
  }

  /**
   * Hash backup codes for storage
   */
  private async hashBackupCodes(codes: string[]): Promise<{ code_hash: string; used: boolean; used_at?: Date }[]> {
    const hashed_codes = [];
    for (const code of codes) {
      const normalized = code.replace(/[\s-]/g, '').toUpperCase();
      const hash = await PasswordService.hashPassword(normalized);
      hashed_codes.push({
        code_hash: hash,
        used: false
      });
    }
    return hashed_codes;
  }

  /**
   * Format secret for manual entry (groups of 4)
   */
  private formatSecretForDisplay(secret: string): string {
    return secret.match(/.{1,4}/g)?.join(' ') || secret;
  }
}

export const twoFactorService = new TwoFactorService();
