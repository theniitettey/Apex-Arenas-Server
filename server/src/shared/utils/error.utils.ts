/**
 * ============================================
 * ERROR UTILITIES
 * ============================================
 * Custom error class for consistent error handling
 * Works with your existing error-codes.ts
 */

import { AUTH_ERROR_CODES, getStatusForError, getMessageForError } from '../constants/error-codes';

/**
 * Custom Application Error
 * Extends native Error with code and status
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(code: string, message?: string, statusCode?: number, isOperational = true) {
    // Use provided message or get from error codes
    super(message || getMessageForError(code) || code);

    this.code = code;
    this.statusCode = statusCode || getStatusForError(code) || 500;
    this.isOperational = isOperational;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Set the prototype explicitly to ensure instanceof works correctly
    Object.setPrototypeOf(this, AppError.prototype);

    this.name = this.constructor.name;
  }

  /**
   * Convert error to JSON for API responses
   */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode
      }
    };
  }

  /**
   * Check if error is an AppError instance
   */
  static isAppError(error: any): error is AppError {
    return error instanceof AppError;
  }
}

/**
 * Common error creators for convenience
 */
export const ErrorFactory = {
  /**
   * Authentication errors
   */
  authRequired: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.AUTH_REQUIRED, message),

  invalidCredentials: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, message),

  invalidToken: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.INVALID_TOKEN, message),

  tokenExpired: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.TOKEN_EXPIRED, message),

  notAuthenticated: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.NOT_AUTHENTICATED, message),

  /**
   * Authorization errors
   */
  adminRequired: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.ADMIN_REQUIRED, message),

  accountBanned: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.ACCOUNT_BANNED, message),

  accountInactive: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.ACCOUNT_INACTIVE, message),

  accountLocked: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.ACCOUNT_LOCKED, message),

  /**
   * Resource not found errors
   */
  userNotFound: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.USER_NOT_FOUND, message),

  sessionNotFound: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.SESSION_NOT_FOUND, message),

  /**
   * Validation errors
   */
  validationError: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.VALIDATION_ERROR, message),

  missingFields: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.MISSING_FIELDS, message),

  weakPassword: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.WEAK_PASSWORD, message),

  /**
   * Rate limiting errors
   */
  rateLimited: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.RATE_LIMITED, message),

  rateLimitExceeded: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.RATE_LIMIT_EXCEEDED, message),

  /**
   * 2FA errors
   */
  twoFARequired: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.TWO_FA_REQUIRED, message),

  twoFAInvalidCode: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.TWO_FA_INVALID_CODE, message),

  /**
   * Generic errors
   */
  internalError: (message?: string) => 
    new AppError(AUTH_ERROR_CODES.INTERNAL_ERROR, message),

  /**
   * Custom error with any code
   */
  custom: (code: string, message?: string, statusCode?: number) => 
    new AppError(code, message, statusCode)
};

/**
 * Error handler middleware helper
 * Converts any error to a consistent format
 */
export const normalizeError = (error: any): {
  code: string;
  message: string;
  statusCode: number;
  stack?: string;
} => {
  if (AppError.isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }

  // Handle MongoDB duplicate key errors
  if (error.code === 11000 || error.code === 11001) {
    const field = Object.keys(error.keyPattern || {})[0] || 'field';
    return {
      code: field.includes('email') 
        ? AUTH_ERROR_CODES.EMAIL_ALREADY_EXISTS 
        : AUTH_ERROR_CODES.USERNAME_ALREADY_EXISTS,
      message: `${field} already exists`,
      statusCode: 409
    };
  }

  // Handle MongoDB validation errors
  if (error.name === 'ValidationError') {
    const messages = Object.values(error.errors || {})
      .map((err: any) => err.message)
      .join(', ');
    return {
      code: AUTH_ERROR_CODES.VALIDATION_ERROR,
      message: messages || 'Validation failed',
      statusCode: 400
    };
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return {
      code: AUTH_ERROR_CODES.INVALID_TOKEN,
      message: 'Invalid token',
      statusCode: 401
    };
  }

  if (error.name === 'TokenExpiredError') {
    return {
      code: AUTH_ERROR_CODES.TOKEN_EXPIRED,
      message: 'Token has expired',
      statusCode: 401
    };
  }

  // Default error
  return {
    code: AUTH_ERROR_CODES.INTERNAL_ERROR,
    message: error.message || 'An unexpected error occurred',
    statusCode: error.statusCode || 500,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  };
};

/**
 * Check if error is operational (expected) or programming error
 */
export const isOperationalError = (error: any): boolean => {
  if (AppError.isAppError(error)) {
    return error.isOperational;
  }
  return false;
};