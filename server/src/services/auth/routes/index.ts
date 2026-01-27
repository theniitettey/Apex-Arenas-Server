import { Router } from 'express';
import tokenRoutes from './auth.token.route';
import adminRoutes from './auth.admin.route';

const router: Router = Router();

// Token management routes (refresh, validate, sessions, logout)
router.use('/', tokenRoutes);

// Admin routes (user management, security, stats)
router.use('/admin', adminRoutes);

export default router;
