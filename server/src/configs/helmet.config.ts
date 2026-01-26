import helmet from 'helmet';
import { createLogger } from '../shared/utils/logger.utils';
import { env } from './env.config';

const logger = createLogger('helmet-config');


class SecurityHeadersManager {
  private static instance: SecurityHeadersManager;

  private constructor() {}

  public static getInstance(): SecurityHeadersManager {
    if (!SecurityHeadersManager.instance) {
      SecurityHeadersManager.instance = new SecurityHeadersManager();
    }
    return SecurityHeadersManager.instance;
  }

  public getSecurityConfig() {
    const isProduction = env.isProduction;
    
    // Base Helmet configuration
    const baseConfig = helmet({
      contentSecurityPolicy: {
        directives: this.getCSPDirectives(isProduction),
      },
      crossOriginEmbedderPolicy: isProduction,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      hsts: this.getHSTSConfig(isProduction),
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: true,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true,
    });

    return baseConfig;
  }

  private getCSPDirectives(isProduction: boolean) {
    const baseDirectives: any = {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", 'https:', 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    };

    // Remove null values
    Object.keys(baseDirectives).forEach(key => {
      if (baseDirectives[key] === null) {
        delete baseDirectives[key];
      }
    });

    return baseDirectives;
  }

  private getHSTSConfig(isProduction: boolean) {
    return {
      maxAge: env.SECURITY_HSTS_MAX_AGE,
      includeSubDomains: true,
      preload: isProduction,
    };
  }

  public getCustomSecurityHeaders() {
    return (req: any, res: any, next: any) => {
      // Additional security headers not covered by Helmet
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
      res.setHeader('X-Download-Options', 'noopen');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      
      
      // Remove server identification
      res.removeHeader('X-Powered-By');
      res.removeHeader('Server');

      next();
    };
  }

  public getDevelopmentSecurityConfig() {
    // Less restrictive for development
    return helmet({
      contentSecurityPolicy: false, // Disable CSP in development for easier debugging
      crossOriginEmbedderPolicy: false,
      hsts: false,
    });
  }

  public logSecurityEvent(event: string, details: any) {
    logger.warn('🛡️ Security event', {
      event,
      ...details,
      timestamp: new Date().toISOString(),
    });
  }

  public validateSecurityHeaders(headers: any): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const requiredHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection',
    ];

    requiredHeaders.forEach(header => {
      if (!headers[header]) {
        issues.push(`Missing security header: ${header}`);
      }
    });

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

export const securityHeadersManager = SecurityHeadersManager.getInstance();