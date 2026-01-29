import { Response } from 'express';
import { getMessageForError, getStatusForError } from '../constants/error-codes';

/**
 * Standard success response
 */
export const sendSuccess = <T = any>(
  res: Response,
  data?: T,
  message?: string,
  statusCode: number = 200
): Response => {
  const response: any = { success: true };
  if (message) response.message = message;
  if (data !== undefined) response.data = data;
  return res.status(statusCode).json(response);
};

/**
 * Standard created response (201)
 */
export const sendCreated = <T = any>(
  res: Response,
  data?: T,
  message?: string
): Response => {
  return sendSuccess(res, data, message, 201);
};

/**
 * Standard error response with automatic status code mapping
 */
export const sendError = (
  res: Response,
  errorCode: string,
  details?: any,
  customMessage?: string // Optional override for user-friendly message
): Response => {
  const response: any = {
    success: false,
    error: customMessage || getMessageForError(errorCode),
    error_code: errorCode,
  };
  if (details !== undefined) response.details = details;
  return res.status(getStatusForError(errorCode)).json(response);
};

/**
 * Not found response (404)
 */
export const sendNotFound = (
  res: Response,
  errorCode: string = 'RESOURCE_NOT_FOUND',
  details?: any
): Response => {
  return sendError(res, errorCode, details);
};

/**
 * Unauthorized response (401)
 */
export const sendUnauthorized = (
  res: Response,
  errorCode: string = 'AUTH_REQUIRED',
  details?: any
): Response => {
  return sendError(res, errorCode, details);
};

/**
 * Forbidden response (403)
 */
export const sendForbidden = (
  res: Response,
  errorCode: string = 'ACCESS_DENIED',
  details?: any
): Response => {
  return sendError(res, errorCode, details);
};

/**
 * Rate limited response (429)
 */
export const sendRateLimited = (
  res: Response,
  retryAfter?: number,
  errorCode: string = 'RATE_LIMITED'
): Response => {
  if (retryAfter) {
    res.setHeader('Retry-After', retryAfter);
  }
  return sendError(
    res, 
    errorCode, 
    retryAfter ? { retry_after: retryAfter } : undefined
  );
};

/**
 * Validation error response (400)
 */
export const sendValidationError = (
  res: Response,
  errors: { field: string; message: string }[],
  errorCode: string = 'VALIDATION_ERROR'
): Response => {
  return sendError(res, errorCode, errors);
};

/**
 * Server error response (500)
 */
export const sendServerError = (
  res: Response,
  errorCode: string = 'INTERNAL_ERROR',
  details?: any
): Response => {
  return sendError(res, errorCode, details);
};