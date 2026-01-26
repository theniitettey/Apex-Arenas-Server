import { User, IApexUser, UserSecurity, IApexUserSecurity } from '../../../models/user.model';
import { PasswordService } from './auth.password.service';
import { AuditService } from './auth.audit.service';
import { tokenService } from './auth.token.service';
import { sessionService } from './auth.session.service';
import { twoFactorService } from './auth.2fa.service';
import { redisManager } from '../../../configs/redis.config';
import { env } from '../../../configs/env.config';
import { createLogger } from '../../../shared/utils/logger.utils';

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
  admin_secret?: string; // Optional additional layer (can be used in middleware)
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

export interface DeviceContext {
  ip_address: string;
  user_agent: string;
  device_fingerprint?: string;
  device_type?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
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
  // Lockout configuration
  private readonly MAX_FAILED_ATTEMPTS_USER = 5;
  private readonly MAX_FAILED_ATTEMPTS_ADMIN = 3; // Stricter for admin
  private readonly LOCK_TIME_USER = 30 * 60 * 1000; // 30 minutes
  private readonly LOCK_TIME_ADMIN = 60 * 60 * 1000; // 1 hour for admin

  // ============================================
  // USER REGISTRATION (Player/Organizer)
  // ============================================

  /**
   * Register a new user (player or organizer)
   */
  async registerUser(
    userData: CreateUserData,
    device_context: DeviceContext
  ): Promise<IApexUser> {
    try {
      logger.info('Registering new user', { email: userData.email, role: userData.role || 'player' });

      // Validate role - admin cannot be registered through this method
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
        throw new Error('INVALID_ROLE');
      }

      // Check if email already exists
      const existing_email = await User.findOne({ email: userData.email.toLowerCase() });
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
        throw new Error('EMAIL_ALREADY_EXISTS');
      }

      // Check if username already exists
      const existing_username = await User.findOne({ username: userData.username.toLowerCase() });
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
        throw new Error('USERNAME_ALREADY_EXISTS');
      }

      // Validate password strength
      const password_validation = PasswordService.validatePasswordStrength(userData.password);
      if (!password_validation.is_valid) {
        await AuditService.logAuthEvent({
          event_type: 'registration_failed',
          success: false,
          identifier: userData.email,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: `Weak password: ${password_validation.errors.join(', ')}`
          }
        });
        throw new Error(`WEAK_PASSWORD:${password_validation.errors.join('|')}`);
      }

      // Check if password is breached
      const is_breached = await PasswordService.checkPasswordBreach(userData.password);
      if (is_breached) {
        throw new Error('PASSWORD_COMPROMISED');
      }

      // Hash password
      const password_hash = await PasswordService.hashPassword(userData.password);

      // Create user
      const user = await User.create({
        email: userData.email.toLowerCase(),
        username: userData.username.toLowerCase(),
        password_hash,
        role,
        profile: {
          first_name: userData.first_name,
          last_name: userData.last_name,
          country: 'GH'
        },
        verification_status: {
          email_verified: false,
          phone_verified: false,
          identity_verified: false,
          organizer_verified: false
        },
        is_active: true,
        is_banned: false
      });

      // Create user security record
      await UserSecurity.create({
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
      });

      // Log successful registration
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
      logger.error('Error registering user:', error);
      throw error;
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

      const device_info = {
        ip_address: credentials.ip_address,
        user_agent: credentials.user_agent,
        device_type: this.detectDeviceType(credentials.user_agent) as 'mobile' | 'tablet' | 'desktop' | 'unknown'
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
          error_code: 'RATE_LIMIT_EXCEEDED'
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
            failure_reason: 'User not found or inactive'
          }
        });
        return { success: false, error: 'Invalid credentials', error_code: 'INVALID_CREDENTIALS' };
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
          error: user.banned_reason || 'Account is banned',
          error_code: 'ACCOUNT_BANNED'
        };
      }

      // Get user security record
      const security = await UserSecurity.findOne({ user_id: user._id });

      // Check if account is locked
      if (security?.lockout.is_locked && security.lockout.locked_until) {
        if (security.lockout.locked_until > new Date()) {
          await AuditService.logAuthEvent({
            user_id: user._id.toString(),
            event_type: 'login_failed',
            success: false,
            metadata: {
              ip_address: credentials.ip_address,
              user_agent: credentials.user_agent,
              failure_reason: 'Account locked'
            }
          });
          return {
            success: false,
            error: 'Account is temporarily locked',
            error_code: 'ACCOUNT_LOCKED',
            is_locked: true,
            lock_until: security.lockout.locked_until
          };
        } else {
          // Lock expired, reset
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
        return { success: false, error: 'Invalid credentials', error_code: 'INVALID_CREDENTIALS' };
      }

      // Check if email verification is required
      if (!user.verification_status.email_verified) {
        return {
          success: false,
          error: 'Please verify your email address',
          error_code: 'EMAIL_NOT_VERIFIED',
          requires_email_verification: true,
          user
        };
      }

      // Check if 2FA is enabled
      if (security?.two_factor.is_enabled) {
        return {
          success: false,
          error: '2FA verification required',
          error_code: '2FA_REQUIRED',
          requires_2fa: true,
          user
        };
      }

      // Successful login - generate tokens
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
      return { success: false, error: 'Login failed', error_code: 'LOGIN_FAILED' };
    }
  }

  // ============================================
  // ADMIN LOGIN (Separate Secure Flow)
  // ============================================

  /**
   * Login admin user with enhanced security
   * Only users with emails in ADMIN_EMAILS env variable can login as admin
   */
  async loginAdmin(credentials: AdminLoginCredentials): Promise<AdminLoginResult> {
    try {
      logger.info('Admin login attempt', { email: credentials.email });

      const device_info = {
        ip_address: credentials.ip_address,
        user_agent: credentials.user_agent,
        device_type: this.detectDeviceType(credentials.user_agent) as 'mobile' | 'tablet' | 'desktop' | 'unknown'
      };

      // Parse allowed admin emails from env
      const allowed_admin_emails = this.getAllowedAdminEmails();

      // Check if email is in allowed admin list
      if (!allowed_admin_emails.includes(credentials.email.toLowerCase())) {
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
        
        logger.warn('Unauthorized admin login attempt', { email: credentials.email, ip: credentials.ip_address });
        
        // Return generic error to avoid email enumeration
        return { 
          success: false, 
          error: 'Invalid credentials',
          error_code: 'INVALID_CREDENTIALS',
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
          error_code: 'RATE_LIMIT_EXCEEDED',
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
        // Check if user exists but isn't admin yet (first time setup)
        const existing_user = await User.findOne({ email: credentials.email.toLowerCase() });
        
        if (!existing_user) {
          // Admin doesn't exist - this is the first login, need to create
          await AuditService.logAuthEvent({
            event_type: 'login_failed',
            success: false,
            identifier: credentials.email,
            metadata: {
              ip_address: credentials.ip_address,
              user_agent: credentials.user_agent,
              failure_reason: 'Admin account not set up'
            }
          });
          return {
            success: false,
            error: 'Admin account not set up. Please contact system administrator.',
            error_code: 'ADMIN_NOT_SETUP',
            is_admin: false
          };
        }

        // User exists but not as admin
        await AuditService.logSuspiciousActivity(
          existing_user._id.toString(),
          'Non-admin user attempted admin login',
          {
            ip_address: credentials.ip_address,
            user_agent: credentials.user_agent,
            risk_factors: ['role_mismatch', 'admin_endpoint_misuse']
          }
        );
        return {
          success: false,
          error: 'Invalid credentials',
          error_code: 'INVALID_CREDENTIALS',
          is_admin: false
        };
      }

      // Get admin security record
      const security = await UserSecurity.findOne({ user_id: admin._id });

      // Check if admin account is locked (stricter lockout)
      if (security?.lockout.is_locked && security.lockout.locked_until) {
        if (security.lockout.locked_until > new Date()) {
          await AuditService.logAuthEvent({
            user_id: admin._id.toString(),
            event_type: 'login_failed',
            success: false,
            metadata: {
              ip_address: credentials.ip_address,
              user_agent: credentials.user_agent,
              failure_reason: 'Admin account locked'
            }
          });
          return {
            success: false,
            error: 'Admin account is temporarily locked',
            error_code: 'ACCOUNT_LOCKED',
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
        
        // Track failed admin attempts in Redis too
        await redisManager.trackFailedAttempt(`admin:${credentials.email}`);
        
        return {
          success: false,
          error: 'Invalid credentials',
          error_code: 'INVALID_CREDENTIALS',
          is_admin: false
        };
      }

      // // Check if 2FA is enabled (highly recommended for admin)
      // if (security?.two_factor.is_enabled) {
      //   return {
      //     success: false,
      //     error: '2FA verification required',
      //     error_code: '2FA_REQUIRED',
      //     requires_2fa: true,
      //     user: admin,
      //     is_admin: true
      //   };
      // }


      // Check if 2FA setup is required but not completed
      if (security?.two_factor.setup_required && !security?.two_factor.is_enabled) {
        return {
          success: false,
          error: 'Please complete 2FA setup before proceeding',
          error_code: '2FA_SETUP_REQUIRED',
          requires_2fa: true,  // ← Frontend shows QR code
          user: admin,
          is_admin: true
        };
      }

      // Check if 2FA is enabled (mandatory for admin)
      if (!security?.two_factor.is_enabled) {
        return {
          success: false,
          error: '2FA must be enabled for admin accounts',
          error_code: '2FA_NOT_ENABLED',
          is_admin: true
        };
      }


      // Successful admin login - generate admin tokens
      const token_pair = await sessionService.createAdminSession(
        admin._id.toString(),
        admin.email,
        device_info
      );

      // Update login stats
      await this.handleSuccessfulLogin(admin._id.toString(), credentials);

      // Reset rate limits
      await redisManager.resetRateLimit(`admin:${credentials.email}`, 'login');
      await redisManager.resetFailedAttempts(`admin:${credentials.email}`);

      // Log successful admin login
      await AuditService.logAuthEvent({
        user_id: admin._id.toString(),
        event_type: 'login_success',
        success: true,
        metadata: {
          ip_address: credentials.ip_address,
          user_agent: credentials.user_agent,
          is_suspicious: false
        }
      });

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
      return {
        success: false,
        error: 'Login failed',
        error_code: 'LOGIN_FAILED',
        is_admin: false
      };
    }
  }

  /**
   * Setup new admin account (called by super admin or system setup)
   * Admin emails must be in ADMIN_EMAILS env variable
   */
  async setupAdminAccount(
    email: string,
    password: string,
    admin_data: { first_name: string; last_name: string; username: string },
    device_context: DeviceContext
  ): Promise<IApexUser> {
    try {
      logger.info('Setting up admin account', { email });

      // Verify email is in allowed admin list
      const allowed_admin_emails = this.getAllowedAdminEmails();
      if (!allowed_admin_emails.includes(email.toLowerCase())) {
        await AuditService.logSuspiciousActivity(
          undefined,
          'Unauthorized admin setup attempt',
          {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            risk_factors: ['unauthorized_admin_setup', 'email_not_whitelisted'],
            attempted_email: email
          }
        );
        throw new Error('UNAUTHORIZED_ADMIN_EMAIL');
      }

      // Check if admin already exists
      const existing_admin = await User.findOne({ email: email.toLowerCase() });
      if (existing_admin) {
        throw new Error('ADMIN_ALREADY_EXISTS');
      }

      // Validate password (stricter for admin)
      const password_validation = PasswordService.validatePasswordStrength(password);
      if (!password_validation.is_valid || (password_validation.strength_score || 0) < 80) {
        throw new Error('ADMIN_PASSWORD_TOO_WEAK');
      }

      // Hash password
      const password_hash = await PasswordService.hashPassword(password);

      // Create admin user
      const admin = await User.create({
        email: email.toLowerCase(),
        username: admin_data.username.toLowerCase(),
        password_hash,
        role: 'admin',
        profile: {
          first_name: admin_data.first_name,
          last_name: admin_data.last_name,
          country: 'GH'
        },
        verification_status: {
          email_verified: true, // Admins are pre-verified
          phone_verified: false,
          identity_verified: true,
          organizer_verified: false
        },
        is_active: true,
        is_banned: false
      });

      // Create security record with stricter defaults
      await UserSecurity.create({
        user_id: admin._id,
        lockout: {
          is_locked: false,
          failed_login_attempts: 0
        },
        two_factor: {
          is_enabled: false, // Should be enabled after first login
          method: 'none',
          setup_required: true
        },
        password: {
          last_changed_at: new Date(),
          change_required: false,
          strength_score: password_validation.strength_score
        },
        max_allowed_sessions: 2, // Stricter for admin
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
        },
        withdrawal_security: {
          require_2fa: true,
          require_otp: true,
          cooling_period_hours: 48
        }
      });

      await AuditService.logAuthEvent({
        user_id: admin._id.toString(),
        event_type: 'registration_completed',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      logger.info('Admin account set up successfully', { user_id: admin._id, email: admin.email });

      return admin;
    } catch (error: any) {
      logger.error('Error setting up admin account:', error);
      throw error;
    }
  }

  // ============================================
  // USER PROFILE MANAGEMENT
  // ============================================

  /**
   * Get user profile by ID
   */
  async getUserProfile(user_id: string): Promise<IApexUser | null> {
    try {
      return await User.findById(user_id).select('-password_hash');
    } catch (error: any) {
      logger.error('Error getting user profile:', error);
      throw new Error('USER_PROFILE_FETCH_FAILED');
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<IApexUser | null> {
    try {
      return await User.findOne({ email: email.toLowerCase() }).select('-password_hash');
    } catch (error: any) {
      logger.error('Error getting user by email:', error);
      throw new Error('USER_FETCH_FAILED');
    }
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<IApexUser | null> {
    try {
      return await User.findOne({ username: username.toLowerCase() }).select('-password_hash');
    } catch (error: any) {
      logger.error('Error getting user by username:', error);
      throw new Error('USER_FETCH_FAILED');
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(
    user_id: string,
    updates: UpdateProfileData,
    device_context: DeviceContext
  ): Promise<IApexUser> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      // Update profile fields
      if (updates.first_name) user.profile.first_name = updates.first_name;
      if (updates.last_name) user.profile.last_name = updates.last_name;
      if (updates.bio !== undefined) user.profile.bio = updates.bio;
      if (updates.phone_number) user.profile.phone_number = updates.phone_number;
      if (updates.country) user.profile.country = updates.country;
      if (updates.social_links) {
        user.profile.social_links = {
          ...user.profile.social_links,
          ...updates.social_links
        };
      }

      await user.save();

      logger.info('User profile updated', { user_id });

      return user;
    } catch (error: any) {
      logger.error('Error updating user profile:', error);
      throw error;
    }
  }

  // ============================================
  // PASSWORD MANAGEMENT
  // ============================================

  /**
   * Change user password
   */
  async changePassword(
    user_id: string,
    current_password: string,
    new_password: string,
    device_context: DeviceContext
  ): Promise<void> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      // Verify current password
      const is_current_valid = await PasswordService.comparePassword(
        current_password,
        user.password_hash
      );

      if (!is_current_valid) {
        await AuditService.logAuthEvent({
          user_id: user._id.toString(),
          event_type: 'password_change_failed',
          success: false,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Current password incorrect'
          }
        });
        throw new Error('INVALID_CURRENT_PASSWORD');
      }

      // Validate new password strength
      const password_validation = PasswordService.validatePasswordStrength(new_password);
      if (!password_validation.is_valid) {
        throw new Error(`WEAK_PASSWORD:${password_validation.errors.join('|')}`);
      }

      // Check password history (prevent reuse)
      const security = await UserSecurity.findOne({ user_id: user._id });
      if (security?.password.previous_hashes) {
        const is_reused = await PasswordService.isPasswordReused(
          new_password,
          security.password.previous_hashes
        );
        if (is_reused) {
          throw new Error('PASSWORD_RECENTLY_USED');
        }
      }

      // Hash and update password
      const new_hash = await PasswordService.hashPassword(new_password);
      const old_hash = user.password_hash;

      user.password_hash = new_hash;
      await user.save();

      // Update security record
      if (security) {
        const previous_hashes = security.password.previous_hashes || [];
        previous_hashes.unshift(old_hash);
        security.password.previous_hashes = previous_hashes.slice(0, 5); // Keep last 5
        security.password.last_changed_at = new Date();
        security.password.strength_score = password_validation.strength_score;
        await security.save();
      }

      // Revoke all existing tokens (security measure)
      await tokenService.revokeAllUserTokens(user_id, 'password_change');

      await AuditService.logAuthEvent({
        user_id: user._id.toString(),
        event_type: 'password_change_success',
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

  // ============================================
  // ACCOUNT MANAGEMENT
  // ============================================

  /**
   * Verify user email
   */
  async verifyUserEmail(user_id: string): Promise<void> {
    try {
      await User.findByIdAndUpdate(user_id, {
        'verification_status.email_verified': true,
        'verification_status.verified_at': new Date()
      });

      logger.info('User email verified', { user_id });
    } catch (error: any) {
      logger.error('Error verifying user email:', error);
      throw new Error('EMAIL_VERIFICATION_FAILED');
    }
  }

  /**
   * Deactivate user account
   */
  async deactivateAccount(user_id: string, device_context: DeviceContext): Promise<void> {
    try {
      const user = await User.findById(user_id);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      user.is_active = false;
      await user.save();

      // Revoke all tokens
      await tokenService.revokeAllUserTokens(user_id, 'logout');

      await AuditService.logAuthEvent({
        user_id: user._id.toString(),
        event_type: 'account_deactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      logger.info('User account deactivated', { user_id });
    } catch (error: any) {
      logger.error('Error deactivating account:', error);
      throw error;
    }
  }

  /**
   * Reactivate user account
   */
  async reactivateAccount(user_id: string, device_context: DeviceContext): Promise<void> {
    try {
      await User.findByIdAndUpdate(user_id, { is_active: true });

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_reactivated',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent
        }
      });

      logger.info('User account reactivated', { user_id });
    } catch (error: any) {
      logger.error('Error reactivating account:', error);
      throw error;
    }
  }

  // ============================================
  // 2FA LOGIN COMPLETION
  // ============================================

  /**
   * Complete login after 2FA verification (for users)
   */
  async complete2FALogin(
    user_id: string,
    code: string,
    use_backup_code: boolean,
    device_context: DeviceContext
  ): Promise<Complete2FALoginResult> {
    try {
      logger.info('Completing 2FA login', { user_id, use_backup_code });

      const device_info = {
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent,
        device_type: this.detectDeviceType(device_context.user_agent) as 'mobile' | 'tablet' | 'desktop' | 'unknown'
      };

      // Verify 2FA code
      let verification;
      if (use_backup_code) {
        verification = await twoFactorService.verifyBackupCode(user_id, code, device_context);
      } else {
        verification = await twoFactorService.verifyTOTPCode(user_id, code, device_context);
      }

      if (!verification.valid) {
        return {
          success: false,
          error: verification.error === 'INVALID_CODE' ? 'Invalid verification code' : 'Verification failed',
          error_code: verification.error
        };
      }

      // Get user
      const user = await User.findById(user_id);
      if (!user || !user.is_active) {
        return {
          success: false,
          error: 'User not found or inactive',
          error_code: 'USER_NOT_FOUND'
        };
      }

      // Generate tokens based on role
      let token_pair;
      if (user.role === 'admin') {
        token_pair = await sessionService.createAdminSession(
          user._id.toString(),
          user.email,
          device_info
        );
      } else {
        token_pair = await sessionService.createUserSession(
          user._id.toString(),
          user.email,
          user.role as 'player' | 'organizer',
          device_info
        );
      }

      // Update login stats
      await this.handleSuccessfulLogin(user._id.toString(), {
        email: user.email,
        password: '',
        ip_address: device_context.ip_address,
        user_agent: device_context.user_agent
      });

      logger.info('2FA login completed successfully', { user_id, role: user.role });

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
        error: 'Login failed',
        error_code: '2FA_LOGIN_FAILED'
      };
    }
  }

  /**
   * Complete admin login after 2FA verification
   */
  async completeAdmin2FALogin(
    user_id: string,
    code: string,
    use_backup_code: boolean,
    device_context: DeviceContext
  ): Promise<Complete2FALoginResult & { is_admin: boolean }> {
    try {
      logger.info('Completing admin 2FA login', { user_id });

      // Verify user is admin
      const admin = await User.findOne({ _id: user_id, role: 'admin', is_active: true });
      if (!admin) {
        return {
          success: false,
          error: 'Admin not found',
          error_code: 'ADMIN_NOT_FOUND',
          is_admin: false
        };
      }

      const result = await this.complete2FALogin(user_id, code, use_backup_code, device_context);

      return {
        ...result,
        is_admin: result.success
      };
    } catch (error: any) {
      logger.error('Error completing admin 2FA login:', error);
      return {
        success: false,
        error: 'Login failed',
        error_code: 'ADMIN_2FA_LOGIN_FAILED',
        is_admin: false
      };
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Get allowed admin emails from environment
   */
  private getAllowedAdminEmails(): string[] {
    const admin_emails_raw = env.ADMIN_EMAILS || '';
    return admin_emails_raw
      .split(',')
      .map((email: string) => email.trim().toLowerCase())
      .filter((email: string) => email.length > 0);
  }

  /**
   * Detect device type from user agent
   */
  private detectDeviceType(user_agent: string): string {
    const ua = user_agent.toLowerCase();
    if (/mobile|android|iphone|ipad|phone/i.test(ua)) {
      return /tablet|ipad/i.test(ua) ? 'tablet' : 'mobile';
    }
    return 'desktop';
  }

  /**
   * Handle failed login attempt
   */
  private async handleFailedLogin(
    user_id: string,
    credentials: LoginCredentials,
    user_type: 'user' | 'admin'
  ): Promise<void> {
    const max_attempts = user_type === 'admin' ? this.MAX_FAILED_ATTEMPTS_ADMIN : this.MAX_FAILED_ATTEMPTS_USER;
    const lock_time = user_type === 'admin' ? this.LOCK_TIME_ADMIN : this.LOCK_TIME_USER;

    const security = await UserSecurity.findOne({ user_id });
    if (!security) return;

    security.lockout.failed_login_attempts += 1;
    security.lockout.last_failed_attempt_at = new Date();

    if (security.lockout.failed_login_attempts >= max_attempts) {
      security.lockout.is_locked = true;
      security.lockout.locked_at = new Date();
      security.lockout.locked_until = new Date(Date.now() + lock_time);
      security.lockout.lock_reason = 'failed_attempts';

      await AuditService.logAuthEvent({
        user_id,
        event_type: 'account_locked',
        success: false,
        metadata: {
          ip_address: credentials.ip_address,
          user_agent: credentials.user_agent,
          failure_reason: 'Too many failed login attempts'
        }
      });
    }

    await security.save();

    await AuditService.logAuthEvent({
      user_id,
      event_type: 'login_failed',
      success: false,
      metadata: {
        ip_address: credentials.ip_address,
        user_agent: credentials.user_agent,
        failure_reason: 'Invalid password'
      }
    });
  }

  /**
   * Handle successful login
   */
  private async handleSuccessfulLogin(user_id: string, credentials: LoginCredentials): Promise<void> {
    // Update user last login
    await User.findByIdAndUpdate(user_id, {
      last_login: new Date(),
      last_active_at: new Date()
    });

    // Update security stats
    const security = await UserSecurity.findOne({ user_id });
    if (security) {
      security.lockout.failed_login_attempts = 0;
      security.lockout.is_locked = false;
      security.lockout.locked_until = undefined;
      security.activity_summary.total_logins += 1;
      security.activity_summary.logins_last_30_days += 1;
      security.activity_summary.last_login_at = new Date();
      security.activity_summary.last_login_ip = credentials.ip_address;
      await security.save();
    }
  }

  /**
   * Reset account lockout
   */
  private async resetLockout(user_id: string): Promise<void> {
    await UserSecurity.findOneAndUpdate(
      { user_id },
      {
        'lockout.is_locked': false,
        'lockout.locked_until': null,
        'lockout.failed_login_attempts': 0
      }
    );
  }
}

export const userService = new UserService();
