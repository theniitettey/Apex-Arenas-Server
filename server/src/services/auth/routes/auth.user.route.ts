import { Router } from 'express';
import { userController } from '../controllers/auth.user.controller';
import {
  userAuthMiddleware,
  asyncHandler,
  authErrorHandler,
  apiRateLimiter
} from '../middlewares';
import {
  validateRequest,
  updateProfileSchema
} from '../middlewares/auth.validation.middleware';

const router: Router = Router();

// All routes require authentication
router.use(userAuthMiddleware);

/**
 * GET /auth/user/profile
 * Get current user's profile
 */
router.get(
  '/profile',
  asyncHandler(userController.getProfile.bind(userController))
);

/**
 * PUT /auth/user/profile
 * Update current user's profile
 */
router.put(
  '/profile',
  validateRequest(updateProfileSchema),
  asyncHandler(userController.updateProfile.bind(userController))
);

/**
 * POST /auth/user/deactivate
 * Deactivate own account
 */
router.post(
  '/deactivate',
  apiRateLimiter,
  asyncHandler(userController.deactivateAccount.bind(userController))
);

router.use(authErrorHandler);

export default router;
