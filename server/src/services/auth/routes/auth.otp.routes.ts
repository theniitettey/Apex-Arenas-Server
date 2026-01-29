import { Router } from 'express';
import { otpController } from '../controllers/auth.otp.controller';
import { asyncHandler } from '../middlewares/auth.error.middleware';
import { validateRequest, requestOtpSchema, verifyOtpSchema } from '../middlewares/auth.validation.middleware';
import { createRateLimiter } from '../middlewares/auth.ratelimit.middleware';
import { userAuthMiddleware } from '../middlewares/auth.jwt.middleware';

const router: Router = Router();

// ============================================
// RATE LIMITERS
// ============================================

// Strict rate limiting for OTP generation (3 per hour)
const otpGenerateRateLimiter = createRateLimiter({
  window_seconds: 60 * 60, // 1 hour
  max_requests: 3,
  key_prefix: 'otp_generate',
  message: 'Too many OTP requests. Please try again later.'
});

// Rate limiting for OTP verification (10 per 15 minutes - prevents brute force)
const otpVerifyRateLimiter = createRateLimiter({
  window_seconds: 15 * 60, // 15 minutes
  max_requests: 10,
  key_prefix: 'otp_verify',
  message: 'Too many verification attempts. Please try again later.'
});

// Very strict rate limiting for OTP resend (2 per hour)
const otpResendRateLimiter = createRateLimiter({
  window_seconds: 60 * 60, // 1 hour
  max_requests: 2,
  key_prefix: 'otp_resend',
  message: 'Too many resend requests. Please wait before requesting again.'
});

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * @route   POST /auth/otp/generate
 * @desc    Generate OTP for email verification, password reset, etc.
 * @access  Public
 */
router.post(
  '/generate',
  otpGenerateRateLimiter,
  validateRequest(requestOtpSchema),
  asyncHandler(otpController.generateOTP.bind(otpController))
);

/**
 * @route   POST /auth/otp/verify
 * @desc    Verify OTP
 * @access  Public
 */
router.post(
  '/verify',
  otpVerifyRateLimiter,
  validateRequest(verifyOtpSchema),
  asyncHandler(otpController.verifyOTP.bind(otpController))
);

/**
 * @route   POST /auth/otp/resend
 * @desc    Resend OTP (uses same schema as generate)
 * @access  Public
 */
router.post(
  '/resend',
  otpResendRateLimiter,
  validateRequest(requestOtpSchema),
  asyncHandler(otpController.resendOTP.bind(otpController))
);

/**
 * @route   GET /auth/otp/can-request/:type
 * @desc    Check if user can request OTP (cooldown check)
 * @access  Public
 */
router.get(
  '/can-request/:type',
  asyncHandler(otpController.canRequestOTP.bind(otpController))
);

// ============================================
// PROTECTED ROUTES
// ============================================

/**
 * @route   GET /auth/otp/attempts/:type
 * @desc    Get remaining OTP verification attempts
 * @access  Private
 */
router.get(
  '/attempts/:type',
  userAuthMiddleware,
  asyncHandler(otpController.getRemainingAttempts.bind(otpController))
);

export default router;
