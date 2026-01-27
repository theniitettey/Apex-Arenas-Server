import { Router } from 'express';
import { tokenController } from '../controllers/auth.token.controller';
import {
  userAuthMiddleware,
  adminAuthMiddleware,
  internalAuthMiddleware,
  asyncHandler,
  authErrorHandler,
  createRateLimiter
} from '../middlewares';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-token-routes');

const router: Router = Router();

// ============================================
// RATE LIMITERS
// ============================================

// Rate limiter for token refresh (stricter)
const tokenRefreshRateLimiter = createRateLimiter({
  window_seconds: 900, // 15 minutes
  max_requests: 10,
  key_prefix: 'token_refresh',
  message: 'Too many token refresh attempts. Please login again.'
});

// Rate limiter for admin token refresh (stricter)
const adminTokenRefreshRateLimiter = createRateLimiter({
  window_seconds: 900, // 15 minutes
  max_requests: 5,
  key_prefix: 'admin_token_refresh',
  message: 'Too many admin token refresh attempts.'
});

// ============================================
// USER TOKEN ROUTES (Players/Organizers)
// ============================================

/**
 * POST /auth/token/refresh
 * Refresh user access token using refresh token
 * Public (no auth required, uses refresh token)
 */
router.post(
  '/token/refresh',
  tokenRefreshRateLimiter,
  asyncHandler(tokenController.refreshUserToken.bind(tokenController))
);

/**
 * POST /auth/token/validate
 * Validate user access token (for internal services)
 * Requires internal service authentication
 */
router.post(
  '/token/validate',
  internalAuthMiddleware,
  asyncHandler(tokenController.validateUserToken.bind(tokenController))
);

// ============================================
// ADMIN TOKEN ROUTES
// ============================================

/**
 * POST /auth/admin/token/refresh
 * Refresh admin access token using refresh token
 * Public (no auth required, uses refresh token)
 */
router.post(
  '/admin/token/refresh',
  adminTokenRefreshRateLimiter,
  asyncHandler(tokenController.refreshAdminToken.bind(tokenController))
);

/**
 * POST /auth/admin/token/validate
 * Validate admin access token (for internal services)
 * Requires internal service authentication
 */
router.post(
  '/admin/token/validate',
  internalAuthMiddleware,
  asyncHandler(tokenController.validateAdminToken.bind(tokenController))
);

// ============================================
// SESSION MANAGEMENT (Authenticated Users)
// ============================================

/**
 * GET /auth/sessions
 * Get current user's active sessions
 * Requires user authentication
 */
router.get(
  '/sessions',
  userAuthMiddleware,
  asyncHandler(tokenController.getActiveSessions.bind(tokenController))
);

/**
 * DELETE /auth/sessions/:sessionId
 * Revoke a specific session
 * Requires user authentication
 */
router.delete(
  '/sessions/:sessionId',
  userAuthMiddleware,
  asyncHandler(tokenController.revokeSession.bind(tokenController))
);

/**
 * POST /auth/sessions/revoke-others
 * Revoke all sessions except current
 * Requires user authentication
 */
router.post(
  '/sessions/revoke-others',
  userAuthMiddleware,
  asyncHandler(tokenController.revokeOtherSessions.bind(tokenController))
);

// ============================================
// LOGOUT ROUTES
// ============================================

/**
 * POST /auth/logout
 * Logout current session
 * Requires user authentication
 */
router.post(
  '/logout',
  userAuthMiddleware,
  asyncHandler(tokenController.logout.bind(tokenController))
);

/**
 * POST /auth/logout-all
 * Logout from all devices
 * Requires user authentication
 */
router.post(
  '/logout-all',
  userAuthMiddleware,
  asyncHandler(tokenController.logoutAll.bind(tokenController))
);

// ============================================
// ADMIN LOGOUT ROUTES
// ============================================

/**
 * POST /auth/admin/logout
 * Logout admin session
 * Requires admin authentication
 */
router.post(
  '/admin/logout',
  adminAuthMiddleware,
  asyncHandler(tokenController.logout.bind(tokenController))
);

/**
 * POST /auth/admin/logout-all
 * Logout admin from all devices
 * Requires admin authentication
 */
router.post(
  '/admin/logout-all',
  adminAuthMiddleware,
  asyncHandler(tokenController.logoutAll.bind(tokenController))
);

// ============================================
// ADMIN SESSION MANAGEMENT
// ============================================

/**
 * GET /auth/admin/sessions
 * Get admin's active sessions
 * Requires admin authentication
 */
router.get(
  '/admin/sessions',
  adminAuthMiddleware,
  asyncHandler(tokenController.getActiveSessions.bind(tokenController))
);

/**
 * DELETE /auth/admin/sessions/:sessionId
 * Revoke a specific admin session
 * Requires admin authentication
 */
router.delete(
  '/admin/sessions/:sessionId',
  adminAuthMiddleware,
  asyncHandler(tokenController.revokeSession.bind(tokenController))
);

// ============================================
// Error Handler
// ============================================

router.use(authErrorHandler);

export default router;
