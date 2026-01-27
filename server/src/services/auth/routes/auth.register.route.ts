import { Router } from 'express';
import { registerController } from '../controllers/auth.register.controller';
import {
  asyncHandler,
  authErrorHandler,
  registrationRateLimiter,
  otpRateLimiter,
  apiRateLimiter
} from '../middlewares';
import {
  validateRequest,
  registerSchema,
  verifyEmailSchema,
  requestOtpSchema
} from '../middlewares/auth.validation.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-register-routes');

const router: Router = Router();

// ============================================
// REGISTRATION
// ============================================

/**
 * POST /auth/register
 * Register a new user (player or organizer)
 * Public (rate limited)
 */
router.post(
  '/register',
  registrationRateLimiter,
  validateRequest(registerSchema),
  asyncHandler(registerController.register.bind(registerController))
);

// ============================================
// EMAIL VERIFICATION
// ============================================

/**
 * POST /auth/verify-email
 * Verify email with OTP
 * Public (rate limited)
 */
router.post(
  '/verify-email',
  otpRateLimiter,
  validateRequest(verifyEmailSchema),
  asyncHandler(registerController.verifyEmail.bind(registerController))
);

/**
 * POST /auth/resend-verification
 * Resend email verification OTP
 * Public (rate limited)
 */
router.post(
  '/resend-verification',
  otpRateLimiter,
  validateRequest(requestOtpSchema),
  asyncHandler(registerController.resendVerification.bind(registerController))
);

// ============================================
// AVAILABILITY CHECKS
// ============================================

/**
 * GET /auth/check-email
 * Check if email is available
 * Public (rate limited)
 */
router.get(
  '/check-email',
  apiRateLimiter,
  asyncHandler(registerController.checkEmailAvailability.bind(registerController))
);

/**
 * GET /auth/check-username
 * Check if username is available
 * Public (rate limited)
 */
router.get(
  '/check-username',
  apiRateLimiter,
  asyncHandler(registerController.checkUsernameAvailability.bind(registerController))
);

// ============================================
// Error Handler
// ============================================

router.use(authErrorHandler);

export default router;
