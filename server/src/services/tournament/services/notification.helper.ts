import { createLogger } from '../../../shared/utils/logger.utils';

const logger = createLogger('notification-helper');

/**
 * Notification Helper
 * 
 * TEMPORARY IMPLEMENTATION: Only logs to console.
 * Will be replaced with actual notification service (email, push, SMS, in-app)
 * after core functionality is complete.
 */
export const notificationHelper = {
  /**
   * Notify user that their tournament registration is confirmed
   */
  async notifyRegistrationConfirmed(userId: string, tournament: any): Promise<void> {
    logger.info('[NOTIFICATION] Registration confirmed', {
      userId,
      tournamentId: tournament?._id || tournament,
      tournamentTitle: tournament?.title,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify user that they have been promoted from the waitlist
   */
  async notifyWaitlistPromotion(userId: string, tournament: any, paymentDeadline?: Date): Promise<void> {
    logger.info('[NOTIFICATION] Waitlist promotion', {
      userId,
      tournamentId: tournament?._id || tournament,
      tournamentTitle: tournament?.title,
      entryFee: tournament?.entry_fee,
      isFree: tournament?.is_free,
      paymentDeadline: paymentDeadline ? paymentDeadline.toISOString() : undefined,
      message: tournament?.is_free 
        ? 'You have been promoted from the waitlist and are now registered!'
        : `You have been promoted from the waitlist. Please complete payment within 15 minutes. Payment deadline: ${paymentDeadline ? paymentDeadline.toISOString() : 'N/A'}`,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Send check-in reminder to a player
   */
  async notifyCheckInReminder(userId: string, tournament: any): Promise<void> {
    logger.info('[NOTIFICATION] Check-in reminder', {
      userId,
      tournamentId: tournament?._id || tournament,
      tournamentTitle: tournament?.title,
      checkInWindow: {
        start: tournament?.schedule?.check_in_start,
        end: tournament?.schedule?.check_in_end
      },
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify players that a match has been scheduled
   */
  async notifyMatchScheduled(userIds: string[], match: any): Promise<void> {
    logger.info('[NOTIFICATION] Match scheduled', {
      userIds,
      matchId: match?._id || match,
      tournamentId: match?.tournament_id,
      round: match?.round,
      scheduledTime: match?.schedule?.scheduled_time,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify players that a match is about to start (ready check)
   */
  async notifyMatchStarting(userIds: string[], match: any): Promise<void> {
    logger.info('[NOTIFICATION] Match starting', {
      userIds,
      matchId: match?._id || match,
      tournamentId: match?.tournament_id,
      round: match?.round,
      readyCheckTime: match?.schedule?.ready_check_time,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify opponent that a result has been submitted for their match
   */
  async notifyResultSubmitted(userId: string, match: any): Promise<void> {
    logger.info('[NOTIFICATION] Result submitted', {
      userId,
      matchId: match?._id || match,
      tournamentId: match?.tournament_id,
      reportedBy: match?.result_reported_by,
      winnerId: match?.winner_id,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify tournament organizer that a match result has been disputed
   */
  async notifyResultDisputed(userIds: string[], match: any): Promise<void> {
    logger.info('[NOTIFICATION] Result disputed', {
      userIds,
      matchId: match?._id || match,
      tournamentId: match?.tournament_id,
      disputedBy: match?.dispute?.disputed_by,
      disputeReason: match?.dispute?.dispute_reason,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify match participants that a dispute has been resolved
   */
  async notifyDisputeResolved(userIds: string[], match: any, winnerId: string): Promise<void> {
    logger.info('[NOTIFICATION] Dispute resolved', {
      userIds,
      matchId: match?._id || match,
      tournamentId: match?.tournament_id,
      winnerId,
      resolution: match?.dispute?.resolution,
      resolvedBy: match?.dispute?.resolved_by,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify player that they have won a prize
   */
  async notifyPrizeWon(userId: string, amount: number, tournament: any): Promise<void> {
    logger.info('[NOTIFICATION] Prize won', {
      userId,
      amount,
      tournamentId: tournament?._id || tournament,
      tournamentTitle: tournament?.title,
      placement: tournament?.results?.winners?.find((w: any) => w.user_id?.toString() === userId)?.position,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify all registered players that a tournament has been cancelled
   */
  async notifyTournamentCancelled(userIds: string[], tournament: any): Promise<void> {
    logger.info('[NOTIFICATION] Tournament cancelled', {
      userIds,
      tournamentId: tournament?._id || tournament,
      tournamentTitle: tournament?.title,
      reason: tournament?.cancellation?.reason,
      cancelledBy: tournament?.cancellation?.cancelled_by,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify user that their game request has been approved
   */
  async notifyGameRequestApproved(userId: string, game: any): Promise<void> {
    logger.info('[NOTIFICATION] Game request approved', {
      userId,
      gameId: game?._id || game,
      gameName: game?.name,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify user that their payment deadline is approaching
   */
  async notifyPaymentDeadlineReminder(userId: string, tournament: any, deadline: Date): Promise<void> {
    logger.info('[NOTIFICATION] Payment deadline reminder', {
      userId,
      tournamentId: tournament?._id || tournament,
      tournamentTitle: tournament?.title,
      deadline: deadline.toISOString(),
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Notify user that their promotion has expired due to non-payment
   */
  async notifyPromotionExpired(userId: string, tournament: any): Promise<void> {
    logger.info('[NOTIFICATION] Promotion expired', {
      userId,
      tournamentId: tournament?._id || tournament,
      tournamentTitle: tournament?.title,
      reason: 'Payment deadline expired',
      timestamp: new Date().toISOString()
    });
  }
};