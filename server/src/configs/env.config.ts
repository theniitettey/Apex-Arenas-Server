import dotenv from 'dotenv';
import {cleanEnv, str, num, bool} from 'envalid';
import { createLogger } from '../shared/utils/logger.utils';


const logger = createLogger('env-config');

dotenv.config();

export const env = cleanEnv(process.env, {
  //Server Configs
  NODE_ENV: str({choices: ['development', 'production', 'test'], default: 'development'}),
  PORT: num({default: 5000}),
  API_VERSION: str({default: 'v1'}),
  SERVICE_NAME: str({default: "APEX_API_SERVICE"}),
  SERVICE_VERSION: str({default: "1.0.0"}),

  // MongoDB Configs
  MONGODB_URI: str(),
  MONGODB_DB_NAME: str({ default: 'auth_service' }),
  MONGODB_POOL_SIZE: num({ default: 10 }),
  MONGODB_CONNECTION_TIMEOUT: num({ default: 30000 }),

  // Redis Configs
  REDIS_URL: str(),
  REDIS_HOST: str({ default: 'localhost' }),
  REDIS_PORT: num({ default: 6379 }),
  REDIS_PASSWORD: str({ default: '' }),
  REDIS_DB: num({ default: 0 }),
  REDIS_TTL_OTP: num({ default: 600 }), // 10m
  REDIS_TTL_SESSION: num({ default: 86400 }), // 24h
  REDIS_TLS: bool({ default: false }),
  IDEMPOTENCY_KEY_TTL: num({ default: 3600 }),
  LOCKOUT_WINDOW_MINUTES: num({ default: 900 }), 


  // JWT & Security Configs
  JWT_ACCESS_SECRET: str(),
  JWT_REFRESH_SECRET: str(),
  JWT_ADMIN_ACCESS_SECRET: str(),
  JWT_ADMIN_REFRESH_SECRET: str(),
  JWT_ACCESS_EXPIRES_IN: num({default: 900}),
  JWT_ADMIN_ACCESS_EXPIRES_IN: num({default: 600}),
  JWT_REFRESH_EXPIRES_IN: str({ default: '7d' }),
  JWT_ISSUER_USERS: str({ default: 'apex_service' }),
  JWT_ISSUER_ADMIN: str({ default: 'apex_admin_service' }),
  INTERNAL_SERVICE_SECRET: str(),
  BCRYPT_ROUNDS: num({ default: 12 }),
  ADMIN_SECRET_KEY: str(),
  ADMIN_EMAILS: str({ default: '' }), // Comma separated list of admin emails

  // CORS
  CORS_CREDENTIALS: bool({ default: true }),

  // HELMENT
  SECURITY_HSTS_MAX_AGE: num({ default: 31536000 }), // 1 year in seconds

  // Rate limiting
  RATE_LIMIT_WINDOW: num({ default: 900000 }), // 15m
  RATE_LIMIT_MAX_ATTEMPTS: num({ default: 100 }),
  OTP_RATE_LIMIT_MAX: num({ default: 5 }),
  OTP_COOLDOWN_SECONDS: num({ default: 60 }),

  // Logging.
  LOG_LEVEL: str({ choices: ['error', 'warn', 'info', 'debug'], default: 'info' }),
  LOG_FILE_PATH: str({ default: './logs/auth-service.log' }),

  // Health check
  HEALTH_CHECK_INTERVAL: num({ default: 30000 }), // 30s

  // App Info
  APP_NAME: str({ default: 'ApexArenas' }),

  // Encryption (for TOTP secrets)
  ENCRYPTION_KEY: str({ default: '' }),

  // OTP Configuration
  OTP_LENGTH: num({ default: 6 }),
  OTP_EXPIRY_MINUTES: num({ default: 10 }),
  OTP_MAX_ATTEMPTS: num({ default: 3 }),
  

  // Idempotency
  IDEMPOTENCY_TTL: num({ default: 3600 }),

  // Validation rules
  MIN_PASSWORD_LENGTH: num({ default: 8 }),
  MAX_PASSWORD_LENGTH: num({ default: 128 }),
  MIN_NAME_LENGTH: num({ default: 2 }),
  MAX_NAME_LENGTH: num({ default: 50 }),
});


// Custom Validation Logic (if needed)

(() => {
  if (env.JWT_ACCESS_SECRET.length < 32 || env.JWT_REFRESH_SECRET.length < 32) {
    logger.error('JWT secrets must be at least 32 characters long');
    process.exit(1);
  }

  if (!env.MONGODB_URI.startsWith('mongodb://') && !env.MONGODB_URI.startsWith('mongodb+srv://')) {
    logger.error('MONGODB_URI must start with "mongodb://" or "mongodb+srv://"');
    process.exit(1);
  }

  if (!env.REDIS_HOST) {
    logger.error('REDIS_HOST is required');
    process.exit(1);
  }

  logger.info('Environment variables validated successfully');

})();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

export const mongoOptions = {
  dbName: env.MONGODB_DB_NAME,
  maxPoolSize: env.MONGODB_POOL_SIZE,
  serverSelectionTimeoutMS: env.MONGODB_CONNECTION_TIMEOUT,
  socketTimeoutMS: 45000,
  family: 4,
};

export const redisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT, 
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
  tls: env.REDIS_TLS ? {} : undefined,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 3,
};

export const jwtOptions = {
  access: {
    secret: env.JWT_ACCESS_SECRET,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer_audience: env.JWT_ISSUER_USERS,
    issuer_admin: env.JWT_ISSUER_ADMIN,

  },
  refresh: {
    secret: env.JWT_REFRESH_SECRET,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer_audience: env.JWT_ISSUER_USERS,
    issuer_admin: env.JWT_ISSUER_ADMIN,
  },
};