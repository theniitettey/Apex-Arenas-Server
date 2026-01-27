import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-error-middleware');

/**
 * Custom Auth Error class
 */
export class AuthError extends Error {
  public status_code: number;
  public error_code: string;
  public details?: any;

  constructor(message: string, status_code: number = 500, error_code: string = 'AUTH_ERROR', details?: any) {
    super(message);
    this.name = 'AuthError';
    this.status_code = status_code;
    this.error_code = error_code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Auth error handler middleware
 */
export const authErrorHandler = (
  error: Error | AuthError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log the error
  logger.error('Auth error occurred', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    user_agent: req.get('user-agent')
  });

  // Handle AuthError
  if (error instanceof AuthError) {
    return res.status(error.status_code).json({
      success: false,
      error: error.message,
      error_code: error.error_code,
      details: error.details
    });
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
      error_code: 'INVALID_TOKEN'
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Token expired',
      error_code: 'TOKEN_EXPIRED'
    });
  }

  // Handle validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      error_code: 'VALIDATION_ERROR',
      details: error.message
    });
  }

  // Handle MongoDB duplicate key error
  if ((error as any).code === 11000) {
    return res.status(409).json({
      success: false,
      error: 'Duplicate entry',
      error_code: 'DUPLICATE_ENTRY'
    });
  }

  // Default server error
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    error_code: 'INTERNAL_ERROR'
  });
};

/**
 * Async handler wrapper to catch errors
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
