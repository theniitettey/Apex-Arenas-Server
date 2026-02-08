import { Router } from 'express';
import multer from 'multer';
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

// Multer config for file uploads (memory storage for Cloudinary)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5
  },
  fileFilter: (req, file, cb) => {
    const allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (allowed_types.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, and PDF are allowed.'));
    }
  }
});

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

/**
 * POST /auth/user/verification/request
 * Request organizer verification with document uploads
 */
router.post(
  '/verification/request',
  apiRateLimiter,
  upload.fields([
    { name: 'id_front', maxCount: 1 },
    { name: 'id_back', maxCount: 1 },
    { name: 'selfie_with_id', maxCount: 1 },
    { name: 'business_registration', maxCount: 1 },
    { name: 'utility_bill', maxCount: 1 }
  ]),
  asyncHandler(userController.requestOrganizerVerification.bind(userController))
);

/**
 * GET /auth/user/verification/status
 * Get current verification request status
 */
router.get(
  '/verification/status',
  asyncHandler(userController.getVerificationStatus.bind(userController))
);

/**
 * POST /auth/user/add-password
 * Add password to Google-only account
 */
router.post(
  '/add-password',
  apiRateLimiter,
  asyncHandler(userController.addPassword.bind(userController))
);

/**
 * GET /auth/user/auth-methods
 * Get user's available authentication methods
 */
router.get(
  '/auth-methods',
  asyncHandler(userController.getAuthMethods.bind(userController))
);

router.use(authErrorHandler);

export default router;
