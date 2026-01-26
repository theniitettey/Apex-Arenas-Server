import crypto from 'crypto';
import { CryptoUtils } from "../../../shared/utils/crypto.utils";
import { env } from "../../../configs/env.config";
import { createLogger } from "../../../shared/utils/logger.utils";

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

    // Check for common weak passwords (basic check)
    const weakPasswords = ['password', '123456', 'qwerty', 'letmein', 'welcome', 'admin', 'user'];
    if (weakPasswords.includes(password.toLowerCase())) {
      errors.push('Password is too common and easily guessable');
      strength_score = Math.max(0, strength_score - 40);
    }

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
      throw new Error("PASSWORD_HASHING_FAILED");
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
      throw new Error("PASSWORD_COMPARISON_FAILED");
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
    for (const hash of previousHashes) {
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
   * Check if password has been compromised in known breaches
   * Note: This is a basic implementation. Consider integrating with 'HAVE I BEEN PWNED API'
   */
  static async checkPasswordBreach(password: string): Promise<boolean> {
    // Basic implementation - in production integrate with HIBP API
    // For now, just checking against a small list of known compromised passwords
    const knownBreachPasswords = [
      'password123',
      '12345678',
      'qwerty123',
      'letmein123',
      'welcome123',
      'admin123',
      'user123'
    ];

    return knownBreachPasswords.includes(password.toLowerCase());
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

export const passwordService = new PasswordService();
