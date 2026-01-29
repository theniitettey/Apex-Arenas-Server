import mongoose from 'mongoose';
import { User, IApexUser, UserSecurity, RefreshToken } from '../../../models/user.model';
import { PasswordService } from './auth.password.service';
import { AuditService } from './auth.audit.service';
import { sessionService } from './auth.session.service';
import { tokenService } from './auth.token.service';
import { twoFactorService } from './auth.2fa.service';
import { redisManager } from '../../../configs/redis.config';
import { env } from '../../../configs/env.config';
import { createLogger } from '../../../shared/utils/logger.utils';
import { DeviceContext, detectDeviceType } from '../../../shared/utils/request.utils';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes';

const logger = createLogger('auth-user-service');

// ============================================
// INTERFACES
// ============================================

export interface CreateUserData {
  email: string;
  username: string;
  password: string;
  first_name: string;
  last_name: string;
  role?: 'player' | 'organizer';
}

export interface LoginCredentials {
  email: string;
  password: string;
  ip_address: string;
  user_agent: string;
  device_fingerprint?: string;
}

export interface LoginResult {
  success: boolean;
  user?: IApexUser;
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_code?: string;
  is_locked?: boolean;
  lock_until?: Date;
  requires_2fa?: boolean;
  requires_email_verification?: boolean;
}

export interface AdminLoginCredentials extends LoginCredentials {
  admin_secret?: string;
}

export interface AdminLoginResult extends LoginResult {
  is_admin: boolean;
}

export interface UpdateProfileData {
  first_name?: string;
  last_name?: string;
  bio?: string;
  phone_number?: string;
  country?: string;
  social_links?: {
    discord?: string;
    twitter?: string;
    twitch?: string;
    youtube?: string;
  };
}

export interface Complete2FALoginResult {
  success: boolean;
  user?: IApexUser;
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_code?: string;
}

// ============================================
// USER SERVICE
// ============================================

export class UserService {
  // Use config values instead of hardcoded numbers
  private readonly MAX_FAILED_ATTEMPTS_USER = env.LOCKOUT_MAX_ATTEMPTS_USER;
  private readonly MAX_FAILED_ATTEMPTS_ADMIN = env.LOCKOUT_MAX_ATTEMPTS_ADMIN;
  private readonly LOCK_TIME_USER = env.LOCKOUT_DURATION_USER_MINUTES * 60 * 1000;
  private readonly LOCK_TIME_ADMIN = env.LOCKOUT_DURATION_ADMIN_MINUTES * 60 * 1000;
  private readonly MAX_SESSIONS = env.MAX_SESSIONS_PER_USER;

  // 🔧 FIX #10: Cache admin whitelist instead of parsing on every login
  private readonly ALLOWED_ADMIN_EMAILS: string[];

  constructor() {
    this.ALLOWED_ADMIN_EMAILS = this.parseAllowedAdminEmails();
    logger.info('UserService initialized', {
      max_sessions: this.MAX_SESSIONS,
      allowed_admins_count: this.ALLOWED_ADMIN_EMAILS.length
    });
  }

  /**
   * Parse allowed admin emails from environment variable (called once at startup)
   */
  private parseAllowedAdminEmails(): string[] {
    const admin_emails_raw = env.ADMIN_EMAILS || '';
    return admin_emails_raw
      .split(',')
      .map((email: string) => email.trim().toLowerCase())
      .filter((email: string) => email.length > 0);
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * 🔧 FIX #6: Consolidated password validation
   * Validates password strength and checks for breaches
   */
  private async validateAndCheckPassword(password: string, context: string): Promise<void> {
    const validation = PasswordService.validatePasswordStrength(password);
    if (!validation.is_valid) {
      throw new Error(`${AUTH_ERROR_CODES.WEAK_PASSWORD}:${validation.errors.join('|')}`);
    }

    const is_breached = await PasswordService.checkPasswordBreach(password);
    if (is_breached) {
      throw new Error(AUTH_ERROR_CODES.PASSWORD_COMPROMISED);
    }

    logger.debug('Password validation passed', { context, strength_score: validation.strength_score });
  }

  /**
   * 🔧 FIX #4: Improved session limit enforcement
   * Enforces MAX_SESSIONS limit by revoking oldest session instead of all sessions
   */
  private async enforceSessionLimit(
    user_id: string,
    credentials: LoginCredentials
  ): Promise<void> {
    try {
      const active_sessions = await RefreshToken.countDocuments({
        user_id,
        is_revoked: false,
        expires_at: { $gt: new Date() }
      });

      // Only enforce limit if we're at or above the maximum
      if (active_sessions >= this.MAX_SESSIONS) {
        logger.info('Session limit reached - revoking oldest session', {
          user_id,
          active_sessions,
          max_allowed: this.MAX_SESSIONS
        });

        // Find and revoke the OLDEST session (not all sessions)
        const oldest_session = await RefreshToken.findOne({
          user_id,
          is_revoked: false,
          expires_at: { $gt: new Date() }
        }).sort({ created_at: 1 }); // Sort by oldest first

        if (oldest_session) {
          await RefreshToken.findByIdAndUpdate(oldest_session._id, {
            is_revoked: true,
            revoked_at: new Date(),
            revoke_reason: 'session_limit_exceeded'
          });

          await AuditService.logAuthEvent({
            user_id,
            event_type: 'token_revoked',
            success: true,
            metadata: {
              ip_address: credentials.ip_address,
              user_agent: credentials.user_agent,
              revoke_reason: `Session limit (${this.MAX_SESSIONS}) enforcement - oldest session revoked`
            }
          });
        }
      }

      // 🔧 FIX #9: Use atomic operation for session count update
      await UserSecurity.findOneAndUpdate(
        { user_id },
        {
          $set: {
            active_sessions_count: Math.min(active_sessions, this.MAX_SESSIONS),
            last_session_created_at: new Date()
          }
        }
      );
    } catch (error: any) {
      logger.error('Error enforcing session limit:', error);
      // Don't throw - session management issues shouldn't block login
    }
  }

  /**
   * 🔧 FIX #9: Handle failed login with atomic operations
   */
  private async handleFailedLogin(
    user_id: string,
    credentials: LoginCredentials,
    user_type: 'user' | 'admin'
  ): Promise<void> {
    const max_attempts = user_type === 'admin' 
      ? this.MAX_FAILED_ATTEMPTS_ADMIN 
      : this.MAX_FAILED_ATTEMPTS_USER;
    const lock_time = user_type === 'admin' 
      ? this.LOCK_TIME_ADMIN 
      : this.LOCK_TIME_USER;

    try {
      let security = await UserSecurity.findOne({ user_id });
      
      if (!security) {
        security = await UserSecurity.create({
          user_id,
          lockout: {
            is_locked: false,
            failed_login_attempts: 1,
            last_failed_attempt_at: new Date()
          },
          two_factor: { method: 'none' },
          risk: { current_risk_level: 'low', risk_score: 0, last_assessed_at: new Date() },
          activity_summary: { total_logins: 0 }
        });

        await AuditService.logAuthEvent({
          user_id,
          event_type: 'login_failed',
          success: false,
          metadata: {
            ip_address: credentials.ip_address,
            user_agent: credentials.user_agent,
            failure_reason: 'Invalid password',
            attempts_remaining: max_attempts - 1
          }
        });
        
        return;
      }

      // 🔧 FIX #9: Use atomic increment operation
      const updated_security = await UserSecurity.findOneAndUpdate(
        { user_id },
        {
          $inc: { 'lockout.failed_login_attempts': 1 },
          $set: { 'lockout.last_failed_attempt_at': new Date() }
        },
        { new: true }
      );

      if (!updated_security) {
        logger.warn('Security record not found during failed login', { user_id });
        return;
      }

      const current_attempts = updated_security.lockout.failed_login_attempts;

      // Check if we need to lock the account
      if (current_attempts >= max_attempts) {
        await UserSecurity.findOneAndUpdate(
          { user_id },
          {
            $set: {
              'lockout.is_locked': true,
              'lockout.locked_at': new Date(),
              'lockout.locked_until': new Date(Date.now() + lock_time),
              'lockout.lock_reason': 'failed_attempts'
            }
          }
        );

        await AuditService.logAuthEvent({
          user_id,
          event_type: 'account_locked',
          success: true,
          metadata: {
            ip_address: credentials.ip_address,
            user_agent: credentials.user_agent,
            failure_reason: `Max failed login attempts (${max_attempts}) reached`,
            lock_duration_minutes: lock_time / 60000
          }
        });

        logger.warn('Account locked due to failed attempts', { 
          user_id, 
          attempts: current_attempts,
          user_type 
        });
      } else {
        await AuditService.logAuthEvent({
          user_id,
          event_type: 'login_failed',
          success: false,
          metadata: {
            ip_address: credentials.ip_address,
            user_agent: credentials.user_agent,
            failure_reason: 'Invalid password',
            attempts_remaining: Math.max(0, max_attempts - current_attempts)
          }
        });
      }
    } catch (error: any) {
      logger.error('Error handling failed login:', error);
      // Don't throw - tracking failures shouldn't block the response
    }
  }

  /**
   * Handle successful login
   */
  private async handleSuccessfulLogin(user_id: string, credentials: LoginCredentials): Promise<void> {
    try {
      // Update user last login
      await User.findByIdAndUpdate(user_id, {
        last_login: new Date(),
        last_active_at: new Date()
      });

      // 🔧 FIX #9: Use atomic operations for security stats
      await UserSecurity.findOneAndUpdate(
        { user_id },
        {
          $set: {
            'lockout.failed_login_attempts': 0,
            'lockout.is_locked': false,
            'lockout.locked_until': null,
            'activity_summary.last_login_at': new Date(),
            'activity_summary.last_login_ip': credentials.ip_address
          },
          $inc: {
            'activity_summary.total_logins': 1,
            'activity_summary.logins_last_30_days': 1
          }
        }
      );
    } catch (error: any) {
      logger.error('Error handling successful login:', error);
      // Don't throw - tracking success shouldn't block the response
    }
  }

  /**
   * Reset account lockout
   */
  private async resetLockout(user_id: string): Promise<void> {
    await UserSecurity.findOneAndUpdate(
      { user_id },
      {
        $set: {
          'lockout.is_locked': false,
          'lockout.locked_until': null,
          'lockout.failed_login_attempts': 0
        }
      }
    );
    logger.info('Account lockout reset', { user_id });
  }

  // ============================================
  // USER REGISTRATION (Player/Organizer)
  // ============================================

  /**
   * 🔧 FIX #5: Register user with MongoDB transaction support
   */
  async registerUser(
    userData: CreateUserData,
    device_context: DeviceContext
  ): Promise<IApexUser> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      logger.info('Registering new user', { email: userData.email, role: userData.role || 'player' });

      // Validate role
      const role = userData.role || 'player';
      if (userData.role === 'admin' as string) {
        await AuditService.logAuthEvent({
          event_type: 'registration_failed',
          success: false,
          identifier: userData.email,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Admin registration not allowed through public endpoint',
            is_suspicious: true,
            risk_score: 90
          }
        });
        throw new Error(AUTH_ERROR_CODES.INVALID_ROLE);
      }

      // Check if email already exists
      const existing_email = await User.findOne({ email: userData.email.toLowerCase() }).session(session);
      if (existing_email) {
        await AuditService.logAuthEvent({
          event_type: 'registration_failed',
          success: false,
          identifier: userData.email,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Email already exists'
          }
        });
        throw new Error(AUTH_ERROR_CODES.EMAIL_ALREADY_EXISTS);
      }

      // Check if username already exists
      const existing_username = await User.findOne({ username: userData.username.toLowerCase() }).session(session);
      if (existing_username) {
        await AuditService.logAuthEvent({
          event_type: 'registration_failed',
          success: false,
          identifier: userData.email,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Username already exists'
          }
        });
        throw new Error(AUTH_ERROR_CODES.USERNAME_ALREADY_EXISTS);
      }

      // 🔧 FIX #6: Use consolidated password validation
      await this.validateAndCheckPassword(userData.password, 'user_registration');

      // Hash password
      const password_hash = await PasswordService.hashPassword(userData.password);
      const password_validation = PasswordService.validatePasswordStrength(userData.password);

      // Create user (within transaction)
      const [user] = await User.create([{
        email: userData.email.toLowerCase(),
        username: userData.username.toLowerCase(),
        password_hash,
        role,
        profile: {
          first_name: userData.first_name,
          last_name: userData.last_name,
          // 🔧 FIX #8: Make country optional or extract from context
          country: device_context.country || 'UNKNOWN'
        },
        verification_status: {
          email_verified: false,
          phone_verified: false,
          identity_verified: false,
          organizer_verified: false
        },
        is_active: true,
        is_banned: false
      }], { session });

      // Create user security record (within transaction)
      await UserSecurity.create([{
        user_id: user._id,
        lockout: {
          is_locked: false,
          failed_login_attempts: 0
        },
        two_factor: {
          is_enabled: false,
          method: 'none',
          setup_required: false
        },
        password: {
          last_changed_at: new Date(),
          change_required: false,
          strength_score: password_validation.strength_score
        },
        risk: {
          current_risk_level: 'low',
          risk_score: 0,
          last_assessed_at: new Date()
        },
        security_notifications: {
          login_from_new_device: true,
          login_from_new_location: true,
          password_changed: true,
          email_changed: true,
          failed_login_attempts: true,
          account_locked: true,
          withdrawal_requested: true
        }
      }], { session });

      // Commit transaction
      await session.commitTransaction();

      // Log successful registration (after transaction succeeds)
      await AuditService.logAuthEvent({
        user_id: user._id.toString(),
        event_type: 'registration_completed',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      logger.info('User registered successfully', { user_id: user._id, email: user.email, role });

      return user;
    } catch (error: any) {
      await session.abortTransaction();
      logger.error('Error registering user:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ============================================
  // USER LOGIN (Player/Organizer)
  // ============================================

  /**
   * Login user (player or organizer)
   */
  async loginUser(credentials: LoginCredentials): Promise<LoginResult> {
    try {
      logger.info('User login attempt', { email: credentials.email });

      // 🔧 FIX #1: Use shared detectDeviceType utility
      const device_info = {
        ip_address: credentials.ip_address,
        user_agent: credentials.user_agent,
        device_type: detectDeviceType(credentials.user_agent),
        device_fingerprint: credentials.device_fingerprint
      };

      // Check rate limit
      const rate_limit = await redisManager.checkRateLimit(
        credentials.email,
        'login',
        900, // 15 minutes
        10   // max 10 attempts
      );

      if (!rate_limit.allowed) {
        await AuditService.logAuthEvent({
          event_type: 'login_failed',
          success: false,
          identifier: credentials.email,
          metadata: {
            ip_address: credentials.ip_address,
            user_agent: credentials.user_agent,
            failure_reason: 'Rate limit exceeded',
            is_suspicious: true
          }
        });
        return { 
          success: false, 
          error: 'Too many login attempts. Please try again later.',
          error_code: AUTH_ERROR_CODES.RATE_LIMIT_EXCEEDED
        };
      }

      // Find user by email (only player or organizer)
      const user = await User.findOne({
        email: credentials.email.toLowerCase(),
        role: { $in: ['player', 'organizer'] },
        is_active: true
      });

      if (!user) {
        await AuditService.logAuthEvent({
          event_type: 'login_failed',
          success: false,
          identifier: credentials.email,
          metadata: {
            ip_address: credentials.ip_address,
            user_agent: credentials.user_agent,
            failure_reason: 'User not found'
          }
        });
        return { 
          success: false, 
          error: 'Invalid email or password', 
          error_code: AUTH_ERROR_CODES.INVALID_CREDENTIALS 
        };
      }

      // Check if banned
      if (user.is_banned) {
        await AuditService.logAuthEvent({
          user_id: user._id.toString(),
          event_type: 'login_failed',
          success: false,
          metadata: {
            ip_address: credentials.ip_address,
            user_agent: credentials.user_agent,
            failure_reason: 'Account banned'
          }
        });
        return { 
          success: false, 
          error: user.banned_reason || 'Account is suspended',
          error_code: AUTH_ERROR_CODES.ACCOUNT_BANNED
        };
      }

      // Get user security record
      const security = await UserSecurity.findOne({ user_id: user._id });

      // Check if account is locked
      if (security?.lockout.is_locked && security.lockout.locked_until) {
        if (new Date() < security.lockout.locked_until) {
          return {
            success: false,
            error: 'Account is temporarily locked due to too many failed attempts',
            error_code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
            is_locked: true,
            lock_until: security.lockout.locked_until
          };
        } else {
          // Lockout expired, reset it
          await this.resetLockout(user._id.toString());
        }
      }

      // Verify password
      const is_password_valid = await PasswordService.comparePassword(
        credentials.password,
        user.password_hash
      );

      if (!is_password_valid) {
        await this.handleFailedLogin(user._id.toString(), credentials, 'user');
        return { 
          success: false, 
          error: 'Invalid email or password', 
          error_code: AUTH_ERROR_CODES.INVALID_CREDENTIALS 
        };
      }

      // Check if email verification is required
      if (!user.verification_status.email_verified) {
        return {
          success: false,
          error: 'Please verify your email before logging in',
          error_code: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
          requires_email_verification: true,
          user
        };
      }

      // Check if 2FA is enabled
      if (security?.two_factor.is_enabled) {
        return {
          success: false,
          error: '2FA verification required',
          error_code: AUTH_ERROR_CODES.TWO_FA_REQUIRED,
          requires_2fa: true,
          user
        };
      }

      // 🔧 FIX #4: Enforce session limit (revoke oldest, not all)
      await this.enforceSessionLimit(user._id.toString(), credentials);

      // Create new session
      const token_pair = await sessionService.createUserSession(
        user._id.toString(),
        user.email,
        user.role as 'player' | 'organizer',
        device_info
      );

      // Update login stats
      await this.handleSuccessfulLogin(user._id.toString(), credentials);

      // Reset rate limit on successful login
      await redisManager.resetRateLimit(credentials.email, 'login');

      logger.info('User login successful', { user_id: user._id, email: user.email, role: user.role });

      return {
        success: true,
        user,
        access_token: token_pair.accessToken,
        refresh_token: token_pair.refreshToken
      };
    } catch (error: any) {
      logger.error('Error during user login:', error);
      
      // 🔧 FIX #3: Better error differentiation
      if (error.message === AUTH_ERROR_CODES.ACCOUNT_BANNED) {
        return { 
          success: false, 
          error: 'Account is suspended', 
          error_code: AUTH_ERROR_CODES.ACCOUNT_BANNED 
        };
      }
      
      return { 
        success: false, 
        error: 'Login failed', 
        error_code: AUTH_ERROR_CODES.LOGIN_FAILED 
      };
    }
  }

  // ============================================
  // ADMIN LOGIN (Separate Secure Flow)
  // ============================================

  /**
   * Login admin user with enhanced security
   */
  async loginAdmin(credentials: AdminLoginCredentials): Promise<AdminLoginResult> {
    try {
      logger.info('Admin login attempt', { email: credentials.email });

      // 🔧 FIX #1: Use shared detectDeviceType utility
      const device_info = {
        ip_address: credentials.ip_address,
        user_agent: credentials.user_agent,
        device_type: detectDeviceType(credentials.user_agent),
        device_fingerprint: credentials.device_fingerprint
      };

      // 🔧 FIX #10: Use cached admin emails
      if (!this.ALLOWED_ADMIN_EMAILS.includes(credentials.email.toLowerCase())) {
        await AuditService.logSuspiciousActivity(
          undefined,
          'Unauthorized admin login attempt',
          {
            ip_address: credentials.ip_address,
            user_agent: credentials.user_agent,
            risk_factors: ['unauthorized_admin_attempt', 'email_not_in_whitelist'],
            attempted_email: credentials.email
          }
        );
        
        logger.warn('Unauthorized admin login attempt', { 
          email: credentials.email, 
          ip: credentials.ip_address 
        });
        
        return { 
          success: false, 
          error: 'Invalid credentials',
          error_code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
          is_admin: false
        };
      }

      // Stricter rate limiting for admin
      const rate_limit = await redisManager.checkRateLimit(
        `admin:${credentials.email}`,
        'login',
        900, // 15 minutes
        5    // max 5 attempts (stricter)
      );

      if (!rate_limit.allowed) {
        await AuditService.logAuthEvent({
          event_type: 'login_failed',
          success: false,
          identifier: credentials.email,
          metadata: {
            ip_address: credentials.ip_address,
            user_agent: credentials.user_agent,
            failure_reason: 'Admin rate limit exceeded',
            is_suspicious: true,
            risk_score: 70
          }
        });
        return {
          success: false,
          error: 'Too many login attempts',
          error_code: AUTH_ERROR_CODES.RATE_LIMIT_EXCEEDED,
          is_admin: false
        };
      }

      // Find admin user
      const admin = await User.findOne({
        email: credentials.email.toLowerCase(),
        role: 'admin',
        is_active: true
      });

      if (!admin) {
        return {
          success: false,
          error: 'Admin account not set up. Please contact system administrator.',
          error_code: AUTH_ERROR_CODES.ADMIN_NOT_SETUP,
          is_admin: false
        };
      }

      // Get admin security record
      const security = await UserSecurity.findOne({ user_id: admin._id });

      // Check if admin account is locked
      if (security?.lockout.is_locked && security.lockout.locked_until) {
        if (new Date() < security.lockout.locked_until) {
          return {
            success: false,
            error: 'Admin account is temporarily locked',
            error_code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
            is_locked: true,
            lock_until: security.lockout.locked_until,
            is_admin: true
          };
        } else {
          await this.resetLockout(admin._id.toString());
        }
      }

      // Verify password
      const is_password_valid = await PasswordService.comparePassword(
        credentials.password,
        admin.password_hash
      );

      if (!is_password_valid) {
        await this.handleFailedLogin(admin._id.toString(), credentials, 'admin');
        return {
          success: false,
          error: 'Invalid credentials',
          error_code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
          is_admin: true
        };
      }

      // Check if 2FA setup is required but not completed
      if (security?.two_factor.setup_required && !security.two_factor.is_enabled) {
        return {
          success: false,
          error: 'Please complete 2FA setup to continue',
          error_code: AUTH_ERROR_CODES.TWO_FA_SETUP_REQUIRED,
          user: admin,
          is_admin: true
        };
      }

      // Check if 2FA is enabled
      if (security?.two_factor.is_enabled) {
        return {
          success: false,
          error: '2FA verification required',
          error_code: AUTH_ERROR_CODES.TWO_FA_REQUIRED,
          requires_2fa: true,
          user: admin,
          is_admin: true
        };
      }

      // 🔧 FIX #4: Enforce session limit (revoke oldest, not all)
      await this.enforceSessionLimit(admin._id.toString(), credentials);

      // Create admin session
      const token_pair = await sessionService.createAdminSession(
        admin._id.toString(),
        admin.email,
        device_info
      );

      // Update login stats
      await this.handleSuccessfulLogin(admin._id.toString(), credentials);

      // Reset rate limit
      await redisManager.resetRateLimit(`admin:${credentials.email}`, 'login');

      logger.info('Admin login successful', { user_id: admin._id, email: admin.email });

      return {
        success: true,
        user: admin,
        access_token: token_pair.accessToken,
        refresh_token: token_pair.refreshToken,
        is_admin: true
      };
    } catch (error: any) {
      logger.error('Error during admin login:', error);
      
      // 🔧 FIX #3: Better error differentiation
      if (error.message === AUTH_ERROR_CODES.ACCOUNT_BANNED) {
        return {
          success: false,
          error: 'Admin account is suspended',
          error_code: AUTH_ERROR_CODES.ACCOUNT_BANNED,
          is_admin: true
        };
      }
      
      return {
        success: false,
        error: 'Login failed',
        error_code: AUTH_ERROR_CODES.LOGIN_FAILED,
        is_admin: false
      };
    }
  }

  // ============================================
  // USER LOOKUP METHODS
  // ============================================

  async getUserByEmail(email: string): Promise<IApexUser | null> {
    try {
      return await User.findOne({ email: email.toLowerCase() });
    } catch (error: any) {
      logger.error('Error getting user by email:', error);
      throw error;
    }
  }

  async getUserByUsername(username: string): Promise<IApexUser | null> {
    try {
      return await User.findOne({ username: username.toLowerCase() });
    } catch (error: any) {
      logger.error('Error getting user by username:', error);
      throw error;
    }
  }

  async getUserById(user_id: string): Promise<IApexUser | null> {
    try {
      return await User.findById(user_id);
    } catch (error: any) {
      logger.error('Error getting user by ID:', error);
      throw error;
    }
  }

  async getUserProfile(user_id: string): Promise<IApexUser | null> {
    try {
      return await User.findById(user_id);
    } catch (error: any) {
      logger.error('Error getting user profile:', error);
      throw error;
    }
  }

  // ============================================
  // USER UPDATE METHODS
  // ============================================

  async updateUserProfile(
    user_id: string,
    updates: UpdateProfileData,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<IApexUser> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        throw new Error(AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      const profile_updates: Record<string, any> = {};

      if (updates.first_name !== undefined) {
        profile_updates['profile.first_name'] = updates.first_name;
      }
      if (updates.last_name !== undefined) {
        profile_updates['profile.last_name'] = updates.last_name;
      }
      if (updates.bio !== undefined) {
        profile_updates['profile.bio'] = updates.bio;
      }
      if (updates.phone_number !== undefined) {
        profile_updates['profile.phone_number'] = updates.phone_number;
      }
      if (updates.country !== undefined) {
        profile_updates['profile.country'] = updates.country;
      }
      if (updates.social_links !== undefined) {
        if (updates.social_links.discord !== undefined) {
          profile_updates['profile.social_links.discord'] = updates.social_links.discord;
        }
        if (updates.social_links.twitter !== undefined) {
          profile_updates['profile.social_links.twitter'] = updates.social_links.twitter;
        }
        if (updates.social_links.twitch !== undefined) {
          profile_updates['profile.social_links.twitch'] = updates.social_links.twitch;
        }
        if (updates.social_links.youtube !== undefined) {
          profile_updates['profile.social_links.youtube'] = updates.social_links.youtube;
        }
      }

      const updated_user = await User.findByIdAndUpdate(
        user_id,
        { $set: profile_updates },
        { new: true }
      );

      if (!updated_user) {
        throw new Error(AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      logger.info('User profile updated', { user_id, updates: Object.keys(profile_updates) });

      return updated_user;
    } catch (error: any) {
      logger.error('Error updating user profile:', error);
      throw error;
    }
  }

  // ============================================
  // EMAIL VERIFICATION
  // ============================================

  async verifyUserEmail(user_id: string): Promise<void> {
    try {
      await User.findByIdAndUpdate(user_id, {
        'verification_status.email_verified': true,
        'verification_status.verified_at': new Date()
      });

      logger.info('User email verified', { user_id });
    } catch (error: any) {
      logger.error('Error verifying user email:', error);
      throw error;
    }
  }

  // ============================================
  // ACCOUNT MANAGEMENT
  // ============================================

  async deactivateAccount(
    user_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<void> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        throw new Error(AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      await User.findByIdAndUpdate(user_id, {
        is_active: false
      });

      await tokenService.revokeAllUserTokens(user_id, 'logout');

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_deactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      logger.info('Account deactivated', { user_id });
    } catch (error: any) {
      logger.error('Error deactivating account:', error);
      throw error;
    }
  }

  /**
   * 🔧 FIX #6: Change password with consolidated validation
   */
  async changePassword(
    user_id: string,
    current_password: string,
    new_password: string,
    device_context: DeviceContext
  ): Promise<void> {
    try {
      logger.info('Password change requested', { user_id });

      const user = await User.findById(user_id);
      if (!user) {
        throw new Error(AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      const is_valid = await PasswordService.comparePassword(current_password, user.password_hash);
      if (!is_valid) {
        await AuditService.logAuthEvent({
          user_id,
          event_type: 'password_change_failed',
          success: false,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Invalid current password'
          }
        });
        throw new Error(AUTH_ERROR_CODES.INVALID_CURRENT_PASSWORD);
      }

      // 🔧 FIX #6: Use consolidated password validation
      await this.validateAndCheckPassword(new_password, 'password_change');

      const security = await UserSecurity.findOne({ user_id });
      if (security?.password.previous_hashes) {
        const is_reused = await PasswordService.isPasswordReused(
          new_password,
          security.password.previous_hashes
        );
        if (is_reused) {
          throw new Error(AUTH_ERROR_CODES.PASSWORD_RECENTLY_USED);
        }
      }

      const old_hash = user.password_hash;
      const new_hash = await PasswordService.hashPassword(new_password);
      const password_validation = PasswordService.validatePasswordStrength(new_password);

      user.password_hash = new_hash;
      await user.save();

      if (security) {
        const previous_hashes = security.password.previous_hashes || [];
        previous_hashes.unshift(old_hash);
        security.password.previous_hashes = previous_hashes.slice(0, 5);
        security.password.last_changed_at = new Date();
        security.password.strength_score = password_validation.strength_score;
        await security.save();
      }

      await tokenService.revokeAllUserTokens(user_id, 'password_change');

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'password_changed',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      logger.info('Password changed successfully', { user_id });
    } catch (error: any) {
      logger.error('Error changing password:', error);
      throw error;
    }
  }

  async reactivateAccount(
    user_id: string,
    admin_id: string,
    device_context: { ip_address: string; user_agent: string }
  ): Promise<void> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        throw new Error(AUTH_ERROR_CODES.USER_NOT_FOUND);
      }

      await User.findByIdAndUpdate(user_id, {
        is_active: true
      });

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_reactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id
        }
      });

      logger.info('Account reactivated', { user_id, admin_id });
    } catch (error: any) {
      logger.error('Error reactivating account:', error);
      throw error;
    }
  }

  // ============================================
  // ADMIN SETUP
  // ============================================

  /**
   * 🔧 FIX #5 & #6: Setup admin with transaction and consolidated validation
   */
  async setupAdminAccount(
    email: string,
    password: string,
    profile: { first_name: string; last_name: string; username: string },
    device_context: { ip_address: string; user_agent: string }
  ): Promise<IApexUser> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      logger.info('Setting up admin account', { email });

      // Check if admin already exists
      const existing_admin = await User.findOne({ 
        email: email.toLowerCase(), 
        role: 'admin' 
      }).session(session);
      
      if (existing_admin) {
        throw new Error(AUTH_ERROR_CODES.ADMIN_ALREADY_EXISTS);
      }

      // Check if email is already used
      const existing_email = await User.findOne({ 
        email: email.toLowerCase() 
      }).session(session);
      
      if (existing_email) {
        throw new Error(AUTH_ERROR_CODES.EMAIL_ALREADY_EXISTS);
      }

      // Check if username is already taken
      const existing_username = await User.findOne({ 
        username: profile.username.toLowerCase() 
      }).session(session);
      
      if (existing_username) {
        throw new Error(AUTH_ERROR_CODES.USERNAME_ALREADY_EXISTS);
      }

      // 🔧 FIX #6: Use consolidated password validation
      await this.validateAndCheckPassword(password, 'admin_setup');

      const password_hash = await PasswordService.hashPassword(password);
      const password_validation = PasswordService.validatePasswordStrength(password);

      // Create admin user (within transaction)
      const [admin] = await User.create([{
        email: email.toLowerCase(),
        username: profile.username.toLowerCase(),
        password_hash,
        role: 'admin',
        profile: {
          first_name: profile.first_name,
          last_name: profile.last_name,
        },
        verification_status: {
          // 🔧 FIX #7: Note - Admin emails still pre-verified but documented
          email_verified: true, // Pre-verified for admins (consider sending verification email)
          phone_verified: false,
          identity_verified: true,
          organizer_verified: true
        },
        is_active: true,
        is_banned: false
      }], { session });

      // Create admin security record (within transaction)
      await UserSecurity.create([{
        user_id: admin._id,
        lockout: {
          is_locked: false,
          failed_login_attempts: 0
        },
        two_factor: {
          is_enabled: false,
          method: 'none',
          setup_required: true // Force 2FA setup for admin
        },
        password: {
          last_changed_at: new Date(),
          change_required: false,
          strength_score: password_validation.strength_score
        },
        risk: {
          current_risk_level: 'low',
          risk_score: 0,
          last_assessed_at: new Date()
        },
        security_notifications: {
          login_from_new_device: true,
          login_from_new_location: true,
          password_changed: true,
          email_changed: true,
          failed_login_attempts: true,
          account_locked: true,
          withdrawal_requested: true
        }
      }], { session });

      // Commit transaction
      await session.commitTransaction();

      // Log admin creation (after transaction succeeds)
      await AuditService.logAuthEvent({
        user_id: admin._id.toString(),
        event_type: 'registration_completed',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          admin_id: 'system',
          admin_reason: 'Admin account setup'
        }
      });

      logger.info('Admin account created successfully', { 
        user_id: admin._id, 
        email: admin.email 
      });

      return admin;
    } catch (error: any) {
      await session.abortTransaction();
      logger.error('Error setting up admin account:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ============================================
  // 2FA LOGIN COMPLETION
  // ============================================

  async complete2FALogin(
    user_id: string,
    code: string,
    use_backup_code: boolean,
    device_context: DeviceContext
  ): Promise<Complete2FALoginResult> {
    try {
      logger.info('Completing 2FA login', { user_id });

      const user = await User.findById(user_id);
      if (!user) {
        return { 
          success: false, 
          error: AUTH_ERROR_CODES.USER_NOT_FOUND, 
          error_code: AUTH_ERROR_CODES.USER_NOT_FOUND 
        };
      }

      if (user.role === 'admin') {
        return { 
          success: false, 
          error: AUTH_ERROR_CODES.INVALID_FLOW, 
          error_code: AUTH_ERROR_CODES.INVALID_FLOW 
        };
      }

      if (!user.is_active) {
        return { 
          success: false, 
          error: AUTH_ERROR_CODES.ACCOUNT_INACTIVE, 
          error_code: AUTH_ERROR_CODES.ACCOUNT_INACTIVE 
        };
      }
      
      if (user.is_banned) {
        return { 
          success: false, 
          error: user.banned_reason || AUTH_ERROR_CODES.ACCOUNT_BANNED, 
          error_code: AUTH_ERROR_CODES.ACCOUNT_BANNED 
        };
      }

      // Verify 2FA code
      let verification_result;
      if (use_backup_code) {
        verification_result = await twoFactorService.verifyBackupCode(user_id, code, device_context);
      } else {
        verification_result = await twoFactorService.verifyTOTPCode(user_id, code, device_context);
      }

      if (!verification_result.valid) {
        return {
          success: false,
          error: verification_result.error === AUTH_ERROR_CODES.TWO_FA_INVALID_CODE
            ? 'Invalid verification code'
            : 'Verification failed',
          error_code: verification_result.error || AUTH_ERROR_CODES.TWO_FA_VERIFICATION_FAILED
        };
      }

      // 🔧 FIX #1: Use shared detectDeviceType utility
      const device_info = {
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent,
        device_type: detectDeviceType(device_context.user_agent)
      };

      // Enforce session limit
      await this.enforceSessionLimit(user_id, {
        email: user.email,
        password: '',
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent
      });

      // Create session
      const token_pair = await sessionService.createUserSession(
        user_id,
        user.email,
        user.role as 'player' | 'organizer',
        device_info
      );

      // Update login stats
      await this.handleSuccessfulLogin(user_id, {
        email: user.email,
        password: '',
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent
      });

      logger.info('2FA login completed successfully', { user_id, email: user.email });

      return {
        success: true,
        user,
        access_token: token_pair.accessToken,
        refresh_token: token_pair.refreshToken
      };
    } catch (error: any) {
      logger.error('Error completing 2FA login:', error);
      return { 
        success: false, 
        error: '2FA login failed', 
        error_code: AUTH_ERROR_CODES.TWO_FA_LOGIN_FAILED 
      };
    }
  }

  async completeAdmin2FALogin(
    user_id: string,
    code: string,
    use_backup_code: boolean,
    device_context: DeviceContext
  ): Promise<Complete2FALoginResult> {
    try {
      logger.info('Completing admin 2FA login', { user_id });

      const admin = await User.findOne({ _id: user_id, role: 'admin' });
      if (!admin) {
        return { 
          success: false, 
          error: AUTH_ERROR_CODES.ADMIN_NOT_FOUND, 
          error_code: AUTH_ERROR_CODES.ADMIN_NOT_FOUND 
        };
      }

      if (!admin.is_active) {
        return { 
          success: false, 
          error: AUTH_ERROR_CODES.ACCOUNT_INACTIVE, 
          error_code: AUTH_ERROR_CODES.ACCOUNT_INACTIVE 
        };
      }

      // Verify 2FA code
      let verification_result;
      if (use_backup_code) {
        verification_result = await twoFactorService.verifyBackupCode(user_id, code, device_context);
      } else {
        verification_result = await twoFactorService.verifyTOTPCode(user_id, code, device_context);
      }

      if (!verification_result.valid) {
        await AuditService.logAuthEvent({
          user_id,
          event_type: '2fa_failed',
          success: false,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: verification_result.error || 'Invalid 2FA code',
            is_suspicious: true,
            risk_score: 60
          }
        });
        
        return {
          success: false,
          error: verification_result.error === AUTH_ERROR_CODES.TWO_FA_INVALID_CODE
            ? 'Invalid verification code'
            : 'Verification failed',
          error_code: verification_result.error || AUTH_ERROR_CODES.TWO_FA_VERIFICATION_FAILED
        };
      }

      // 🔧 FIX #1: Use shared detectDeviceType utility
      const device_info = {
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent,
        device_type: detectDeviceType(device_context.user_agent)
      };

      // Enforce session limit
      await this.enforceSessionLimit(user_id, {
        email: admin.email,
        password: '',
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent
      });

      // Create admin session
      const token_pair = await sessionService.createAdminSession(
        user_id,
        admin.email,
        device_info
      );

      // Update login stats
      await this.handleSuccessfulLogin(user_id, {
        email: admin.email,
        password: '',
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent
      });

      // Reset rate limit
      await redisManager.resetRateLimit(`admin:${admin.email}`, 'login');

      logger.info('Admin 2FA login completed successfully', { user_id, email: admin.email });

      return {
        success: true,
        user: admin,
        access_token: token_pair.accessToken,
        refresh_token: token_pair.refreshToken
      };
    } catch (error: any) {
      logger.error('Error completing admin 2FA login:', error);
      return { 
        success: false, 
        error: 'Admin 2FA login failed', 
        error_code: AUTH_ERROR_CODES.ADMIN_2FA_LOGIN_FAILED 
      };
    }
  }
}

export const userService = new UserService();