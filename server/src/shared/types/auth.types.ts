/**
 * Shared Auth Types
 * Common interfaces used across auth services and controllers
 */

import { IApexUser } from '../../models/user.model';

// ============================================
// LOGIN RESULT TYPES
// ============================================

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

export interface AdminLoginResult extends LoginResult {
  is_admin: boolean;
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
// CREDENTIAL TYPES
// ============================================

export interface LoginCredentials {
  email: string;
  password: string;
  ip_address: string;
  user_agent: string;
  device_fingerprint?: string;
}

export interface AdminLoginCredentials extends LoginCredentials {
  admin_secret?: string;
}

// ============================================
// PROFILE TYPES
// ============================================

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

export interface CreateUserData {
  email: string;
  username: string;
  password: string;
  first_name: string;
  last_name: string;
  role?: 'player' | 'organizer';
}

// ============================================
// TOKEN TYPES
// ============================================

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenPayload {
  user_id: string;
  email: string;
  role: 'player' | 'organizer' | 'admin';
  type: 'access' | 'refresh';
}

export interface TokenVerificationResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

// ============================================
// SESSION TYPES
// ============================================

export interface SessionInfo {
  session_id: string;
  device_info: {
    user_agent: string;
    ip_address: string;
    device_type?: string;
    device_name?: string;
  };
  created_at: Date;
  expires_at: Date;
  last_used_at?: Date;
  use_count: number;
}

export interface SessionValidationResult {
  valid: boolean;
  user_id?: string;
  email?: string;
  role?: 'player' | 'organizer' | 'admin';
}

// ============================================
// 2FA TYPES
// ============================================

export interface TOTPSetupResult {
  secret: string;
  qr_code_url: string;
  qr_code_data_url: string;
  manual_entry_key: string;
  issuer: string;
  account_name: string;
}

export interface TOTPVerifyResult {
  valid: boolean;
  error?: string;
}

export interface BackupCodesResult {
  codes: string[];
  generated_at: Date;
}

export interface TwoFactorStatus {
  is_enabled: boolean;
  method: 'none' | 'sms' | 'email' | 'authenticator_app';
  enabled_at?: Date;
  has_backup_codes: boolean;
  backup_codes_count: number;
  recovery_email?: string;
  recovery_phone?: string;
}

// ============================================
// OTP TYPES
// ============================================

export type OTPType = 
  | 'email_verification' 
  | 'password_reset' 
  | 'phone_verification' 
  | '2fa_login' 
  | 'withdrawal_confirmation';

export interface OTPGenerateOptions {
  user_id: string;
  type: OTPType;
  metadata: {
    ip_address: string;
    user_agent: string;
    device_fingerprint?: string;
    request_reason?: string;
  };
}

export interface OTPVerifyOptions {
  user_id: string;
  otp: string;
  type: OTPType;
  metadata: {
    ip_address: string;
    user_agent: string;
  };
}

export interface OTPVerificationResult {
  valid: boolean;
  error?: string;
  otp_record?: any;
}

// ============================================
// ADMIN TYPES
// ============================================

export interface UserListFilters {
  role?: 'player' | 'organizer' | 'admin';
  is_active?: boolean;
  is_banned?: boolean;
  email_verified?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface AdminActionResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface BanUserParams {
  user_id: string;
  reason: string;
  banned_until?: Date;
  admin_id: string;
  device_context: {
    ip_address: string;
    user_agent: string;
  };
}

// ============================================
// AUDIT TYPES
// ============================================

export interface AuditEventParams {
  user_id?: string;
  event_type: string;
  success: boolean;
  identifier?: string;
  metadata: {
    ip_address: string;
    user_agent: string;
    device_fingerprint?: string;
    location?: {
      country?: string;
      city?: string;
      region?: string;
    };
    failure_reason?: string;
    error_code?: string;
    session_id?: string;
    request_id?: string;
    is_suspicious?: boolean;
    risk_score?: number;
    risk_factors?: string[];
    admin_id?: string;
    admin_reason?: string;
    [key: string]: any;
  };
}

export interface AuditSearchFilters {
  user_id?: string;
  event_type?: string;
  success?: boolean;
  start_date?: Date;
  end_date?: Date;
  ip_address?: string;
  is_suspicious?: boolean;
  limit?: number;
}

// ============================================
// PASSWORD TYPES
// ============================================

export interface PasswordValidationResult {
  is_valid: boolean;
  errors: string[];
  strength_score?: number;
}

export interface PasswordChangeResult {
  success: boolean;
  message: string;
}
