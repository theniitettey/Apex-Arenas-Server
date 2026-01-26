import winston from 'winston';
import path from 'path';
import fs from 'fs'
import {env} from "../../configs/env.config"


// Custom log format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const { timestamp, level, message, service, requestId, userId, ...meta } = info;
    
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      service: service || env.SERVICE_NAME,
      message,
      ...(requestId ? { requestId } : {}),
      ...(userId ? { userId } : {}),
      ...(Object.keys(meta).length > 0 && { meta })
    };

    return JSON.stringify(logEntry);
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'HH:mm:ss.SSS'
  }),
  winston.format.colorize(),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, requestId, userId, ...meta } = info;
    
    let logMessage = `[${timestamp}] ${level}: ${message}`;
    
    if (requestId) logMessage += ` [ReqID: ${requestId}]`;
    if (userId) logMessage += ` [UserID: ${userId}]`;
    
    if (Object.keys(meta).length > 0) {
      logMessage += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return logMessage;
  })
);

// Create transports array
const transports: winston.transport[] = [];

// Console transport (always enabled in development)
if (env.isDevelopment) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: env.LOG_LEVEL
    })
  );
} else {
  // In production, use structured JSON logging to console
  transports.push(
    new winston.transports.Console({
      format: logFormat,
      level: env.LOG_LEVEL
    })
  );
}

// File transport for persistent logging
if (process.env.ENABLE_FILE_LOGGING === 'true') {
  // Ensure logs directory exists
  const logDir = path.dirname(env.LOG_FILE_PATH);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  transports.push(
    // Combined log file
    new winston.transports.File({
      filename: env.LOG_FILE_PATH,
      format: logFormat,
      level: env.LOG_LEVEL,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Error-only log file
    new winston.transports.File({
      filename: env.LOG_FILE_PATH.replace('.log', '.error.log'),
      format: logFormat,
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 3,
      tailable: true
    })
  );
}

// Create the logger instance
export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: logFormat,
  defaultMeta: {
    service: env.SERVICE_NAME,
    environment: env.NODE_ENV
  },
  transports,
  // Don't exit on error
  exitOnError: false,
  // Silence winston's own logs unless in debug mode
  silent: false
});

// Custom logging methods with context
export class Logger {
  private requestId?: string;
  private userId?: string;

  constructor(requestId?: string, userId?: string) {
    this.requestId = requestId;
    this.userId = userId;
  }

  private log(level: string, message: string, meta?: object) {
    const logData = {
      ...meta,
      ...(this.requestId && { requestId: this.requestId }),
      ...(this.userId && { userId: this.userId })
    };

    logger.log(level, message, logData);
  }

  error(message: string, meta?: object): void {
    this.log('error', message, meta);
  }

  warn(message: string, meta?: object): void {
    this.log('warn', message, meta);
  }

  info(message: string, meta?: object): void {
    this.log('info', message, meta);
  }

  debug(message: string, meta?: object): void {
    this.log('debug', message, meta);
  }

  // Audit logging for security events
  audit(action: string, details: {
    userId?: string;
    email?: string;
    ip?: string;
    userAgent?: string;
    success: boolean;
    reason?: string;
    [key: string]: any;
  }): void {
    this.log('info', `AUDIT: ${action}`, {
      audit: true,
      action,
      ...details
    });
  }

  // Performance logging
  performance(operation: string, duration: number, meta?: object): void {
    this.log('info', `PERFORMANCE: ${operation}`, {
      performance: true,
      operation,
      duration,
      ...meta
    });
  }

  // HTTP request logging
  httpRequest(req: {
    method: string;
    url: string;
    statusCode?: number;
    responseTime?: number;
    ip?: string;
    userAgent?: string;
  }): void {
    const { method, url, statusCode, responseTime, ip, userAgent } = req;
    
    this.log('info', `HTTP ${method} ${url}`, {
      http: true,
      method,
      url,
      statusCode,
      responseTime,
      ip,
      userAgent
    });
  }
} 

// Helper function to create contextual logger
export const createLogger = (requestId?: string, userId?: string): Logger => {
  return new Logger(requestId, userId);
};

// Helper function to extract request ID from request object
export const getRequestId = (req: any): string => {
  return req.headers['x-request-id'] || req.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Helper function to log API responses
export const logApiResponse = (req: any, res: any, responseData?: any) => {
  const requestId = getRequestId(req);
  const contextLogger = createLogger(requestId);
  
  const logData: any = {
    method: req.method,
    url: req.originalUrl || req.url,
    statusCode: res.statusCode,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers['user-agent']
  };

  // Add response time if available
  if (req.startTime) {
    logData.responseTime = Date.now() - req.startTime;
  }

  // Don't log sensitive response data
  if (responseData && !req.originalUrl?.includes('/login') && !req.originalUrl?.includes('/register')) {
    logData.responseSize = JSON.stringify(responseData).length;
  }

  contextLogger.httpRequest(logData);
};

// Helper function for database operations logging
export const logDatabaseOperation = (operation: string, collection: string, duration: number, error?: Error) => {
  if (error) {
    logger.error(`Database operation failed: ${operation}`, {
      database: true,
      operation,
      collection,
      duration,
      error: error.message,
      stack: error.stack
    });
  } else {
    logger.debug(`Database operation completed: ${operation}`, {
      database: true,
      operation,
      collection,
      duration
    });
  }
};

// Helper function for queue operations logging
export const logQueueOperation = (operation: string, queue: string, eventId?: string, error?: Error) => {
  if (error) {
    logger.error(`Queue operation failed: ${operation}`, {
      queue: true,
      operation,
      queueName: queue,
      eventId,
      error: error.message
    });
  } else {
    logger.info(`Queue operation completed: ${operation}`, {
      queue: true,
      operation,
      queueName: queue,
      eventId
    });
  }
};

// Startup logging
export const logStartup = (port: number, environment: string) => {
  logger.info('Auth service starting up', {
    startup: true,
    port,
    environment,
    nodeVersion: process.version,
    pid: process.pid
  });
};

// Shutdown logging
export const logShutdown = (reason: string) => {
  logger.info('Auth service shutting down', {
    shutdown: true,
    reason,
    uptime: process.uptime()
  });
};

// Error handling for uncaught exceptions
if (env.isProduction) {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
      fatal: true
    });
    
    // Give logger time to write before exiting
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      promise: promise.toString()
    });
  });
}