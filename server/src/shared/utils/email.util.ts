import { Resend } from 'resend';
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { env } from '../../configs/env.config';
import { createLogger } from './logger.utils';

const logger = createLogger('email-service');

// ============================================
// TYPES & INTERFACES
// ============================================

export type EmailSender = 'noreply' | 'support';

export type EmailTemplateType = 
  // OTP Templates (noreply)
  | 'otp_email_verification'
  | 'otp_password_reset'
  | 'otp_phone_verification'
  | 'otp_withdrawal_confirmation'
  | 'otp_2fa_login'
  // Account Templates (support)
  | 'account_welcome'
  | 'account_locked'
  | 'account_unlocked'
  | 'account_password_changed'
  | 'account_email_changed'
  | 'account_deactivated'
  // Security Templates (support)
  | 'security_new_device_login'
  | 'security_new_location_login'
  | 'security_suspicious_activity'
  | 'security_2fa_enabled'
  | 'security_2fa_disabled'
  | 'security_backup_codes_generated'
  // Admin Templates (support)
  | 'admin_setup_complete'
  | 'admin_2fa_required'
  | 'admin_suspicious_alert'
  // Organizer Request Templates
  | 'organizer_approved'
  | 'organizer_rejected';

export interface EmailOptions {
  to: string | string[];
  template: EmailTemplateType;
  data: Record<string, any>;
  subject?: string; // Override default subject
  attachments?: {
    filename: string;
    content: Buffer | string;
  }[];
}

export interface EmailResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

export interface BatchEmailOptions {
  emails: EmailOptions[];
}

// ============================================
// EMAIL REGISTRY
// Maps templates to senders and default subjects
// ============================================

interface TemplateConfig {
  sender: EmailSender;
  subject: string;
  templatePath: string;
}

const EMAIL_REGISTRY: Record<EmailTemplateType, TemplateConfig> = {
  // OTP Templates - use noreply
  otp_email_verification: {
    sender: 'noreply',
    subject: 'Verify your email - Apex Arenas',
    templatePath: 'otp/email-verification.hbs'
  },
  otp_password_reset: {
    sender: 'noreply',
    subject: 'Reset your password - Apex Arenas',
    templatePath: 'otp/password-reset.hbs'
  },
  otp_phone_verification: {
    sender: 'noreply',
    subject: 'Verify your phone number - Apex Arenas',
    templatePath: 'otp/phone-verification.hbs'
  },
  otp_withdrawal_confirmation: {
    sender: 'noreply',
    subject: 'Confirm your withdrawal - Apex Arenas',
    templatePath: 'otp/withdrawal-confirmation.hbs'
  },
  otp_2fa_login: {
    sender: 'noreply',
    subject: 'Your login code - Apex Arenas',
    templatePath: 'otp/2fa-login.hbs'
  },

  // Account Templates - use support
  account_welcome: {
    sender: 'support',
    subject: 'Welcome to Apex Arenas! 🎮',
    templatePath: 'account/welcome.hbs'
  },
  account_locked: {
    sender: 'support',
    subject: 'Account Security Alert - Apex Arenas',
    templatePath: 'account/account-locked.hbs'
  },
  account_unlocked: {
    sender: 'support',
    subject: 'Your account has been unlocked - Apex Arenas',
    templatePath: 'account/account-unlocked.hbs'
  },
  account_password_changed: {
    sender: 'support',
    subject: 'Your password was changed - Apex Arenas',
    templatePath: 'account/password-changed.hbs'
  },
  account_email_changed: {
    sender: 'support',
    subject: 'Your email was changed - Apex Arenas',
    templatePath: 'account/email-changed.hbs'
  },
  account_deactivated: {
    sender: 'support',
    subject: 'Your account has been deactivated - Apex Arenas',
    templatePath: 'account/deactivated.hbs'
  },

  // Security Templates - use support
  security_new_device_login: {
    sender: 'support',
    subject: 'New device login detected - Apex Arenas',
    templatePath: 'security/new-device-login.hbs'
  },
  security_new_location_login: {
    sender: 'support',
    subject: 'Login from new location - Apex Arenas',
    templatePath: 'security/new-location-login.hbs'
  },
  security_suspicious_activity: {
    sender: 'support',
    subject: '⚠️ Suspicious activity detected - Apex Arenas',
    templatePath: 'security/suspicious-activity.hbs'
  },
  security_2fa_enabled: {
    sender: 'support',
    subject: 'Two-factor authentication enabled - Apex Arenas',
    templatePath: 'security/2fa-enabled.hbs'
  },
  security_2fa_disabled: {
    sender: 'support',
    subject: 'Two-factor authentication disabled - Apex Arenas',
    templatePath: 'security/2fa-disabled.hbs'
  },
  security_backup_codes_generated: {
    sender: 'support',
    subject: 'New backup codes generated - Apex Arenas',
    templatePath: 'security/backup-codes-generated.hbs'
  },

  // Admin Templates - use support
  admin_setup_complete: {
    sender: 'support',
    subject: 'Admin account setup complete - Apex Arenas',
    templatePath: 'admin/setup-complete.hbs'
  },
  admin_2fa_required: {
    sender: 'support',
    subject: 'Action required: Enable 2FA - Apex Arenas',
    templatePath: 'admin/2fa-required.hbs'
  },
  admin_suspicious_alert: {
    sender: 'support',
    subject: 'Security Alert - Apex Arenas Admin',
    templatePath: 'admin/suspicious-alert.hbs'
  },
  organizer_approved: {
    sender: 'support',
    subject: 'Requested Organizer Role Approved',
    templatePath: ''
  },
  organizer_rejected: {
    sender: 'support',
    subject: 'Requested Organizer Role Rejected',
    templatePath: ''
  }
};

// ============================================
// SERVICE CALLER MAPPING
// Maps service names to default sender
// ============================================

const SERVICE_SENDER_MAP: Record<string, EmailSender> = {
  'auth.otp.service': 'noreply',
  'auth.password.service': 'noreply',
  'auth.2fa.service': 'noreply',
  'auth.user.service': 'support',
  'auth.admin.service': 'support',
  'auth.audit.service': 'support',
  'auth.session.service': 'support'
};

// ============================================
// EMAIL SERVICE CLASS
// ============================================

class EmailService {
  private resend: Resend;
  private templateCache: Map<string, Handlebars.TemplateDelegate> = new Map();
  private templatesDir: string;

  constructor() {
    this.resend = new Resend(env.RESEND_API_KEY);
    this.templatesDir = path.join(__dirname, '../templates/emails');
    this.registerHandlebarsHelpers();
  }

  /**
   * Register Handlebars helpers
   */
  private registerHandlebarsHelpers(): void {
    // Format date helper
    Handlebars.registerHelper('formatDate', (date: Date | string) => {
      const d = new Date(date);
      return d.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    });

    // Current year helper
    Handlebars.registerHelper('currentYear', () => new Date().getFullYear());

    // Uppercase helper
    Handlebars.registerHelper('uppercase', (str: string) => str?.toUpperCase());

    // Format currency helper
    Handlebars.registerHelper('formatCurrency', (amount: number, currency: string = 'GHS') => {
      return new Intl.NumberFormat('en-GH', {
        style: 'currency',
        currency: currency
      }).format(amount / 100); // Convert from pesewas
    });

    // Conditional equality helper
    Handlebars.registerHelper('eq', (a: any, b: any) => a === b);
  }

  /**
   * Get sender email address
   */
  private getSenderEmail(sender: EmailSender): string {
    return sender === 'noreply' 
      ? `Apex Arenas <${env.EMAIL_FROM_NOREPLY}>`
      : `Apex Arenas Support <${env.EMAIL_FROM_SUPPORT}>`;
  }

  /**
   * Load and compile template
   */
  private async loadTemplate(templatePath: string): Promise<Handlebars.TemplateDelegate> {
    // Check cache first
    if (this.templateCache.has(templatePath)) {
      return this.templateCache.get(templatePath)!;
    }

    const fullPath = path.join(this.templatesDir, templatePath);

    try {
      // Check if template file exists
      if (!fs.existsSync(fullPath)) {
        logger.warn('Template not found, using fallback', { templatePath });
        return this.getFallbackTemplate();
      }

      const templateContent = fs.readFileSync(fullPath, 'utf-8');
      const compiled = Handlebars.compile(templateContent);
      
      // Cache the compiled template
      this.templateCache.set(templatePath, compiled);
      
      return compiled;
    } catch (error: any) {
      logger.error('Error loading template', { templatePath, error: error.message });
      return this.getFallbackTemplate();
    }
  }

  /**
   * Fallback template for when template file is missing
   */
  private getFallbackTemplate(): Handlebars.TemplateDelegate {
    return Handlebars.compile(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>{{subject}}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #7c3aed;">Apex Arenas</h1>
          {{#if otp}}
          <p>Your verification code is:</p>
          <div style="background: #f3f4f6; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 4px; margin: 20px 0;">
            {{otp}}
          </div>
          <p>This code expires in {{expiry_minutes}} minutes.</p>
          {{/if}}
          {{#if message}}
          <p>{{message}}</p>
          {{/if}}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          <p style="color: #6b7280; font-size: 12px;">
            © {{currentYear}} Apex Arenas. All rights reserved.
          </p>
        </div>
      </body>
      </html>
    `);
  }

  /**
   * Send a single email
   */
  async sendEmail(options: EmailOptions, callerService?: string): Promise<EmailResult> {
    try {
      // Check if email is enabled
      if (!env.EMAIL_ENABLED) {
        logger.info('Email disabled, logging instead', {
          to: options.to,
          template: options.template,
          data: options.data
        });
        return { success: true, message_id: 'disabled-mode' };
      }

      // Check API key
      if (!env.RESEND_API_KEY) {
        logger.error('RESEND_API_KEY not configured');
        return { success: false, error: 'Email service not configured' };
      }

      // Get template config
      const templateConfig = EMAIL_REGISTRY[options.template];
      if (!templateConfig) {
        logger.error('Unknown email template', { template: options.template });
        return { success: false, error: 'Unknown email template' };
      }

      // Determine sender (from registry or service mapping)
      let sender = templateConfig.sender;
      if (callerService && SERVICE_SENDER_MAP[callerService]) {
        sender = SERVICE_SENDER_MAP[callerService];
      }

      // Load template
      const template = await this.loadTemplate(templateConfig.templatePath);

      // Add common data
      const templateData = {
        ...options.data,
        subject: options.subject || templateConfig.subject,
        support_email: env.EMAIL_FROM_SUPPORT,
        app_name: env.APP_NAME || 'Apex Arenas',
        current_year: new Date().getFullYear()
      };

      // Compile HTML
      const html = template(templateData);

      // Prepare recipients
      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

      // Send email
      const { data, error } = await this.resend.emails.send({
        from: this.getSenderEmail(sender),
        to: toAddresses,
        subject: options.subject || templateConfig.subject,
        html,
        replyTo: sender === 'support' ? env.EMAIL_REPLY_TO : undefined,
        attachments: options.attachments?.map(att => ({
          filename: att.filename,
          content: att.content
        }))
      });

      if (error) {
        logger.error('Failed to send email', { 
          error: error.message, 
          template: options.template,
          to: toAddresses 
        });
        return { success: false, error: error.message };
      }

      logger.info('Email sent successfully', {
        message_id: data?.id,
        template: options.template,
        to: toAddresses,
        sender
      });

      return { success: true, message_id: data?.id };
    } catch (error: any) {
      logger.error('Email sending error', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send batch emails
   */
  async sendBatchEmails(options: BatchEmailOptions): Promise<{ success: boolean; results: EmailResult[] }> {
    const results: EmailResult[] = [];

    for (const email of options.emails) {
      const result = await this.sendEmail(email);
      results.push(result);
    }

    const allSuccess = results.every(r => r.success);
    return { success: allSuccess, results };
  }

  // ============================================
  // CONVENIENCE METHODS
  // ============================================

  /**
   * Send OTP email (email verification)
   */
  async sendEmailVerificationOTP(
    to: string,
    data: { user_name: string; otp: string; expiry_minutes: number }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'otp_email_verification',
      data
    }, 'auth.otp.service');
  }

  /**
   * Send password reset OTP
   */
  async sendPasswordResetOTP(
    to: string,
    data: { user_name: string; otp: string; expiry_minutes: number }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'otp_password_reset',
      data
    }, 'auth.otp.service');
  }

  /**
   * Send withdrawal confirmation OTP
   */
  async sendWithdrawalOTP(
    to: string,
    data: { user_name: string; otp: string; amount: number; currency: string; expiry_minutes: number }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'otp_withdrawal_confirmation',
      data
    }, 'auth.otp.service');
  }

  /**
   * Send 2FA login code
   */
  async send2FALoginOTP(
    to: string,
    data: { user_name: string; otp: string; expiry_minutes: number }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'otp_2fa_login',
      data
    }, 'auth.otp.service');
  }

  /**
   * Send welcome email
   */
  async sendWelcomeEmail(
    to: string,
    data: { user_name: string; username: string }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'account_welcome',
      data
    }, 'auth.user.service');
  }

  /**
   * Send account locked notification
   */
  async sendAccountLockedEmail(
    to: string,
    data: { user_name: string; locked_until: Date; reason: string }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'account_locked',
      data
    }, 'auth.user.service');
  }

  /**
   * Send password changed notification
   */
  async sendPasswordChangedEmail(
    to: string,
    data: { user_name: string; changed_at: Date; ip_address: string; device: string }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'account_password_changed',
      data
    }, 'auth.password.service');
  }

  /**
   * Send new device login alert
   */
  async sendNewDeviceLoginEmail(
    to: string,
    data: { user_name: string; device: string; location: string; ip_address: string; login_time: Date }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'security_new_device_login',
      data
    }, 'auth.session.service');
  }

  /**
   * Send suspicious activity alert
   */
  async sendSuspiciousActivityEmail(
    to: string,
    data: { user_name: string; activity: string; ip_address: string; time: Date; risk_level: string }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'security_suspicious_activity',
      data
    }, 'auth.audit.service');
  }

  /**
   * Send 2FA enabled notification
   */
  async send2FAEnabledEmail(
    to: string,
    data: { user_name: string; method: string; enabled_at: Date }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'security_2fa_enabled',
      data
    }, 'auth.2fa.service');
  }

  /**
   * Send 2FA disabled notification
   */
  async send2FADisabledEmail(
    to: string,
    data: { user_name: string; disabled_at: Date; ip_address: string }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'security_2fa_disabled',
      data
    }, 'auth.2fa.service');
  }

  /**
   * Send backup codes generated notification
   */
  async sendBackupCodesGeneratedEmail(
    to: string,
    data: { user_name: string; generated_at: Date }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'security_backup_codes_generated',
      data
    }, 'auth.2fa.service');
  }

  /**
   * Send admin setup complete notification
   */
  async sendAdminSetupCompleteEmail(
    to: string,
    data: { admin_name: string; setup_at: Date }
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template: 'admin_setup_complete',
      data
    }, 'auth.admin.service');
  }

  /**
   * Clear template cache (useful for development)
   */
  clearTemplateCache(): void {
    this.templateCache.clear();
    logger.info('Template cache cleared');
  }
}

// Export singleton instance
export const emailService = new EmailService();

// Export class for testing
export { EmailService };