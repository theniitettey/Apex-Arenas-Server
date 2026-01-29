import { AuthLog, IApexAuthLog } from '../../../models/user.model';
import { env } from '../../../configs/env.config';
import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('auth-audit-service');

export interface AuditEventParams {
  user_id?: string;
  event_type: IApexAuthLog['event_type'];
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

export interface SecurityStats {
  event_type: string;
  total: number;
  successful: number;
  failed: number;
}

/**
 * Audit service for security event logging and analysis
 */

export class AuditService {

  // ============================================
  // EVENT LOGGING
  // ============================================

  /**
   * Log authentication event
   */
  static async logAuthEvent(event: AuditEventParams): Promise<void> {
    try {
      await AuthLog.create({
        user_id: event.user_id,
        event_type: event.event_type,
        success: event.success,
        identifier: event.identifier,
        metadata: {
          ip_address: event.metadata.ip_address,
          user_agent: event.metadata.user_agent,
          device_fingerprint: event.metadata.device_fingerprint,
          location: event.metadata.location,
          failure_reason: event.metadata.failure_reason,
          error_code: event.metadata.error_code,
          session_id: event.metadata.session_id,
          request_id: event.metadata.request_id,
          is_suspicious: event.metadata.is_suspicious || false,
          risk_score: event.metadata.risk_score,
          risk_factors: event.metadata.risk_factors,
          admin_id: event.metadata.admin_id,
          admin_reason: event.metadata.admin_reason
        }
      });

      const log_level = event.success ? 'info' : 'warn';
      logger[log_level]('Auth event logged', {
        event_type: event.event_type,
        user_id: event.user_id,
        success: event.success,
        ip_address: event.metadata.ip_address
      });
    } catch (error: any) {
      // Don't throw - audit logging should not break main flow
      logger.error('Failed to log audit event', { error: error.message, event_type: event.event_type });
    }
  }

  /**
   * Log suspicious activity with high risk score
   */
  static async logSuspiciousActivity(
    user_id: string | undefined,
    reason: string,
    metadata: {
      ip_address: string;
      user_agent: string;
      risk_factors: string[];
      [key: string]: any;
    }
  ): Promise<void> {
    await this.logAuthEvent({
      user_id,
      event_type: 'suspicious_activity',
      success: false,
      metadata: {
        ...metadata,
        failure_reason: reason,
        is_suspicious: true,
        risk_score: 80
      }
    });
  }

  // ============================================
  // AUDIT TRAIL QUERIES
  // ============================================

  /**
   * Get audit trail for a specific user
   */
  static async getUserAuditTrail(user_id: string, limit: number = 100): Promise<any[]> {
    try {
      return await AuthLog.find({ user_id })
        .sort({ created_at: -1 })
        .limit(limit)
        .select('event_type success metadata created_at')
        .lean();
    } catch (error: any) {
      logger.error('Error getting user audit trail:', error);
      throw new Error('AUDIT_TRAIL_FETCH_FAILED');
    }
  }

  /**
   * Get recent authentication events (for admin dashboard)
   */
  static async getRecentEvents(limit: number = 50): Promise<any[]> {
    try {
      return await AuthLog.find()
        .sort({ created_at: -1 })
        .limit(limit)
        .populate('user_id', 'email username')
        .lean();
    } catch (error: any) {
      logger.error('Error getting recent events:', error);
      throw new Error('RECENT_EVENTS_FETCH_FAILED');
    }
  }

  /**
   * Get failed login attempts for a user or identifier
   */
  static async getFailedLoginAttempts(
    identifier: string,
    window_minutes: number = env.FAILED_LOGIN_WINDOW_MINUTES
  ): Promise<number> {
    try {
      const window_start = new Date();
      window_start.setMinutes(window_start.getMinutes() - window_minutes);

      const count = await AuthLog.countDocuments({
        $or: [
          { user_id: identifier },
          { identifier: identifier }
        ],
        event_type: 'login_failed',
        created_at: { $gte: window_start }
      });

      return count;
    } catch (error: any) {
      logger.error('Error getting failed login attempts:', error);
      return 0;
    }
  }

  /**
   * Check if IP address has suspicious activity
   */
  static async isIPSuspicious(
    ip_address: string, 
    window_hours: number = env.SUSPICIOUS_ACTIVITY_WINDOW_HOURS
  ): Promise<boolean> {
    try {
      const window_start = new Date();
      window_start.setHours(window_start.getHours() - window_hours);

      const suspicious_count = await AuthLog.countDocuments({
        'metadata.ip_address': ip_address,
        'metadata.is_suspicious': true,
        created_at: { $gte: window_start }
      });

      const failed_count = await AuthLog.countDocuments({
        'metadata.ip_address': ip_address,
        event_type: 'login_failed',
        created_at: { $gte: window_start }
      });

      // Use config thresholds
      return suspicious_count >= env.IP_SUSPICIOUS_THRESHOLD || 
             failed_count >= env.IP_FAILED_ATTEMPTS_THRESHOLD;
    } catch (error: any) {
      logger.error('Error checking IP suspicion:', error);
      return false;
    }
  }

  // ============================================
  // SEARCH AND FILTER
  // ============================================

  /**
   * Search audit logs with filters
   */
  static async searchAuditLogs(filters: AuditSearchFilters): Promise<any[]> {
    try {
      const query: any = {};

      if (filters.user_id) query.user_id = filters.user_id;
      if (filters.event_type) query.event_type = filters.event_type;
      if (filters.success !== undefined) query.success = filters.success;
      if (filters.ip_address) query['metadata.ip_address'] = filters.ip_address;
      if (filters.is_suspicious !== undefined) query['metadata.is_suspicious'] = filters.is_suspicious;

      if (filters.start_date || filters.end_date) {
        query.created_at = {};
        if (filters.start_date) query.created_at.$gte = filters.start_date;
        if (filters.end_date) query.created_at.$lte = filters.end_date;
      }

      return await AuthLog.find(query)
        .sort({ created_at: -1 })
        .limit(filters.limit || 100)
        .populate('user_id', 'email username')
        .lean();
    } catch (error: any) {
      logger.error('Error searching audit logs:', error);
      throw new Error('AUDIT_SEARCH_FAILED');
    }
  }

  /**
   * Get events by type for a user
   */
  static async getUserEventsByType(
    user_id: string,
    event_type: string,
    limit: number = 20
  ): Promise<any[]> {
    try {
      return await AuthLog.find({ user_id, event_type })
        .sort({ created_at: -1 })
        .limit(limit)
        .select('success metadata created_at')
        .lean();
    } catch (error: any) {
      logger.error('Error getting user events by type:', error);
      throw new Error('AUDIT_FETCH_FAILED');
    }
  }

  // ============================================
  // SECURITY STATISTICS
  // ============================================

  /**
   * Get security statistics for a timeframe
   */
  static async getSecurityStats(timeframe: '24h' | '7d' | '30d' = '24h'): Promise<SecurityStats[]> {
    try {
      const time_ranges = {
        '24h': new Date(Date.now() - 24 * 60 * 60 * 1000),
        '7d': new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        '30d': new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      };

      const start_date = time_ranges[timeframe];

      const stats = await AuthLog.aggregate([
        {
          $match: {
            created_at: { $gte: start_date }
          }
        },
        {
          $group: {
            _id: '$event_type',
            total: { $sum: 1 },
            successful: {
              $sum: { $cond: ['$success', 1, 0] }
            },
            failed: {
              $sum: { $cond: ['$success', 0, 1] }
            }
          }
        },
        {
          $project: {
            _id: 0,
            event_type: '$_id',
            total: 1,
            successful: 1,
            failed: 1
          }
        }
      ]);

      return stats;
    } catch (error: any) {
      logger.error('Error getting security stats:', error);
      throw new Error('SECURITY_STATS_FETCH_FAILED');
    }
  }

  /**
   * Get user login statistics
   */
  static async getUserLoginStats(user_id: string): Promise<{
    total_logins: number;
    failed_logins: number;
    last_login_at: Date | null;
    last_login_ip: string | null;
    unique_ips: number;
  }> {
    try {
      const days_ago = new Date();
      days_ago.setDate(days_ago.getDate() - env.ACTIVITY_WINDOW_DAYS);

      const [total_logins, failed_logins, last_login, unique_ips_result] = await Promise.all([
        AuthLog.countDocuments({
          user_id,
          event_type: 'login_success',
          created_at: { $gte: days_ago }
        }),
        AuthLog.countDocuments({
          user_id,
          event_type: 'login_failed',
          created_at: { $gte: days_ago }
        }),
        AuthLog.findOne({
          user_id,
          event_type: 'login_success'
        }).sort({ created_at: -1 }).select('created_at metadata.ip_address').lean(),
        AuthLog.distinct('metadata.ip_address', {
          user_id,
          created_at: { $gte: days_ago }
        })
      ]);

      return {
        total_logins,
        failed_logins,
        last_login_at: last_login?.created_at || null,
        last_login_ip: last_login?.metadata?.ip_address || null,
        unique_ips: unique_ips_result.length
      };
    } catch (error: any) {
      logger.error('Error getting user login stats:', error);
      throw new Error('LOGIN_STATS_FETCH_FAILED');
    }
  }

  /**
   * Get suspicious activity summary
   */
  static async getSuspiciousActivitySummary(hours: number = 24): Promise<{
    total_suspicious: number;
    unique_ips: number;
    unique_users: number;
    top_risk_factors: { factor: string; count: number }[];
  }> {
    try {
      const start_date = new Date();
      start_date.setHours(start_date.getHours() - hours);

      const [suspicious_events, unique_ips, unique_users, risk_factors] = await Promise.all([
        AuthLog.countDocuments({
          'metadata.is_suspicious': true,
          created_at: { $gte: start_date }
        }),
        AuthLog.distinct('metadata.ip_address', {
          'metadata.is_suspicious': true,
          created_at: { $gte: start_date }
        }),
        AuthLog.distinct('user_id', {
          'metadata.is_suspicious': true,
          user_id: { $ne: null },
          created_at: { $gte: start_date }
        }),
        AuthLog.aggregate([
          {
            $match: {
              'metadata.is_suspicious': true,
              'metadata.risk_factors': { $exists: true, $ne: [] },
              created_at: { $gte: start_date }
            }
          },
          { $unwind: '$metadata.risk_factors' },
          {
            $group: {
              _id: '$metadata.risk_factors',
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 0,
              factor: '$_id',
              count: 1
            }
          }
        ])
      ]);

      return {
        total_suspicious: suspicious_events,
        unique_ips: unique_ips.length,
        unique_users: unique_users.length,
        top_risk_factors: risk_factors
      };
    } catch (error: any) {
      logger.error('Error getting suspicious activity summary:', error);
      throw new Error('SUSPICIOUS_ACTIVITY_FETCH_FAILED');
    }
  }

  // ============================================
  // CLEANUP
  // ============================================

  /**
   * Clean up old audit logs (for scheduled job)
   */
  static async cleanupOldLogs(
    retention_days: number = env.AUDIT_LOG_RETENTION_DAYS
  ): Promise<number> {
    try {
      const cutoff_date = new Date();
      cutoff_date.setDate(cutoff_date.getDate() - retention_days);

      const result = await AuthLog.deleteMany({
        created_at: { $lt: cutoff_date }
      });

      logger.info('Old audit logs cleaned up', {
        deleted_count: result.deletedCount,
        retention_days
      });

      return result.deletedCount || 0;
    } catch (error: any) {
      logger.error('Error cleaning up old audit logs:', error);
      throw new Error('AUDIT_CLEANUP_FAILED');
    }
  }
}

// Export individual functions for convenience
export const logAuthEvent = AuditService.logAuthEvent.bind(AuditService);
export const logSuspiciousActivity = AuditService.logSuspiciousActivity.bind(AuditService);
export const getUserAuditTrail = AuditService.getUserAuditTrail.bind(AuditService);
export const getRecentEvents = AuditService.getRecentEvents.bind(AuditService);
export const getFailedLoginAttempts = AuditService.getFailedLoginAttempts.bind(AuditService);
export const isIPSuspicious = AuditService.isIPSuspicious.bind(AuditService);
export const searchAuditLogs = AuditService.searchAuditLogs.bind(AuditService);
export const getSecurityStats = AuditService.getSecurityStats.bind(AuditService);
export const getUserLoginStats = AuditService.getUserLoginStats.bind(AuditService);
export const getSuspiciousActivitySummary = AuditService.getSuspiciousActivitySummary.bind(AuditService);
export const cleanupOldLogs = AuditService.cleanupOldLogs.bind(AuditService);
