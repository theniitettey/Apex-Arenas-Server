import crypto from 'crypto';
import { CryptoUtils } from "../../../shared/utils/crypto.utils";
import { env } from "../../../configs/env.config";
import { createLogger } from "../../../shared/utils/logger.utils";
import { AUTH_ERROR_CODES } from "../../../shared/constants/error-codes"; // Add this import

const logger = createLogger('auth-password-service');

export interface PasswordValidationResult {
  is_valid: boolean;
  errors: string[];
  strength_score?: number;
}

export interface PasswordChangeResult {
  success: boolean;
  message: string;
}

/**
 * Password service handling password validation, hashing and verification 
 */

export class PasswordService {

  /**
   * Validate password strength based on environment rules 
   */
  static validatePasswordStrength(password: string): PasswordValidationResult {
    const errors: string[] = [];
    let strength_score = 0;

    // Check minimum length
    if (password.length < env.MIN_PASSWORD_LENGTH) {
      errors.push(`Password must be at least ${env.MIN_PASSWORD_LENGTH} characters long`);
    } else {
      strength_score += 20;
    }

    // Check maximum length
    if (password.length > env.MAX_PASSWORD_LENGTH) {
      errors.push(`Password must be less than ${env.MAX_PASSWORD_LENGTH} characters`);
    }

    // Check for at least one uppercase letter
    if (!/(?=.*[A-Z])/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    } else {
      strength_score += 20;
    }

    // Check for at least one lowercase letter
    if (!/(?=.*[a-z])/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    } else {
      strength_score += 20;
    }

    // Check for at least one number
    if (!/(?=.*\d)/.test(password)) {
      errors.push('Password must contain at least one number');
    } else {
      strength_score += 20;
    }

    // Check for at least one special character
    if (!/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/.test(password)) {
      errors.push('Password must contain at least one special character');
    } else {
      strength_score += 20;
    }

    // Bonus points for length
    if (password.length >= 12) strength_score += 10;
    if (password.length >= 16) strength_score += 10;

    // Cap at 100
    strength_score = Math.min(100, strength_score);

    return {
      is_valid: errors.length === 0,
      errors,
      strength_score
    };
  }

  /**
   * Hash password using crypto utils 
   */
  static async hashPassword(plainPassword: string): Promise<string> {
    try {
      logger.debug("Hashing password");
      return await CryptoUtils.hashSensitive(plainPassword);
    } catch (error: any) {
      logger.error('Error hashing password:', error);
      throw new Error(AUTH_ERROR_CODES.HASHING_FAILED); // changed
    }
  }

  /**
   * Compare plain password with hashed password 
   */
  static async comparePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    try {
      logger.debug('Comparing password with hash');
      return await CryptoUtils.compareHash(plainPassword, hashedPassword);
    } catch (error: any) {
      logger.error('Error comparing password:', error);
      throw new Error(AUTH_ERROR_CODES.HASH_COMPARISON_FAILED); // changed
    }
  }

  /**
   * Check if password is different from current hash
   */
  static async isPasswordDifferent(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return !(await this.comparePassword(plainPassword, hashedPassword));
  }

  /**
   * Check if new password matches any previous passwords
   */
  static async isPasswordReused(
    plainPassword: string, 
    previousHashes: string[]
  ): Promise<boolean> {
    const historyLimit = env.PASSWORD_HISTORY_COUNT;
    const hashesToCheck = previousHashes.slice(0, historyLimit);
    
    for (const hash of hashesToCheck) {
      const matches = await this.comparePassword(plainPassword, hash);
      if (matches) {
        return true;
      }
    }
    return false;
  }

  /**
   * Generate a secure random password using crypto
   */
  static generateSecurePassword(length: number = 16): string {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*';
    const allChars = uppercase + lowercase + numbers + special;

    // Ensure at least one of each required character type
    let password = '';
    password += uppercase[crypto.randomInt(uppercase.length)];
    password += lowercase[crypto.randomInt(lowercase.length)];
    password += numbers[crypto.randomInt(numbers.length)];
    password += special[crypto.randomInt(special.length)];

    // Fill the rest with random characters
    for (let i = password.length; i < length; i++) {
      password += allChars[crypto.randomInt(allChars.length)];
    }

    // Cryptographically secure shuffle using Fisher-Yates
    const chars = password.split('');
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
  }

  /**
   * Check if password has been compromised using Have I Been Pwned API
   * Uses k-Anonymity model - only sends first 5 chars of SHA1 hash
   */
  static async checkPasswordBreach(password: string): Promise<boolean> {
    // Check if HIBP is enabled
    if (!env.HIBP_API_ENABLED) {
      logger.debug('HIBP API disabled, skipping breach check');
      return false;
    }

    try {
      // Create SHA1 hash of password
      const sha1Hash = crypto
        .createHash('sha1')
        .update(password)
        .digest('hex')
        .toUpperCase();

      // k-Anonymity: only send first 5 characters
      const prefix = sha1Hash.substring(0, 5);
      const suffix = sha1Hash.substring(5);

      // Call HIBP API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), env.HIBP_API_TIMEOUT_MS);

      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        method: 'GET',
        headers: {
          'User-Agent': `${env.APP_NAME}-PasswordChecker`,
          'Add-Padding': 'true', // Adds padding to prevent response length analysis
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('HIBP API returned non-OK status', { status: response.status });
        return false; // Fail open - don't block user if API is down
      }

      const text = await response.text();
      
      // Parse response - format is "SUFFIX:COUNT\r\n"
      const lines = text.split('\r\n');
      
      for (const line of lines) {
        const [hashSuffix, count] = line.split(':');
        if (hashSuffix === suffix) {
          const breachCount = parseInt(count, 10);
          logger.warn('Password found in breach database', { breach_count: breachCount });
          return true;
        }
      }

      logger.debug('Password not found in breach database');
      return false;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.warn('HIBP API request timed out');
      } else {
        logger.error('Error checking HIBP API:', error);
      }
      // Fail open - don't block user registration if API fails
      return false;
    }
  }

  /**
   * Quick local check against known weak passwords
   * Used as fallback or additional check
   */
  static isCommonPassword(password: string): boolean {
    const commonPasswords = [
      'password', 'password1', 'password123', '123456', '12345678', '123456789',
      'qwerty', 'qwerty123', 'letmein', 'welcome', 'admin', 'admin123',
      'login', 'master', 'dragon', 'baseball', 'iloveyou', 'trustno1',
      'sunshine', 'princess', 'football', 'monkey', 'shadow', 'superman',
      'michael', 'jennifer', 'hunter', 'abc123', '654321', 'password1!',
    ];
    return commonPasswords.includes(password.toLowerCase());
  }

  /**
   * Full password breach check - combines HIBP + local list
   */
  static async isPasswordCompromised(password: string): Promise<{ compromised: boolean; reason?: string }> {
    // Check local common passwords first (fast)
    if (this.isCommonPassword(password)) {
      return { compromised: true, reason: 'common_password' };
    }

    // Check HIBP API
    const inBreach = await this.checkPasswordBreach(password);
    if (inBreach) {
      return { compromised: true, reason: 'found_in_breach' };
    }

    return { compromised: false };
  }
}

// Export individual functions for convenience
export const validatePasswordStrength = PasswordService.validatePasswordStrength;
export const hashPassword = PasswordService.hashPassword;
export const comparePassword = PasswordService.comparePassword;
export const isPasswordDifferent = PasswordService.isPasswordDifferent;
export const isPasswordReused = PasswordService.isPasswordReused;
export const generateSecurePassword = PasswordService.generateSecurePassword;
export const checkPasswordBreach = PasswordService.checkPasswordBreach;
export const isPasswordCompromised = PasswordService.isPasswordCompromised;

export const passwordService = new PasswordService();
