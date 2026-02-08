import { Router } from 'express';
import { googleAuthController } from '../controllers/auth.google.controller';
import {
  asyncHandler,
  authErrorHandler,
  loginRateLimiter
} from '../middlewares';
import {
  validateRequest,
 
} from '../middlewares/auth.validation.middleware';

const router: Router = Router();

/**
 * POST /auth/google
 * Authenticate or register with Google
 * Public (rate limited)
 */
router.post(
  '/',
  loginRateLimiter,
  asyncHandler(googleAuthController.googleAuth.bind(googleAuthController))
);

/**
 * POST /auth/google/link
 * Link Google account to existing local account
 * Public (rate limited) - requires password confirmation
 */
router.post(
  '/link',
  loginRateLimiter,
  asyncHandler(googleAuthController.linkGoogleAccount.bind(googleAuthController))
);

router.use(authErrorHandler);

export default router;
