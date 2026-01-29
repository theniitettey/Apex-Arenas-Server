// JWT Authentication
export {
  userAuthMiddleware,
  adminAuthMiddleware,
  optionalAuthMiddleware,
  requireRole,
  AuthRequest
} from './auth.jwt.middleware';

// Admin Middleware
export {
  verifyAdminWhitelist,
  logAdminAction,
  requireSuperAdmin,
  preventSelfAction
} from './auth.admin.middleware';

// Internal Service Auth
export {
  internalAuthMiddleware,
  adminOrInternalMiddleware,
  InternalRequest
} from './auth.internal.middleware';

// Rate Limiting
export {
  createRateLimiter,
  loginRateLimiter,
  adminLoginRateLimiter,
  registrationRateLimiter,
  otpRateLimiter,
  passwordResetRateLimiter,
  apiRateLimiter,
  adminActionRateLimiter
} from './auth.ratelimit.middleware';

// Error Handling
export {
  AuthError,
  authErrorHandler,
  asyncHandler
} from './auth.error.middleware';

// Validation
export {
  validateRequest,
  validateQuery,
  validateParams,
  // Schemas
  registerSchema,
  loginSchema,
  adminLoginSchema,
  changePasswordSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
  validatePasswordSchema,
  requestOtpSchema,
  verifyOtpSchema,
  verifyEmailSchema,
  verify2FASchema,
  setup2FAVerifySchema,
  updateProfileSchema
} from './auth.validation.middleware';
