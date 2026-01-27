// Error handling
export { AuthError, authErrorHandler, asyncHandler } from './auth.error.middleware';

// JWT Authentication
export { 
  AuthRequest,
  userAuthMiddleware, 
  adminAuthMiddleware, 
  optionalAuthMiddleware,
  requireRole
} from './auth.jwt.middleware';

// Internal service authentication
export { 
  InternalRequest,
  internalAuthMiddleware,
  adminOrInternalMiddleware
} from './auth.internal.middleware';

// Rate limiting
export {
  RateLimitOptions,
  createRateLimiter,
  loginRateLimiter,
  adminLoginRateLimiter,
  registrationRateLimiter,
  otpRateLimiter,
  passwordResetRateLimiter,
  apiRateLimiter,
  adminActionRateLimiter
} from './auth.ratelimit.middleware';

// Admin-specific
export {
  verifyAdminWhitelist,
  logAdminAction,
  requireSuperAdmin,
  preventSelfAction
} from './auth.admin.middleware';
