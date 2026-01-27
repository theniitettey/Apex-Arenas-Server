import { Router } from 'express';
import { passwordController } from '../controllers/auth.password.controller';
import {
  userAuthMiddleware,
  asyncHandler,
  authErrorHandler,
  passwordResetRateLimiter,
  apiRateLimiter
} from '../middlewares';
import {
  validateRequest,
  changePasswordSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
  validatePasswordSchema
} from '../middlewares/auth.validation.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-password-routes');

const router: Router = Router();

// ============================================
// USER PASSWORD ROUTES
// ============================================

/**
 * POST /auth/password/change
 * Change password for authenticated user
 * Requires user authentication
 */
router.post(
  '/password/change',
  userAuthMiddleware,
  validateRequest(changePasswordSchema),
  asyncHandler(passwordController.changePassword.bind(passwordController))
);

/**
 * POST /auth/password/reset
 * Request password reset - sends OTP to email
 * Public (rate limited)
 */
router.post(
  '/password/reset',
  passwordResetRateLimiter,
  validateRequest(requestPasswordResetSchema),
  asyncHandler(passwordController.requestPasswordReset.bind(passwordController))
);

/**
 * POST /auth/password/reset/confirm
 * Confirm password reset with OTP
 * Public (rate limited)
 */
router.post(
  '/password/reset/confirm',
  passwordResetRateLimiter,
  validateRequest(confirmPasswordResetSchema),
  asyncHandler(passwordController.confirmPasswordReset.bind(passwordController))
);

/**
 * POST /auth/password/validate
 * Validate password strength (for client-side feedback)
 * Public (rate limited)
 */
router.post(
  '/password/validate',
  apiRateLimiter,
  validateRequest(validatePasswordSchema),
  asyncHandler(passwordController.validatePassword.bind(passwordController))
);

// ============================================
// ADMIN PASSWORD ROUTES
// ============================================

/**
 * POST /auth/admin/password/reset
 * Request password reset for admin
 * Public but with stricter rate limiting
 */
router.post(
  '/admin/password/reset',
  passwordResetRateLimiter,
  validateRequest(requestPasswordResetSchema),
  asyncHandler(passwordController.requestAdminPasswordReset.bind(passwordController))
);

/**
 * POST /auth/admin/password/reset/confirm
 * Confirm admin password reset with OTP
 * Uses same endpoint as user, validation happens in service
 */
router.post(
  '/admin/password/reset/confirm',
  passwordResetRateLimiter,
  validateRequest(confirmPasswordResetSchema),
  asyncHandler(passwordController.confirmPasswordReset.bind(passwordController))
);

// ============================================
// Error Handler
// ============================================

router.use(authErrorHandler);

export default router;
