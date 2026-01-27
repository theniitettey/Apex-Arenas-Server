import { Router } from 'express';
import registerRoutes from './auth.register.route';
import loginRoutes from './auth.login.route';
import tokenRoutes from './auth.token.route';
import passwordRoutes from './auth.password.route';
import adminRoutes from './auth.admin.route';

const router: Router = Router();

// Registration routes (register, verify-email, check availability)
router.use('/', registerRoutes);

// Login routes (login, 2fa, admin login, auth status)
router.use('/', loginRoutes);

// Token management routes (refresh, validate, sessions, logout)
router.use('/', tokenRoutes);

// Password routes (change, reset)
router.use('/', passwordRoutes);

// Admin routes (user management, security, stats) - mounted at /admin
router.use('/admin', adminRoutes);

export default router;
