import { OAuth2Client } from 'google-auth-library';
import mongoose from 'mongoose';
import { User, IApexUser, UserSecurity } from '../../../models/user.model';
import { sessionService } from './auth.session.service';
import { AuditService } from './auth.audit.service';
import { env } from '../../../configs/env.config';
import { createLogger } from '../../../shared/utils/logger.utils';
import { DeviceContext, detectDeviceType } from '../../../shared/utils/request.utils';
import { AUTH_ERROR_CODES } from '../../../shared/constants/error-codes';

const logger = createLogger('auth-google-service');

export interface GoogleUserPayload {
  sub: string; // Google user ID
  email: string;
  email_verified: boolean;
  name: string;
  given_name: string;
  family_name: string;
  picture?: string;
}

export interface GoogleAuthResult {
  success: boolean;
  user?: IApexUser;
  access_token?: string;
  refresh_token?: string;
  is_new_user?: boolean;
  requires_password?: boolean;
  error?: string;
  error_code?: string;
}

export class GoogleAuthService {
  private client: OAuth2Client;

  constructor() {
    this.client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  }

  /**
   * Verify Google ID token and extract user info
   */
  async verifyGoogleToken(id_token: string): Promise<GoogleUserPayload | null> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken: id_token,
        audience: env.GOOGLE_CLIENT_ID
      });

      const payload = ticket.getPayload();
      if (!payload) {
        logger.warn('Google token verification returned no payload');
        return null;
      }

      if (!payload.email_verified) {
        logger.warn('Google email not verified', { email: payload.email });
        return null;
      }

      return {
        sub: payload.sub,
        email: payload.email!,
        email_verified: payload.email_verified,
        name: payload.name || '',
        given_name: payload.given_name || '',
        family_name: payload.family_name || '',
        picture: payload.picture
      };
    } catch (error: any) {
      logger.error('Google token verification failed:', error);
      return null;
    }
  }

  /**
   * Authenticate or register user with Google
   */
  async authenticateWithGoogle(
    id_token: string,
    device_context: DeviceContext,
    role?: 'player' | 'organizer'
  ): Promise<GoogleAuthResult> {
    try {
      // 1. Verify the Google token
      const google_user = await this.verifyGoogleToken(id_token);
      if (!google_user) {
        return {
          success: false,
          error: 'Invalid Google token',
          error_code: AUTH_ERROR_CODES.INVALID_GOOGLE_TOKEN
        };
      }

      logger.info('Google authentication attempt', { email: google_user.email });

      // 2. Check if user exists by email
      const existing_user = await User.findOne({ email: google_user.email.toLowerCase() });

      if (existing_user) {
        // User exists - check if Google provider is linked
        return await this.handleExistingUser(existing_user, google_user, device_context);
      } else {
        // New user - create account
        return await this.handleNewUser(google_user, device_context, role);
      }
    } catch (error: any) {
      logger.error('Google authentication error:', error);
      return {
        success: false,
        error: 'Google authentication failed',
        error_code: AUTH_ERROR_CODES.GOOGLE_AUTH_FAILED
      };
    }
  }

  /**
   * Handle existing user trying to sign in with Google
   */
  private async handleExistingUser(
    user: IApexUser,
    google_user: GoogleUserPayload,
    device_context: DeviceContext
  ): Promise<GoogleAuthResult> {
    // Check if user is banned
    if (user.is_banned) {
      return {
        success: false,
        error: user.banned_reason || 'Account is suspended',
        error_code: AUTH_ERROR_CODES.ACCOUNT_BANNED
      };
    }

    // Check if user is active
    if (!user.is_active) {
      return {
        success: false,
        error: 'Account is deactivated',
        error_code: AUTH_ERROR_CODES.ACCOUNT_INACTIVE
      };
    }

    // Check if Google provider is already linked
    const has_google = user.auth_providers?.some(p => p.provider === 'google');

    if (has_google) {
      // Google already linked - proceed with login
      return await this.completeGoogleLogin(user, device_context);
    }

    // Google not linked - check if user has local provider (password)
    const has_local = user.auth_providers?.some(p => p.provider === 'local');

    if (has_local) {
      // User has password - they need to confirm password to link Google
      return {
        success: false,
        error: 'An account with this email exists. Please enter your password to link Google.',
        error_code: AUTH_ERROR_CODES.ACCOUNT_EXISTS_LINK_REQUIRED,
        user
      };
    }

    // User exists but has no providers (edge case) - link Google
    await this.linkGoogleProvider(user._id.toString(), google_user);
    return await this.completeGoogleLogin(user, device_context);
  }

  /**
   * Handle new user registration with Google
   */
  private async handleNewUser(
    google_user: GoogleUserPayload,
    device_context: DeviceContext,
    role?: 'player' | 'organizer' | 'admin',
  ): Promise<GoogleAuthResult> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user_role = role || 'player';

      // Prevent admin registration through Google
      if (user_role === 'admin') {
        throw new Error(AUTH_ERROR_CODES.INVALID_ROLE);
      }

      // Generate unique username from email
      const base_username = google_user.email.split('@')[0].toLowerCase();
      let username = base_username;
      let counter = 1;

      while (await User.findOne({ username }).session(session)) {
        username = `${base_username}${counter}`;
        counter++;
      }

      // Create user - FIXED: Remove password_hash since it's not required in schema
      const newUserData = {
        email: google_user.email.toLowerCase(),
        username,
        role: user_role,
        auth_providers: [{
          provider: 'google' as const,
          provider_user_id: google_user.sub,
          linked_at: new Date(),
          is_primary: true
        }],
        profile: {
          first_name: google_user.given_name,
          last_name: google_user.family_name,
          avatar_url: google_user.picture || '',
          country: device_context.country || 'UNKNOWN'
        },
        verification_status: {
          email_verified: true,
          email_verified_via: 'google' as const,
          phone_verified: false,
          identity_verified: false,
          organizer_verified: false
        },
        is_active: true,
        is_banned: false
      };

      // Create user
      const createdUsers = await User.create([newUserData], { session });
      const user = createdUsers[0];

      // Create user security record
      await UserSecurity.create([{
        user_id: user._id,
        lockout: {
          is_locked: false,
          failed_login_attempts: 0
        },
        two_factor: {
          is_enabled: false,
          method: 'none' as const,
          setup_required: false
        },
        password: {
          last_changed_at: new Date(),
          change_required: false,
          strength_score: 0
        },
        risk: {
          current_risk_level: 'low' as const,
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

      await session.commitTransaction();

      // Log registration
      await AuditService.logAuthEvent({
        user_id: user._id.toString(),
        event_type: 'registration_completed',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          auth_method: 'google'
        }
      });

      logger.info('New user registered with Google', {
        user_id: user._id,
        email: user.email,
        role: user_role
      });

      // Complete login
      const login_result = await this.completeGoogleLogin(user, device_context);
      
      return {
        ...login_result,
        is_new_user: true
      };
    } catch (error: any) {
      await session.abortTransaction();
      logger.error('Error creating Google user:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Complete Google login - create session and return tokens
   */
  private async completeGoogleLogin(
    user: IApexUser,
    device_context: DeviceContext
  ): Promise<GoogleAuthResult> {
    const device_info = {
      ip_address: device_context.ip_address,
      user_agent: device_context.user_agent,
      device_type: detectDeviceType(device_context.user_agent)
    };

    // Create session
    const token_pair = await sessionService.createUserSession(
      user._id.toString(),
      user.email,
      user.role as 'player' | 'organizer',
      device_info
    );

    // Update last login
    await User.findByIdAndUpdate(user._id, {
      last_login: new Date(),
      last_active_at: new Date()
    });

    logger.info('Google login successful', { user_id: user._id, email: user.email });

    return {
      success: true,
      user,
      access_token: token_pair.accessToken,
      refresh_token: token_pair.refreshToken,
      is_new_user: false
    };
  }

  /**
   * Link Google provider to existing user
   */
  async linkGoogleProvider(user_id: string, google_user: GoogleUserPayload): Promise<void> {
    await User.findByIdAndUpdate(user_id, {
      $push: {
        auth_providers: {
          provider: 'google' as const,
          provider_user_id: google_user.sub,
          linked_at: new Date(),
          is_primary: false
        }
      }
    });

    await AuditService.logAuthEvent({
      user_id,
      event_type: 'registration_completed',
      success: true,
      metadata: {
        ip_address: 'system',
        user_agent: 'system',
        auth_method: 'google_link'
      }
    });

    logger.info('Google provider linked to user', { user_id });
  }

  /**
   * Link Google account with password confirmation
   */
  async linkGoogleWithPassword(
    id_token: string,
    password: string,
    device_context: DeviceContext
  ): Promise<GoogleAuthResult> {
    try {
      // 1. Verify Google token
      const google_user = await this.verifyGoogleToken(id_token);
      if (!google_user) {
        return {
          success: false,
          error: 'Invalid Google token',
          error_code: AUTH_ERROR_CODES.INVALID_GOOGLE_TOKEN
        };
      }

      // 2. Find user by email
      const user = await User.findOne({ email: google_user.email.toLowerCase() });
      if (!user) {
        return {
          success: false,
          error: 'No account found with this email',
          error_code: AUTH_ERROR_CODES.USER_NOT_FOUND
        };
      }

      // 3. Check if already has Google linked
      const has_google = user.auth_providers?.some(p => p.provider === 'google');
      if (has_google) {
        return {
          success: false,
          error: 'Google already linked to this account',
          error_code: AUTH_ERROR_CODES.GOOGLE_ALREADY_LINKED
        };
      }

      // 4. Verify password - FIXED: Check if password_hash exists
      if (!user.password_hash) {
        return {
          success: false,
          error: 'No password set for this account',
          error_code: AUTH_ERROR_CODES.INVALID_CREDENTIALS
        };
      }

      const { PasswordService } = await import('./auth.password.service');
      const is_valid = await PasswordService.comparePassword(password, user.password_hash);
      if (!is_valid) {
        await AuditService.logAuthEvent({
          user_id: user._id.toString(),
          event_type: 'login_failed',
          success: false,
          metadata: {
            ip_address: device_context.ip_address,
            user_agent: device_context.user_agent,
            failure_reason: 'Invalid password during Google link attempt'
          }
        });

        return {
          success: false,
          error: 'Invalid password',
          error_code: AUTH_ERROR_CODES.INVALID_CREDENTIALS
        };
      }

      // 5. Link Google provider
      await this.linkGoogleProvider(user._id.toString(), google_user);

      // 6. Log the linking
      await AuditService.logAuthEvent({
        user_id: user._id.toString(),
        event_type: 'registration_completed',
        success: true,
        metadata: {
          ip_address: device_context.ip_address,
          user_agent: device_context.user_agent,
          auth_method: 'google_link'
        }
      });

      // 7. Complete login
      return await this.completeGoogleLogin(user, device_context);
    } catch (error: any) {
      logger.error('Error linking Google with password:', error);
      return {
        success: false,
        error: 'Failed to link Google account',
        error_code: AUTH_ERROR_CODES.GOOGLE_LINK_FAILED
      };
    }
  }
}

export const googleAuthService = new GoogleAuthService();