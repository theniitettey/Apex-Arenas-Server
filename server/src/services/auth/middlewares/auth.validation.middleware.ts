import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-validation-middleware');

const PASSWORD_REQUIREMENTS = 'Password must be at least 8 characters and contain uppercase, lowercase, number, and special character';

// ============================================
// VALIDATION SCHEMAS
// ============================================

// Registration
export const registerSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be less than 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
    .toLowerCase()
    .trim(),
  
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
      PASSWORD_REQUIREMENTS
    ),
  
  first_name: z.string()
    .min(2, 'First name must be at least 2 characters')
    .max(50, 'First name is too long')
    .trim()
    .regex(/^[a-zA-Z\s'-]+$/, 'First name can only contain letters, spaces, hyphens, and apostrophes'),

  last_name: z.string()
    .min(2, 'Last name must be at least 2 characters')
    .max(50, 'Last name is too long')
    .trim()
    .regex(/^[a-zA-Z\s'-]+$/, 'Last name can only contain letters, spaces, hyphens, and apostrophes'),

  role: z.enum(['player', 'organizer']).optional().default('player')
});

// Login
export const loginSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  password: z.string()
    .min(1, 'Password is required')
});

// Admin Login
export const adminLoginSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  password: z.string()
    .min(1, 'Password is required'),

  admin_secret: z.string().optional()
});

// Refresh Token
export const refreshTokenSchema = z.object({
  refresh_token: z.string()
    .min(1, 'Refresh token is required')
});

// Change Password (authenticated)
export const changePasswordSchema = z.object({
  current_password: z.string()
    .min(1, 'Current password is required'),
  
  new_password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
      PASSWORD_REQUIREMENTS
    ),
  
  confirm_password: z.string()
    .min(1, 'Please confirm your password')
}).refine((data) => data.new_password === data.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password']
}).refine((data) => data.current_password !== data.new_password, {
  message: 'New password must be different from current password',
  path: ['new_password']
});

// Request Password Reset (forgot password)
export const requestPasswordResetSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim()
});

// Confirm Password Reset (with OTP)
export const confirmPasswordResetSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d+$/, 'OTP must contain only numbers'),
  
  new_password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
      PASSWORD_REQUIREMENTS
    ),
  
  confirm_password: z.string()
    .min(1, 'Please confirm your password')
}).refine((data) => data.new_password === data.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password']
});

// Validate Password Strength (public endpoint)
export const validatePasswordSchema = z.object({
  password: z.string()
    .min(1, 'Password is required')
});

// OTP Schemas
export const OTPTypes = ['email_verification', 'password_reset', 'phone_verification', '2fa_login', 'withdrawal_confirmation'] as const;

export const requestOtpSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  type: z.enum(OTPTypes, {
    error: `OTP type must be one of: ${OTPTypes.join(', ')}`
  })
});

export const verifyOtpSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d+$/, 'OTP must contain only numbers'),

  type: z.enum(OTPTypes)
});

// Verify Email
export const verifyEmailSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d+$/, 'OTP must contain only numbers')
});

// 2FA Schemas
export const verify2FASchema = z.object({
  user_id: z.string()
    .min(1, 'User ID is required'),
  
  code: z.string()
    .min(6, 'Code must be at least 6 characters')
    .max(10, 'Code is too long'),
  
  use_backup_code: z.boolean().optional().default(false)
});

export const setup2FAVerifySchema = z.object({
  code: z.string()
    .length(6, 'Code must be 6 digits')
    .regex(/^\d+$/, 'Code must contain only numbers')
});

export const disable2FASchema = z.object({
  password: z.string()
    .min(1, 'Password is required')
});

export const regenerateBackupCodesSchema = z.object({
  password: z.string()
    .min(1, 'Password is required')
});

// Profile Update
export const updateProfileSchema = z.object({
  first_name: z.string()
    .min(2, 'First name must be at least 2 characters')
    .max(50, 'First name is too long')
    .trim()
    .regex(/^[a-zA-Z\s'-]+$/, 'First name can only contain letters')
    .optional(),
  
  last_name: z.string()
    .min(2, 'Last name must be at least 2 characters')
    .max(50, 'Last name is too long')
    .trim()
    .regex(/^[a-zA-Z\s'-]+$/, 'Last name can only contain letters')
    .optional(),

  bio: z.string()
    .max(500, 'Bio must be less than 500 characters')
    .optional(),

  phone_number: z.string()
    .regex(/^\+?[0-9]{10,15}$/, 'Invalid phone number format')
    .optional(),

  country: z.string()
    .length(2, 'Country must be 2-letter ISO code')
    .toUpperCase()
    .optional(),

  social_links: z.object({
    discord: z.string().url('Invalid Discord URL').optional().or(z.literal('')),
    twitter: z.string().url('Invalid Twitter URL').optional().or(z.literal('')),
    twitch: z.string().url('Invalid Twitch URL').optional().or(z.literal('')),
    youtube: z.string().url('Invalid YouTube URL').optional().or(z.literal(''))
  }).optional()
}).refine((data) => {
  // At least one field must be provided
  return Object.keys(data).some(key => data[key as keyof typeof data] !== undefined);
}, {
  message: 'At least one field must be provided for update'
});

// Admin Setup
export const adminSetupSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),

  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be less than 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
    .toLowerCase()
    .trim(),
  
  password: z.string()
    .min(12, 'Admin password must be at least 12 characters')
    .max(128, 'Password is too long')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
      'Admin password must contain uppercase, lowercase, number, and special character'
    ),
  
  first_name: z.string()
    .min(2, 'First name must be at least 2 characters')
    .max(50, 'First name is too long')
    .trim(),

  last_name: z.string()
    .min(2, 'Last name must be at least 2 characters')
    .max(50, 'Last name is too long')
    .trim()
});

// Logout
export const logoutSchema = z.object({
  refresh_token: z.string().optional()
});

// ============================================
// VALIDATION MIDDLEWARE
// ============================================

/**
 * Validate request body against a Zod schema
 */
export const validateRequest = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated_data = schema.parse(req.body);
      req.body = validated_data;
      
      logger.debug('Request validation successful', {
        path: req.path,
        method: req.method
      });
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formatted_errors = error.issues.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));

        logger.warn('Request validation failed', {
          path: req.path,
          method: req.method,
          errors: formatted_errors,
          ip: req.ip
        });

        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          error_code: 'VALIDATION_ERROR',
          details: formatted_errors
        });
      }
      
      next(error);
    }
  };
};

/**
 * Validate query parameters against a Zod schema
 */
export const validateQuery = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated_data = schema.parse(req.query);
      req.query = validated_data as typeof req.query;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formatted_errors = error.issues.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));

        return res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          error_code: 'VALIDATION_ERROR',
          details: formatted_errors
        });
      }
      
      next(error);
    }
  };
};

/**
 * Validate route parameters against a Zod schema
 */
export const validateParams = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated_data = schema.parse(req.params);
      req.params = validated_data as typeof req.params;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formatted_errors = error.issues.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));

        return res.status(400).json({
          success: false,
          error: 'Invalid route parameters',
          error_code: 'VALIDATION_ERROR',
          details: formatted_errors
        });
      }
      
      next(error);
    }
  };
};
