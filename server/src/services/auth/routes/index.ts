import { Router } from 'express';
import tokenRoutes from './auth.token.route';
import passwordRoutes from './auth.password.route';
import adminRoutes from './auth.admin.route';

const router: Router = Router();

// Token management routes (refresh, validate, sessions, logout)
router.use('/', tokenRoutes);

// Password routes (change, reset)
router.use('/', passwordRoutes);

// Admin routes (user management, security, stats)
router.use('/admin', adminRoutes);

export default router;
