import { Router } from 'express';
import { loginController } from '../controllers/auth.login.controller';
import {
  userAuthMiddleware,
  asyncHandler,
  authErrorHandler,
  loginRateLimiter,
  adminLoginRateLimiter,
  otpRateLimiter
} from '../middlewares';
import {
  validateRequest,
  loginSchema,
  adminLoginSchema,
  verify2FASchema,
  setup2FAVerifySchema
} from '../middlewares/auth.validation.middleware';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-login-routes');

const router: Router = Router();

// ============================================
// USER LOGIN (Players/Organizers)
// ============================================

/**
 * POST /auth/login
 * User login with email and password
 * Public (rate limited)
 */
router.post(
  '/login',
  loginRateLimiter,
  validateRequest(loginSchema),
  asyncHandler(loginController.login.bind(loginController))
);

/**
 * POST /auth/login/2fa
 * Complete user login with 2FA verification
 * Public (rate limited)
 */
router.post(
  '/login/2fa',
  otpRateLimiter,
  validateRequest(verify2FASchema),
  asyncHandler(loginController.verify2FALogin.bind(loginController))
);

// ============================================
// ADMIN LOGIN
// ============================================

/**
 * POST /auth/admin/login
 * Admin login with email and password
 * Public but strictly rate limited
 */
router.post(
  '/admin/login',
  adminLoginRateLimiter,
  validateRequest(adminLoginSchema),
  asyncHandler(loginController.adminLogin.bind(loginController))
);

/**
 * POST /auth/admin/login/2fa
 * Complete admin login with 2FA verification
 * Public (rate limited)
 */
router.post(
  '/admin/login/2fa',
  otpRateLimiter,
  validateRequest(verify2FASchema),
  asyncHandler(loginController.verifyAdmin2FALogin.bind(loginController))
);

/**
 * POST /auth/admin/2fa/setup/verify
 * Verify admin 2FA setup during first login
 * Public (rate limited) - for first-time admin setup
 */
router.post(
  '/admin/2fa/setup/verify',
  otpRateLimiter,
  validateRequest(setup2FAVerifySchema),
  asyncHandler(loginController.verifyAdmin2FASetup.bind(loginController))
);

// ============================================
// AUTH STATUS
// ============================================

/**
 * GET /auth/me
 * Get current authenticated user's status
 * Requires user authentication
 */
router.get(
  '/me',
  userAuthMiddleware,
  asyncHandler(loginController.getAuthStatus.bind(loginController))
);

// ============================================
// Error Handler
// ============================================

router.use(authErrorHandler);

export default router;
