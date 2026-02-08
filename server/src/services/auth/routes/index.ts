import { Router } from 'express';
import adminRoutes from './auth.admin.route';
import loginRoutes from './auth.login.route';
import otpRoutes from './auth.otp.routes';
import passwordRoutes from './auth.password.route';
import registerRoutes from './auth.register.route';
import tokenRoutes from './auth.token.route';
import userRoutes from './auth.user.route';
import googleRoutes from './auth.google.route';

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

// Mount OTP routes
router.use('/otp', otpRoutes);

// User routes
router.use('/user', userRoutes);

// Google routes
router.use('/google', googleRoutes);

export default router;
