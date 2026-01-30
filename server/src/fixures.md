# Auth Service Refactoring Checklist

This document tracks improvements to consolidate shared functionality, eliminate duplicates, and standardize patterns across the auth service.




### 8. `auth.audit.service.ts`

- [ ] ✅ Already well structured
- [ ] Consider adding more event types to match `AUTH_ERROR_CODES`






### 17. `auth.validation.middleware.ts`

- [ ] **Use `AUTH_ERROR_CODES.VALIDATION_ERROR`** → Instead of hardcoded string

---

### 18. `auth.error.middleware.ts`

- [ ] **Use `AUTH_ERROR_CODES`** → Map error names to codes
- [ ] **Import `getStatusForError`** → Use for status code mapping

---

### 19. `auth.internal.middleware.ts`

- [ ] **Use `AUTH_ERROR_CODES`** → Replace hardcoded strings

---

## 📦 NEW CONSTANTS TO ADD TO `error-codes.ts`

```typescript
// 2FA specific
TWO_FA_NOT_INITIATED: '2FA_NOT_INITIATED',
TWO_FA_VERIFICATION_FAILED: '2FA_VERIFICATION_FAILED',
INVALID_BACKUP_CODE: 'INVALID_BACKUP_CODE',
NO_BACKUP_CODES: 'NO_BACKUP_CODES',

// Token
TOKEN_GENERATION_FAILED: 'TOKEN_GENERATION_FAILED',
TOKEN_BULK_REVOCATION_FAILED: 'TOKEN_BULK_REVOCATION_FAILED',

// Session
SESSION_CREATION_FAILED: 'SESSION_CREATION_FAILED',
SESSION_REFRESH_FAILED: 'SESSION_REFRESH_FAILED',
SESSION_INFO_FETCH_FAILED: 'SESSION_INFO_FETCH_FAILED',

// Admin
USER_NOT_BANNED: 'USER_NOT_BANNED',
CANNOT_DEACTIVATE_ADMIN: 'CANNOT_DEACTIVATE_ADMIN',
CANNOT_CHANGE_ADMIN_ROLE: 'CANNOT_CHANGE_ADMIN_ROLE',
USER_ALREADY_ACTIVE: 'USER_ALREADY_ACTIVE',
USER_NOT_ORGANIZER: 'USER_NOT_ORGANIZER',
ACCOUNT_NOT_LOCKED: 'ACCOUNT_NOT_LOCKED',
ADMIN_ALREADY_EXISTS: 'ADMIN_ALREADY_EXISTS',
ADMIN_PASSWORD_TOO_WEAK: 'ADMIN_PASSWORD_TOO_WEAK',

// Crypto/Password
HASHING_FAILED: 'HASHING_FAILED',
HASH_COMPARISON_FAILED: 'HASH_COMPARISON_FAILED',

// OTP
OTP_INVALIDATION_FAILED: 'OTP_INVALIDATION_FAILED',
OTP_BULK_INVALIDATION_FAILED: 'OTP_BULK_INVALIDATION_FAILED',
OTP_CLEANUP_FAILED: 'OTP_CLEANUP_FAILED',
OTP_STATS_FETCH_FAILED: 'OTP_STATS_FETCH_FAILED',

// Audit
AUDIT_CLEANUP_FAILED: 'AUDIT_CLEANUP_FAILED',
AUDIT_SEARCH_FAILED: 'AUDIT_SEARCH_FAILED',
AUDIT_TRAIL_FETCH_FAILED: 'AUDIT_TRAIL_FETCH_FAILED',
```

---

## 📄 NEW SHARED TYPES TO ADD

### Add to `shared/types/auth.types.ts` (NEW FILE)

```typescript
// Common interfaces used across auth services
export interface LoginResult {
  success: boolean;
  user?: any;
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
  user?: any;
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_code?: string;
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
```

---

## 🔄 EXECUTION ORDER

1. **Phase 1: Shared Infrastructure** (do first)
   - [x] Update `error-codes.ts` with new constants ✅
   - [x] Create `auth.types.ts` in shared/types ✅
   - [x] Update `shared/types/index.ts` to export new types ✅

2. **Phase 2: Services** (do second)
   - [ ] `auth.user.service.ts`
   - [ ] `auth.2fa.service.ts`
   - [ ] `auth.token.service.ts`
   - [ ] `auth.session.service.ts`
   - [ ] `auth.otp.service.ts`
   - [ ] `auth.password.service.ts`
   - [ ] `auth.admin.service.ts`

3. **Phase 3: Middlewares** (do third)
   - [ ] `auth.jwt.middleware.ts`
   - [ ] `auth.admin.middleware.ts`
   - [ ] `auth.ratelimit.middleware.ts`
   - [ ] `auth.validation.middleware.ts`
   - [ ] `auth.error.middleware.ts`
   - [ ] `auth.internal.middleware.ts`

4. **Phase 4: Controllers** (do last)
   - [ ] `auth.login.controller.ts`
   - [ ] `auth.otp.controller.ts`
   - [ ] `auth.admin.controller.ts`
   - [ ] `auth.password.controller.ts`
   - [ ] `auth.register.controller.ts`

---

## ✅ COMPLETED

### Phase 1: Shared Infrastructure
- [x] Added 50+ new error codes to `error-codes.ts`
- [x] Added `ERROR_MESSAGES` map for user-friendly messages
- [x] Added `getMessageForError()` helper function
- [x] Created `auth.types.ts` with all shared interfaces
- [x] Updated `shared/types/index.ts` to export auth types

### Phase 2: Services (In Progress)
- [x] `auth.user.service.ts` - Refactored ✅
- [x] `auth.2fa.service.ts` - Refactored ✅

---

## 📝 NOTES

- Keep backward compatibility where possible
- Test each file after changes
- Update imports across dependent files
- Run TypeScript compiler to catch import errors
