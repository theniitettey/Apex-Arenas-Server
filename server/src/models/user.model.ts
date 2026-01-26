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

export interface IApexUserSecurity extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId; // unique reference to user
  
  lockout: {
    is_locked: boolean;
    locked_at?: Date;
    locked_until?: Date;
    lock_reason?: 'failed_attempts' | 'suspicious_activity' | 'admin_action' | 'user_request';
    failed_login_attempts: number;
    last_failed_attempt_at?: Date;
    failed_attempts_reset_at?: Date; // when counter resets
  };
  
  two_factor: {
    is_enabled: boolean;
    method: 'none' | 'sms' | 'email' | 'authenticator_app';
    enabled_at?: Date;
    setup_required: boolean; // force setup on next login
    
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
  

  active_sessions_count: number;
  max_allowed_sessions: number; // default: 5
  last_session_created_at?: Date;
  
  password: {
    last_changed_at?: Date;
    change_required: boolean; // force password change on next login
    change_required_reason?: string;
    previous_hashes?: string[]; // prevent password reuse (store last 5)
    strength_score?: number; // 0-100
  };
  

  security_questions?: {
    question: string;
    answer_hash: string;
    created_at: Date;
  }[];
  
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
  
  security_notifications: {
    login_from_new_device: boolean;
    login_from_new_location: boolean;
    password_changed: boolean;
    email_changed: boolean;
    failed_login_attempts: boolean;
    account_locked: boolean;
    withdrawal_requested: boolean;
  };
  

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


const ApexUserSchema = new Schema<IApexUser>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  username: { type: String, required: true, unique: true, trim: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['player', 'organizer', 'admin'], default: 'player' },
  
  profile: {
    first_name: { type: String, default: '' },
    last_name: { type: String, default: '' },
    avatar_url: { type: String, default: '' },
    bio: { type: String, maxlength: 500 },
    country: { type: String, default: 'GH' },
    date_of_birth: { type: Date },
    phone_number: { type: String },
    social_links: {
      discord: { type: String },
      twitter: { type: String },
      twitch: { type: String },
      youtube: { type: String }
    }
  },
  
  game_profiles: [{
    game_id: { type: Schema.Types.ObjectId, ref: 'Game', required: true },
    in_game_id: { type: String, required: true },
    skill_level: { type: String, enum: ['beginner', 'intermediate', 'advanced', 'pro'], default: 'beginner' },
    rank: { type: String },
    verified: { type: Boolean, default: false },
    verified_at: { type: Date }
  }],
  
  wallet: {
    available_balance: { type: Number, default: 0 },
    pending_balance: { type: Number, default: 0 },
    total_balance: { type: Number, default: 0 },
    currency: { type: String, default: 'GHS' },
    escrow_locked: { type: Number, default: 0 },
    last_transaction_at: { type: Date }
  },
  
  momo_account: {
    phone_number: { type: String },
    network: { type: String, enum: ['MTN', 'Vodafone', 'AirtelTigo'] },
    account_name: { type: String },
    is_verified: { type: Boolean, default: false },
    verified_at: { type: Date },
    is_primary: { type: Boolean, default: true }
  },
  
  stats: {
    tournaments_played: { type: Number, default: 0 },
    tournaments_won: { type: Number, default: 0 },
    total_earnings: { type: Number, default: 0 },
    win_rate: { type: Number, default: 0 },
    current_streak: { type: Number, default: 0 },
    best_streak: { type: Number, default: 0 }
  },
  
  verification_status: {
    email_verified: { type: Boolean, default: false },
    phone_verified: { type: Boolean, default: false },
    identity_verified: { type: Boolean, default: false },
    organizer_verified: { type: Boolean, default: false },
    verified_at: { type: Date }
  },
  
  last_login: { type: Date },
  last_active_at: { type: Date },
  is_active: { type: Boolean, default: true },
  is_banned: { type: Boolean, default: false },
  banned_reason: { type: String },
  banned_until: { type: Date },
  banned_by: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// User Indexes
ApexUserSchema.index({ email: 1 }, { unique: true });
ApexUserSchema.index({ username: 1 }, { unique: true });
ApexUserSchema.index({ role: 1 });
ApexUserSchema.index({ created_at: -1 });
ApexUserSchema.index({ 'game_profiles.game_id': 1 });
ApexUserSchema.index({ 'game_profiles.in_game_id': 1 });
ApexUserSchema.index({ is_banned: 1 });
ApexUserSchema.index({ is_active: 1 });


const ApexOTPSchema = new Schema<IApexOTP>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['email_verification', 'password_reset', 'phone_verification', '2fa_login', 'withdrawal_confirmation'],
    required: true 
  },
  hashed_otp: { type: String, required: true },
  expires_at: { type: Date, required: true },
  used: { type: Boolean, default: false },
  used_at: { type: Date },
  attempts: { type: Number, default: 0 },
  max_attempts: { type: Number, default: 3 },
  locked_until: { type: Date },
  metadata: {
    ip_address: { type: String, required: true },
    user_agent: { type: String, required: true },
    device_fingerprint: { type: String },
    request_reason: { type: String }
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// OTP Indexes
ApexOTPSchema.index({ user_id: 1 });
ApexOTPSchema.index({ type: 1 });
ApexOTPSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL index
ApexOTPSchema.index({ user_id: 1, type: 1, used: 1 });


const ApexRefreshTokenSchema = new Schema<IApexRefreshToken>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  token_hash: { type: String, required: true, unique: true },
  family_id: { type: String, required: true },
  generation: { type: Number, default: 0 },
  expires_at: { type: Date, required: true },
  is_revoked: { type: Boolean, default: false },
  revoked_at: { type: Date },
  revoked_by: { type: Schema.Types.ObjectId, ref: 'User' },
  revoke_reason: { 
    type: String, 
    enum: ['logout', 'password_change', 'security_concern', 'admin_action', 'token_rotation', 'session_expired'] 
  },
  device_info: {
    user_agent: { type: String, required: true },
    ip_address: { type: String, required: true },
    device_type: { type: String, enum: ['mobile', 'tablet', 'desktop', 'unknown'], default: 'unknown' },
    device_name: { type: String },
    location: {
      country: { type: String },
      city: { type: String },
      coordinates: {
        lat: { type: Number },
        lng: { type: Number }
      }
    }
  },
  last_used_at: { type: Date },
  last_used_ip: { type: String },
  use_count: { type: Number, default: 0 }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// RefreshToken Indexes
ApexRefreshTokenSchema.index({ token_hash: 1 }, { unique: true });
ApexRefreshTokenSchema.index({ user_id: 1 });
ApexRefreshTokenSchema.index({ family_id: 1 });
ApexRefreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL index
ApexRefreshTokenSchema.index({ is_revoked: 1 });
ApexRefreshTokenSchema.index({ user_id: 1, is_revoked: 1 });


const ApexAuthLogSchema = new Schema<IApexAuthLog>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User' },
  event_type: { 
    type: String, 
    enum: [
      'login_success', 'login_failed', 'logout', 'logout_all_devices',
      'registration_started', 'registration_completed', 'registration_failed',
      'password_change_success', 'password_change_failed', 'password_reset_requested', 
      'password_reset_completed', 'password_reset_failed',
      'otp_requested', 'otp_verified', 'otp_failed', 'otp_expired', 'otp_max_attempts',
      'token_refreshed', 'token_revoked', 'token_reuse_detected',
      'account_locked', 'account_unlocked', 'account_deactivated', 'account_reactivated',
      'email_changed', 'phone_changed',
      '2fa_enabled', '2fa_disabled', '2fa_verified', '2fa_failed',
      'suspicious_activity', 'new_device_login', 'new_location_login', 'brute_force_detected',
      'admin_impersonation_start', 'admin_impersonation_end'
    ],
    required: true 
  },
  success: { type: Boolean, required: true },
  identifier: { type: String },
  metadata: {
    ip_address: { type: String, required: true },
    user_agent: { type: String, required: true },
    device_fingerprint: { type: String },
    location: {
      country: { type: String },
      city: { type: String },
      region: { type: String }
    },
    failure_reason: { type: String },
    error_code: { type: String },
    session_id: { type: String },
    request_id: { type: String },
    is_suspicious: { type: Boolean, default: false },
    risk_score: { type: Number, min: 0, max: 100 },
    risk_factors: [{ type: String }],
    admin_id: { type: Schema.Types.ObjectId, ref: 'User' },
    admin_reason: { type: String }
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// AuthLog Indexes
ApexAuthLogSchema.index({ user_id: 1 });
ApexAuthLogSchema.index({ event_type: 1 });
ApexAuthLogSchema.index({ created_at: -1 });
ApexAuthLogSchema.index({ 'metadata.ip_address': 1 });
ApexAuthLogSchema.index({ 'metadata.is_suspicious': 1 });
ApexAuthLogSchema.index({ user_id: 1, event_type: 1, created_at: -1 });
ApexAuthLogSchema.index({ user_id: 1, success: 1, created_at: -1 });


const ApexUserSecuritySchema = new Schema<IApexUserSecurity>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  
  lockout: {
    is_locked: { type: Boolean, default: false },
    locked_at: { type: Date },
    locked_until: { type: Date },
    lock_reason: { type: String, enum: ['failed_attempts', 'suspicious_activity', 'admin_action', 'user_request'] },
    failed_login_attempts: { type: Number, default: 0 },
    last_failed_attempt_at: { type: Date },
    failed_attempts_reset_at: { type: Date }
  },
  
  two_factor: {
    is_enabled: { type: Boolean, default: false },
    method: { type: String, enum: ['none', 'sms', 'email', 'authenticator_app'], default: 'none' },
    enabled_at: { type: Date },
    setup_required: { type: Boolean, default: false },
    totp_secret: { type: String },
    totp_verified: { type: Boolean, default: false },
    backup_codes: [{
      code_hash: { type: String },
      used: { type: Boolean, default: false },
      used_at: { type: Date }
    }],
    backup_codes_generated_at: { type: Date },
    recovery_email: { type: String },
    recovery_phone: { type: String }
  },
  
  trusted_devices: [{
    device_id: { type: String, required: true },
    device_name: { type: String, required: true },
    device_type: { type: String, enum: ['mobile', 'tablet', 'desktop', 'unknown'], default: 'unknown' },
    browser: { type: String },
    os: { type: String },
    trusted_at: { type: Date, default: Date.now },
    last_used_at: { type: Date },
    last_ip: { type: String },
    last_location: { type: String },
    is_current: { type: Boolean, default: false },
    trust_expires_at: { type: Date }
  }],
  
  active_sessions_count: { type: Number, default: 0 },
  max_allowed_sessions: { type: Number, default: 5 },
  last_session_created_at: { type: Date },
  
  password: {
    last_changed_at: { type: Date },
    change_required: { type: Boolean, default: false },
    change_required_reason: { type: String },
    previous_hashes: [{ type: String }],
    strength_score: { type: Number, min: 0, max: 100 }
  },
  
  security_questions: [{
    question: { type: String },
    answer_hash: { type: String },
    created_at: { type: Date, default: Date.now }
  }],
  
  risk: {
    current_risk_level: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
    risk_score: { type: Number, default: 0, min: 0, max: 100 },
    last_assessed_at: { type: Date, default: Date.now },
    risk_factors: [{
      factor: { type: String },
      severity: { type: String, enum: ['low', 'medium', 'high'] },
      detected_at: { type: Date },
      resolved: { type: Boolean, default: false },
      resolved_at: { type: Date }
    }]
  },
  
  activity_summary: {
    total_logins: { type: Number, default: 0 },
    logins_last_30_days: { type: Number, default: 0 },
    failed_logins_last_30_days: { type: Number, default: 0 },
    unique_ips_last_30_days: { type: Number, default: 0 },
    unique_devices_last_30_days: { type: Number, default: 0 },
    last_login_at: { type: Date },
    last_login_ip: { type: String },
    last_login_location: { type: String },
    last_login_device: { type: String },
    last_password_reset_at: { type: Date },
    last_email_change_at: { type: Date }
  },
  
  security_notifications: {
    login_from_new_device: { type: Boolean, default: true },
    login_from_new_location: { type: Boolean, default: true },
    password_changed: { type: Boolean, default: true },
    email_changed: { type: Boolean, default: true },
    failed_login_attempts: { type: Boolean, default: true },
    account_locked: { type: Boolean, default: true },
    withdrawal_requested: { type: Boolean, default: true }
  },
  
  withdrawal_security: {
    require_2fa: { type: Boolean, default: false },
    require_otp: { type: Boolean, default: true },
    daily_limit: { type: Number },
    cooling_period_hours: { type: Number, default: 24 },
    last_momo_change_at: { type: Date }
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// UserSecurity Indexes
ApexUserSecuritySchema.index({ user_id: 1 }, { unique: true });
ApexUserSecuritySchema.index({ 'lockout.is_locked': 1 });
ApexUserSecuritySchema.index({ 'two_factor.is_enabled': 1 });
ApexUserSecuritySchema.index({ 'risk.current_risk_level': 1 });
ApexUserSecuritySchema.index({ 'trusted_devices.device_id': 1 });


export const User = mongoose.model<IApexUser>('ApexUser', ApexUserSchema);
export const OTP = mongoose.model<IApexOTP>('ApexOTP', ApexOTPSchema);
export const RefreshToken = mongoose.model<IApexRefreshToken>('ApexRefreshToken', ApexRefreshTokenSchema);
export const AuthLog = mongoose.model<IApexAuthLog>('ApexAuthLog', ApexAuthLogSchema);
export const UserSecurity = mongoose.model<IApexUserSecurity>('ApexUserSecurity', ApexUserSecuritySchema);