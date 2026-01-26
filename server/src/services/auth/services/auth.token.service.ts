import jwt from 'jsonwebtoken';
import { RefreshToken } from '../../../models/user.model';
import { CryptoUtils } from '../../../shared/utils/crypto.utils';
import { env } from '../../../configs/env.config';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-token-service');

export interface TokenPayload {
  user_id: string;
  email: string;
  role: 'player' | 'organizer' | 'admin';
  type: 'access' | 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenVerificationResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

export interface DeviceInfo {
  user_agent: string;
  ip_address: string;
  device_type?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  device_name?: string;
}

/**
 * Token service handling JWT tokens and refresh tokens
 * Supports: players, organizers (user tokens) and admins (admin tokens)
 */

export class TokenService {

  // ============================================
  // ACCESS TOKEN GENERATION
  // ============================================

  /**
   * Generate access token for players and organizers
   */
  async generateUserAccessToken(user_id: string, email: string, role: 'player' | 'organizer'): Promise<string> {
    try {
      const validRoles: Array<'player' | 'organizer'> = ['player', 'organizer'];
      const userRole = validRoles.includes(role) ? role : 'player';

      const payload: TokenPayload = {
        user_id,
        email,
        role: userRole,
        type: 'access'
      };

      return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
        expiresIn: env.JWT_ACCESS_EXPIRES_IN,
        issuer: env.JWT_ISSUER_USERS,
        audience: 'users'
      });
    } catch (error: any) {
      logger.error('Error generating user access token:', error);
      throw new Error('ACCESS_TOKEN_GENERATION_FAILED');
    }
  }

  /**
   * Generate access token for admins (separate secret & issuer)
   */
  async generateAdminAccessToken(user_id: string, email: string): Promise<string> {
    try {
      const payload: TokenPayload = {
        user_id,
        email,
        role: 'admin',
        type: 'access'
      };

      return jwt.sign(payload, env.JWT_ADMIN_ACCESS_SECRET, {
        expiresIn: env.JWT_ADMIN_ACCESS_EXPIRES_IN,
        issuer: env.JWT_ISSUER_ADMIN,
        audience: 'admin'
      });
    } catch (error: any) {
      logger.error('Error generating admin access token:', error);
      throw new Error('ACCESS_TOKEN_GENERATION_FAILED');
    }
  }

  // ============================================
  // REFRESH TOKEN GENERATION
  // ============================================

  /**
   * Generate refresh token and store in database
   * Works for all roles (player, organizer, admin)
   */
  async generateRefreshToken(
    user_id: string,
    device_info: DeviceInfo,
    revokeExisting: boolean = false
  ): Promise<string> {
    try {
      const refreshToken = CryptoUtils.generateCryptoString(64);
      const token_hash = CryptoUtils.hashDeterministic(refreshToken);
      const family_id = CryptoUtils.generateCryptoString(32);

      const expires_at = new Date();
      expires_at.setSeconds(expires_at.getSeconds() + this.parseJWTExpiry(env.JWT_REFRESH_EXPIRES_IN));

      if (revokeExisting) {
        await RefreshToken.updateMany(
          { user_id, is_revoked: false },
          { is_revoked: true, revoked_at: new Date(), revoke_reason: 'token_rotation' }
        );
        logger.info('Revoked existing tokens for new login', { user_id });
      }

      await RefreshToken.create({
        user_id,
        token_hash,
        family_id,
        generation: 0,
        expires_at,
        is_revoked: false,
        device_info: {
          user_agent: device_info.user_agent,
          ip_address: device_info.ip_address,
          device_type: device_info.device_type || 'unknown',
          device_name: device_info.device_name
        },
        use_count: 0
      });

      return refreshToken;
    } catch (error: any) {
      logger.error('Error generating refresh token:', error);
      throw new Error('REFRESH_TOKEN_GENERATION_FAILED');
    }
  }

  // ============================================
  // TOKEN PAIR GENERATION
  // ============================================

  /**
   * Generate token pair for players and organizers
   */
  async generateUserTokenPair(
    user_id: string,
    email: string,
    role: 'player' | 'organizer',
    device_info: DeviceInfo,
    revokeExisting: boolean = true
  ): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.generateUserAccessToken(user_id, email, role),
      this.generateRefreshToken(user_id, device_info, revokeExisting)
    ]);

    return { accessToken, refreshToken };
  }

  /**
   * Generate token pair for admins
   */
  async generateAdminTokenPair(
    user_id: string,
    email: string,
    device_info: DeviceInfo,
    revokeExisting: boolean = true
  ): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.generateAdminAccessToken(user_id, email),
      this.generateRefreshToken(user_id, device_info, revokeExisting)
    ]);

    return { accessToken, refreshToken };
  }

  // ============================================
  // ACCESS TOKEN VERIFICATION
  // ============================================

  /**
   * Verify user access token (player/organizer)
   */
  async verifyUserAccessToken(token: string): Promise<TokenVerificationResult> {
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
        issuer: env.JWT_ISSUER_USERS,
        audience: 'users'
      }) as TokenPayload;

      if (payload.role === 'admin') {
        return { valid: false, error: 'INVALID_TOKEN_TYPE' };
      }

      return { valid: true, payload };
    } catch (error: any) {
      logger.warn('User access token verification failed:', error.message);
      return { valid: false, error: this.mapJWTError(error) };
    }
  }

  /**
   * Verify admin access token
   */
  async verifyAdminAccessToken(token: string): Promise<TokenVerificationResult> {
    try {
      const payload = jwt.verify(token, env.JWT_ADMIN_ACCESS_SECRET, {
        issuer: env.JWT_ISSUER_ADMIN,
        audience: 'admin'
      }) as TokenPayload;

      if (payload.role !== 'admin') {
        return { valid: false, error: 'INVALID_TOKEN_TYPE' };
      }

      return { valid: true, payload };
    } catch (error: any) {
      logger.warn('Admin access token verification failed:', error.message);
      return { valid: false, error: this.mapJWTError(error) };
    }
  }

  // ============================================
  // REFRESH TOKEN VERIFICATION
  // ============================================

  /**
   * Verify refresh token (works for all roles)
   */
  async verifyRefreshToken(token: string): Promise<TokenVerificationResult> {
    try {
      const token_hash = CryptoUtils.hashDeterministic(token);

      const storedToken = await RefreshToken.findOne({
        token_hash,
        is_revoked: false,
        expires_at: { $gt: new Date() }
      }).populate('user_id', 'email role');

      if (!storedToken) {
        logger.warn('Refresh token not found or invalid', {
          token_hash: token_hash.substring(0, 10) + '...'
        });
        return { valid: false, error: 'INVALID_REFRESH_TOKEN' };
      }

      // Update last used
      await RefreshToken.updateOne(
        { _id: storedToken._id },
        { last_used_at: new Date(), $inc: { use_count: 1 } }
      );

      const user = storedToken.user_id as any;
      const payload: TokenPayload = {
        user_id: user._id.toString(),
        email: user.email,
        role: user.role,
        type: 'refresh'
      };

      return { valid: true, payload };
    } catch (error: any) {
      logger.error('Error verifying refresh token:', error);
      return { valid: false, error: 'REFRESH_TOKEN_VERIFICATION_FAILED' };
    }
  }

  // ============================================
  // TOKEN REVOCATION
  // ============================================

  /**
   * Revoke single refresh token (logout)
   */
  async revokeRefreshToken(token: string): Promise<void> {
    try {
      const token_hash = CryptoUtils.hashDeterministic(token);

      const result = await RefreshToken.findOneAndUpdate(
        { token_hash, is_revoked: false },
        { is_revoked: true, revoked_at: new Date(), revoke_reason: 'logout' }
      );

      if (result) {
        logger.info('Refresh token revoked successfully');
      } else {
        logger.warn('Token already revoked or not found');
      }
    } catch (error: any) {
      logger.error('Error revoking refresh token:', error);
      throw new Error('TOKEN_REVOCATION_FAILED');
    }
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllUserTokens(user_id: string, reason: 'logout' | 'password_change' | 'security_concern' | 'admin_action' = 'logout'): Promise<void> {
    try {
      const result = await RefreshToken.updateMany(
        { user_id, is_revoked: false },
        { is_revoked: true, revoked_at: new Date(), revoke_reason: reason }
      );

      logger.info('All user tokens revoked', {
        user_id,
        count: result.modifiedCount
      });
    } catch (error: any) {
      logger.error('Error revoking all user tokens:', error);
      throw new Error('TOKEN_BULK_REVOCATION_FAILED');
    }
  }

  // ============================================
  // SESSION MANAGEMENT
  // ============================================

  /**
   * Get active sessions for user
   */
  async getActiveSessions(user_id: string): Promise<any[]> {
    try {
      return await RefreshToken.find({
        user_id,
        is_revoked: false,
        expires_at: { $gt: new Date() }
      }).select('device_info created_at expires_at last_used_at use_count');
    } catch (error: any) {
      logger.error('Error getting active sessions:', error);
      throw new Error('SESSIONS_FETCH_FAILED');
    }
  }

  /**
   * Revoke specific session by token ID
   */
  async revokeSession(user_id: string, session_id: string): Promise<boolean> {
    try {
      const result = await RefreshToken.findOneAndUpdate(
        { _id: session_id, user_id, is_revoked: false },
        { is_revoked: true, revoked_at: new Date(), revoke_reason: 'logout' }
      );

      return !!result;
    } catch (error: any) {
      logger.error('Error revoking session:', error);
      throw new Error('SESSION_REVOCATION_FAILED');
    }
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Parse JWT expiry string to seconds
   */
  private parseJWTExpiry(expiry: string): number {
    const units: { [key: string]: number } = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400
    };

    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 86400;
    }

    const value = parseInt(match[1]);
    const unit = match[2];
    return value * (units[unit] || 86400);
  }

  /**
   * Map JWT errors to user-friendly messages
   */
  private mapJWTError(error: any): string {
    if (error.name === 'TokenExpiredError') return 'TOKEN_EXPIRED';
    if (error.name === 'JsonWebTokenError') return 'INVALID_TOKEN';
    if (error.name === 'NotBeforeError') return 'TOKEN_NOT_ACTIVE';
    return 'TOKEN_VERIFICATION_FAILED';
  }
}

export const tokenService = new TokenService();