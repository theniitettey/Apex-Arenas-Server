import mongoose, {Document, Schema, Model} from 'mongoose';

export interface IApexUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string; // unique, required
  username: string; // unique, required
  password_hash: string; // hashed password
  role: string; // enum: ['player', 'organizer', 'admin']
  profile: {
    first_name: string;
    last_name: string;
    avatar_url: string;
    bio?: string; // short user bio
    country: string;
    date_of_birth: Date;
    phone_number: string;
    social_links?: {
      discord?: string;
      twitter?: string;
      twitch?: string;
      youtube?: string;
    };
  };
  
  game_profiles: [
    {
      game_id: mongoose.Types.ObjectId; // reference to games collection
      in_game_id: string; // standardized name for in-game identifier
      skill_level: string; // enum: ['beginner', 'intermediate', 'advanced', 'pro']
      rank: string;
      verified: boolean; // has this in-game ID been verified?
      verified_at?: Date;
    }
  ];
  
  wallet: {
    available_balance: number; // funds available for withdrawal (store as pesewas/integers)
    pending_balance: number; // winnings pending admin approval
    total_balance: number; // available + pending
    currency: string; // default: 'GHS' (Ghana Cedis)
    escrow_locked: number; // funds locked in active tournaments (entry fees)
    last_transaction_at?: Date;
  };
  
  momo_account: {
    phone_number: string; // Mobile Money number for payouts
    network: string; // enum: ['MTN', 'Vodafone', 'AirtelTigo']
    account_name: string; // Name registered on MoMo
    is_verified: boolean;
    verified_at: Date;
    is_primary: boolean; // primary payout account
  };
  
  stats: {
    tournaments_played: number;
    tournaments_won: number;
    total_earnings: number;
    win_rate: number;
    current_streak: number; // win streak
    best_streak: number;
  };
  
  verification_status: {
    email_verified: boolean;
    phone_verified: boolean;
    identity_verified: boolean;
    organizer_verified: boolean; // verified organizers can create paid tournaments
    verified_at: Date;
  };
  created_at: Date;
  updated_at: Date;
  last_login: Date;
  last_active_at: Date; // for online status tracking
  is_active: boolean;
  is_banned: boolean;
  banned_reason: string;
  banned_until: Date;
  banned_by?: mongoose.Types.ObjectId; // admin who banned
}

// ============================================================================
// OTP MANAGEMENT
// ============================================================================
export interface IApexOTP extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  
  type: 'email_verification' | 'password_reset' | 'phone_verification' | '2fa_login' | 'withdrawal_confirmation';
  
  hashed_otp: string;
  expires_at: Date;
  
  // Usage tracking
  used: boolean;
  used_at?: Date;
  
  // Failed attempt tracking
  attempts: number;
  max_attempts: number; // default: 3
  locked_until?: Date; // lock OTP after max attempts
  
  // Request context
  metadata: {
    ip_address: string;
    user_agent: string;
    device_fingerprint?: string;
    request_reason?: string; // e.g., "user requested", "system triggered"
  };
  
  created_at: Date;
}

/**
 * Indexes:
 * - user_id
 * - type
 * - expires_at (TTL index - auto delete expired OTPs)
 * - Compound: user_id + type + used (find active OTP)
 */

// ============================================================================
// REFRESH TOKEN MANAGEMENT
// ============================================================================
export interface IApexRefreshToken extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  
  token_hash: string; // hashed refresh token
  
  // Token family for rotation (detect token reuse attacks)
  family_id: string; // UUID - all tokens from same login share this
  generation: number; // increments on each rotation, detect reuse
  
  expires_at: Date;
  
  // Revocation
  is_revoked: boolean;
  revoked_at?: Date;
  revoked_by?: mongoose.Types.ObjectId; // user or admin
  revoke_reason?: 'logout' | 'password_change' | 'security_concern' | 'admin_action' | 'token_rotation' | 'session_expired';
  
  // Device tracking
  device_info: {
    user_agent: string;
    ip_address: string;
    device_type?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
    device_name?: string; // e.g., "Chrome on Windows"
    location?: {
      country?: string;
      city?: string;
      coordinates?: {
        lat: number;
        lng: number;
      };
    };
  };
  
  // Usage tracking
  last_used_at?: Date;
  last_used_ip?: string;
  use_count: number;
  
  created_at: Date;
}

/**
 * Indexes:
 * - token_hash (unique)
 * - user_id
 * - family_id
 * - expires_at (TTL index)
 * - is_revoked
 * - Compound: user_id + is_revoked (find active sessions)
 */

// ============================================================================
// AUTHENTICATION LOGS
// ============================================================================
export interface IApexAuthLog extends Document {
  _id: mongoose.Types.ObjectId;
  user_id?: mongoose.Types.ObjectId; // null for failed registration attempts
  
  event_type: 
    // Authentication events
    | 'login_success'
    | 'login_failed'
    | 'logout'
    | 'logout_all_devices'
    // Registration events
    | 'registration_started'
    | 'registration_completed'
    | 'registration_failed'
    // Password events
    | 'password_change_success'
    | 'password_change_failed'
    | 'password_reset_requested'
    | 'password_reset_completed'
    | 'password_reset_failed'
    // OTP events
    | 'otp_requested'
    | 'otp_verified'
    | 'otp_failed'
    | 'otp_expired'
    | 'otp_max_attempts'
    // Token events
    | 'token_refreshed'
    | 'token_revoked'
    | 'token_reuse_detected'
    // Account events
    | 'account_locked'
    | 'account_unlocked'
    | 'account_deactivated'
    | 'account_reactivated'
    | 'email_changed'
    | 'phone_changed'
    // 2FA events
    | '2fa_enabled'
    | '2fa_disabled'
    | '2fa_verified'
    | '2fa_failed'
    // Security events
    | 'suspicious_activity'
    | 'new_device_login'
    | 'new_location_login'
    | 'brute_force_detected'
    | 'admin_impersonation_start'
    | 'admin_impersonation_end';
  
  success: boolean;
  
  // Identifier for failed attempts (email/username entered)
  identifier?: string; // for failed logins where user_id is unknown
  
  metadata: {
    ip_address: string;
    user_agent: string;
    device_fingerprint?: string;
    
    // Location
    location?: {
      country?: string;
      city?: string;
      region?: string;
    };
    
    // Failure details
    failure_reason?: string;
    error_code?: string;
    
    // Additional context
    session_id?: string;
    request_id?: string;
    
    // Security flags
    is_suspicious: boolean;
    risk_score?: number; // 0-100
    risk_factors?: string[]; // e.g., ['new_device', 'unusual_time', 'foreign_ip']
    
    // Admin actions
    admin_id?: mongoose.Types.ObjectId; // if action performed by admin
    admin_reason?: string;
  };
  
  created_at: Date;
}

/**
 * Indexes:
 * - user_id
 * - event_type
 * - created_at
 * - metadata.ip_address
 * - metadata.is_suspicious
 * - Compound: user_id + event_type + created_at
 * - Compound: user_id + success + created_at (for failed attempt tracking)
 */

// ============================================================================
// USER SECURITY PROFILE (Aggregated Security State)
// ============================================================================
export interface IApexUserSecurity extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId; // unique reference to user
  
  // -------------------------------------------------------------------------
  // ACCOUNT LOCKOUT
  // -------------------------------------------------------------------------
  lockout: {
    is_locked: boolean;
    locked_at?: Date;
    locked_until?: Date;
    lock_reason?: 'failed_attempts' | 'suspicious_activity' | 'admin_action' | 'user_request';
    failed_login_attempts: number;
    last_failed_attempt_at?: Date;
    failed_attempts_reset_at?: Date; // when counter resets
  };
  
  // -------------------------------------------------------------------------
  // TWO-FACTOR AUTHENTICATION
  // -------------------------------------------------------------------------
  two_factor: {
    is_enabled: boolean;
    method: 'none' | 'sms' | 'email' | 'authenticator_app';
    enabled_at?: Date;
    
    // For authenticator app
    totp_secret?: string; // encrypted
    totp_verified: boolean;
    
    // Backup codes
    backup_codes?: {
      code_hash: string;
      used: boolean;
      used_at?: Date;
    }[];
    backup_codes_generated_at?: Date;
    
    // Recovery
    recovery_email?: string;
    recovery_phone?: string;
  };
  
  // -------------------------------------------------------------------------
  // TRUSTED DEVICES
  // -------------------------------------------------------------------------
  trusted_devices: {
    device_id: string; // generated fingerprint
    device_name: string; // user-friendly name
    device_type: 'mobile' | 'tablet' | 'desktop' | 'unknown';
    browser?: string;
    os?: string;
    
    trusted_at: Date;
    last_used_at: Date;
    last_ip: string;
    last_location?: string;
    
    is_current: boolean; // currently active device
    trust_expires_at?: Date; // optional expiry
  }[];
  
  // -------------------------------------------------------------------------
  // ACTIVE SESSIONS
  // -------------------------------------------------------------------------
  active_sessions_count: number;
  max_allowed_sessions: number; // default: 5
  last_session_created_at?: Date;
  
  // -------------------------------------------------------------------------
  // PASSWORD SECURITY
  // -------------------------------------------------------------------------
  password: {
    last_changed_at?: Date;
    change_required: boolean; // force password change on next login
    change_required_reason?: string;
    previous_hashes?: string[]; // prevent password reuse (store last 5)
    strength_score?: number; // 0-100
  };
  
  // -------------------------------------------------------------------------
  // SECURITY QUESTIONS (Optional)
  // -------------------------------------------------------------------------
  security_questions?: {
    question: string;
    answer_hash: string;
    created_at: Date;
  }[];
  
  // -------------------------------------------------------------------------
  // RISK ASSESSMENT
  // -------------------------------------------------------------------------
  risk: {
    current_risk_level: 'low' | 'medium' | 'high' | 'critical';
    risk_score: number; // 0-100
    last_assessed_at: Date;
    
    risk_factors: {
      factor: string; // e.g., 'weak_password', 'no_2fa', 'suspicious_logins'
      severity: 'low' | 'medium' | 'high';
      detected_at: Date;
      resolved: boolean;
      resolved_at?: Date;
    }[];
  };
  
  // -------------------------------------------------------------------------
  // RECENT ACTIVITY SUMMARY
  // -------------------------------------------------------------------------
  activity_summary: {
    total_logins: number;
    logins_last_30_days: number;
    failed_logins_last_30_days: number;
    unique_ips_last_30_days: number;
    unique_devices_last_30_days: number;
    
    last_login_at?: Date;
    last_login_ip?: string;
    last_login_location?: string;
    last_login_device?: string;
    
    last_password_reset_at?: Date;
    last_email_change_at?: Date;
  };
  
  // -------------------------------------------------------------------------
  // NOTIFICATION PREFERENCES (Security-related)
  // -------------------------------------------------------------------------
  security_notifications: {
    login_from_new_device: boolean;
    login_from_new_location: boolean;
    password_changed: boolean;
    email_changed: boolean;
    failed_login_attempts: boolean;
    account_locked: boolean;
    withdrawal_requested: boolean;
  };
  
  // -------------------------------------------------------------------------
  // WITHDRAWAL SECURITY
  // -------------------------------------------------------------------------
  withdrawal_security: {
    require_2fa: boolean;
    require_otp: boolean;
    daily_limit?: number; // in pesewas
    cooling_period_hours: number; // wait time after adding new momo account
    last_momo_change_at?: Date;
  };
  
  created_at: Date;
  updated_at: Date;
}

/**
 * Indexes:
 * - user_id (unique)
 * - lockout.is_locked
 * - two_factor.is_enabled
 * - risk.current_risk_level
 * - trusted_devices.device_id
 */

// ============================================================================
// RATE LIMIT TRACKING (For Redis, but interface for reference)
// ============================================================================
export interface IApexRateLimit {
  key: string; // e.g., 'login:user_id', 'otp:email', 'api:ip'
  identifier: string; // user_id, email, IP address
  action: 'login' | 'otp_request' | 'password_reset' | 'registration' | 'api_call' | 'withdrawal';
  
  count: number;
  window_start: Date;
  window_duration_seconds: number;
  max_allowed: number;
  
  is_blocked: boolean;
  blocked_until?: Date;
  
  // For sliding window
  timestamps?: Date[];
}

// Note: IApexRateLimit is typically stored in Redis, not MongoDB
// This interface is for reference/typing purposes

// Indexes
// email (unique)
// username (unique)
// role
// created_at
// game_profiles.game_id
// game_profiles.in_game_id
// auth.refresh_token
// auth.password_reset_token
// is_banned