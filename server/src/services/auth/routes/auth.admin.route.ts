import { Router } from 'express';
import { adminController } from '../controllers/auth.admin.controller';
import {
  adminAuthMiddleware,
  verifyAdminWhitelist,
  logAdminAction,
  requireSuperAdmin,
  preventSelfAction,
  adminActionRateLimiter,
  authErrorHandler,
  asyncHandler
} from '../middlewares';

const router:Router = Router();

// ============================================
// All admin routes require:
// 1. Valid admin JWT token
// 2. Admin email in whitelist
// 3. Rate limiting
// ============================================

// Apply admin authentication to all routes
router.use(adminAuthMiddleware);
router.use(verifyAdminWhitelist);
router.use(adminActionRateLimiter);

// ============================================
// USER MANAGEMENT
// ============================================

// List users with filters
router.get(
  '/users',
  logAdminAction('list_users'),
  asyncHandler(adminController.listUsers.bind(adminController))
);

// Get user details
router.get(
  '/users/:userId',
  logAdminAction('view_user'),
  asyncHandler(adminController.getUserDetails.bind(adminController))
);

// Ban user
router.post(
  '/users/:userId/ban',
  preventSelfAction,
  logAdminAction('ban_user'),
  asyncHandler(adminController.banUser.bind(adminController))
);

// Unban user
router.post(
  '/users/:userId/unban',
  logAdminAction('unban_user'),
  asyncHandler(adminController.unbanUser.bind(adminController))
);

// Deactivate user
router.post(
  '/users/:userId/deactivate',
  preventSelfAction,
  logAdminAction('deactivate_user'),
  asyncHandler(adminController.deactivateUser.bind(adminController))
);

// Reactivate user
router.post(
  '/users/:userId/reactivate',
  logAdminAction('reactivate_user'),
  asyncHandler(adminController.reactivateUser.bind(adminController))
);

// Change user role
router.put(
  '/users/:userId/role',
  preventSelfAction,
  logAdminAction('change_user_role'),
  asyncHandler(adminController.changeUserRole.bind(adminController))
);

// Verify organizer
router.post(
  '/users/:userId/verify-organizer',
  logAdminAction('verify_organizer'),
  asyncHandler(adminController.verifyOrganizer.bind(adminController))
);

// Force verify email
router.post(
  '/users/:userId/verify-email',
  logAdminAction('force_verify_email'),
  asyncHandler(adminController.forceVerifyEmail.bind(adminController))
);

// ============================================
// SECURITY OPERATIONS
// ============================================

// Force logout user
router.post(
  '/users/:userId/force-logout',
  logAdminAction('force_logout_user'),
  asyncHandler(adminController.forceLogoutUser.bind(adminController))
);

// Get user sessions
router.get(
  '/users/:userId/sessions',
  logAdminAction('view_user_sessions'),
  asyncHandler(adminController.getUserSessions.bind(adminController))
);

// Revoke specific session
router.delete(
  '/users/:userId/sessions/:sessionId',
  logAdminAction('revoke_user_session'),
  asyncHandler(adminController.revokeUserSession.bind(adminController))
);

// Unlock account
router.post(
  '/users/:userId/unlock',
  logAdminAction('unlock_account'),
  asyncHandler(adminController.unlockAccount.bind(adminController))
);

// Force password reset
router.post(
  '/users/:userId/force-password-reset',
  logAdminAction('force_password_reset'),
  asyncHandler(adminController.forcePasswordReset.bind(adminController))
);

// ============================================
// AUDIT & REPORTING
// ============================================

// Get user audit trail
router.get(
  '/users/:userId/audit',
  logAdminAction('view_user_audit'),
  asyncHandler(adminController.getUserAuditTrail.bind(adminController))
);

// Search audit logs
router.get(
  '/audit',
  logAdminAction('search_audit_logs'),
  asyncHandler(adminController.searchAuditLogs.bind(adminController))
);

// Get system statistics
router.get(
  '/stats',
  logAdminAction('view_system_stats'),
  asyncHandler(adminController.getSystemStats.bind(adminController))
);

// Get suspicious activity
router.get(
  '/security/suspicious',
  logAdminAction('view_suspicious_activity'),
  asyncHandler(adminController.getSuspiciousActivity.bind(adminController))
);

// ============================================
// ADMIN MANAGEMENT (Super Admin Only)
// ============================================

// List all admins
router.get(
  '/admins',
  logAdminAction('list_admins'),
  asyncHandler(adminController.listAdmins.bind(adminController))
);

// Setup new admin (typically first admin or super admin only)
router.post(
  '/admins/setup',
  requireSuperAdmin,
  logAdminAction('setup_admin'),
  asyncHandler(adminController.setupAdmin.bind(adminController))
);

// Force 2FA for admin
router.post(
  '/admins/:adminId/force-2fa',
  requireSuperAdmin,
  preventSelfAction,
  logAdminAction('force_admin_2fa'),
  asyncHandler(adminController.forceAdmin2FASetup.bind(adminController))
);

// ============================================
// Error Handler
// ============================================

router.use(authErrorHandler);

export default router;