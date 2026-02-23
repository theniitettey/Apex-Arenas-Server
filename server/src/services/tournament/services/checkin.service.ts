/**
 * checkIn(tournamentId, userId) - Player checks in
validateCheckInWindow(tournament) - Time window check
getCheckInStats(tournamentId) - Count checked-in players
sendCheckInReminders(tournamentId) - Notify unchecked players
disqualifyNoShows(tournamentId) - After check-in closes
 */

// file: checkin.service.ts

import mongoose from 'mongoose';
import {
  Tournament,
  Registration,
  type IApexTournament,
  type IApexRegistration
} from '../../../models'
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { notificationHelper } from './notification.helper';

const logger = createLogger('checkin-service');

export class CheckinService {
  // ============================================
  // PLAYER CHECK-IN
  // ============================================
  async checkIn(tournamentId: string, userId: string): Promise<IApexRegistration> {
    try {
      logger.info('Processing player check-in', { tournamentId, userId });

      // 1. Fetch tournament and validate check-in window
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // Validate tournament status allows check-in
      if (!['open', 'locked', 'ready_to_start'].includes(tournament.status)) {
        throw new AppError(
          'INVALID_STATUS',
          `Check-in not allowed when tournament status is ${tournament.status}`
        );
      }

      // Validate check-in window
      this.validateCheckInWindow(tournament);

      // 2. Find registration
      const registration = await Registration.findOne({
        tournament_id: tournamentId,
        user_id: userId,
        status: { $in: ['registered', 'pending_payment'] } // Only registered (paid) can check in
      });

      if (!registration) {
        throw new AppError(
          'REGISTRATION_NOT_FOUND',
          'No active registration found for this tournament'
        );
      }

      // 3. Check if already checked in
      if (registration.check_in?.checked_in) {
        throw new AppError(
          'ALREADY_CHECKED_IN',
          'Player has already checked in'
        );
      }

      // 4. Perform check-in
      registration.check_in = {
        checked_in: true,
        checked_in_at: new Date(),
        checked_in_by: new mongoose.Types.ObjectId(userId)
      };
      registration.status = 'checked_in';
      await registration.save();

      // 5. Update tournament checked-in count
      tournament.capacity.checked_in_count = (tournament.capacity.checked_in_count || 0) + 1;
      await tournament.save();

      logger.info('Check-in successful', { tournamentId, userId });

      return registration;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Check-in failed', { tournamentId, userId, error: error.message });
      throw new AppError(
        'CHECK_IN_FAILED',
        error.message || 'Check-in failed'
      );
    }
  }

  // ============================================
  // VALIDATE CHECK-IN WINDOW (pure)
  // ============================================
  validateCheckInWindow(tournament: IApexTournament): void {
    const now = new Date();

    if (!tournament.schedule.check_in_start || !tournament.schedule.check_in_end) {
      throw new AppError(
        'CHECK_IN_WINDOW_NOT_DEFINED',
        'Check-in window is not defined for this tournament'
      );
    }

    if (now < tournament.schedule.check_in_start) {
      throw new AppError(
        'CHECK_IN_NOT_STARTED',
        'Check-in has not started yet'
      );
    }

    if (now > tournament.schedule.check_in_end) {
      throw new AppError(
        'CHECK_IN_ENDED',
        'Check-in window has ended'
      );
    }
  }

  // ============================================
  // GET CHECK-IN STATS
  // ============================================
  async getCheckInStats(tournamentId: string): Promise<{
    totalRegistered: number;
    checkedIn: number;
    notCheckedIn: number;
    checkInRate: number;
    waitlistCount: number;
    checkInWindow: {
      start: Date | null;
      end: Date | null;
      isOpen: boolean;
    };
  }> {
    try {
      logger.info('Fetching check-in stats', { tournamentId });

      const tournament = await Tournament.findById(tournamentId).select(
        'capacity schedule check_in_start check_in_end status'
      );
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      const totalRegistered = await Registration.countDocuments({
        tournament_id: tournamentId,
        status: { $in: ['registered', 'checked_in'] }
      });

      const checkedIn = tournament.capacity.checked_in_count || 0;

      const notCheckedIn = Math.max(0, totalRegistered - checkedIn);

      const checkInRate = totalRegistered > 0 ? (checkedIn / totalRegistered) * 100 : 0;

      const now = new Date();
      let isOpen = false;
      if (tournament.schedule.check_in_start && tournament.schedule.check_in_end) {
        isOpen = now >= tournament.schedule.check_in_start && now <= tournament.schedule.check_in_end;
      }

      return {
        totalRegistered,
        checkedIn,
        notCheckedIn,
        checkInRate,
        waitlistCount: tournament.capacity.waitlist_count || 0,
        checkInWindow: {
          start: tournament.schedule.check_in_start || null,
          end: tournament.schedule.check_in_end || null,
          isOpen
        }
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Get check-in stats failed', { tournamentId, error: error.message });
      throw new AppError(
        'CHECK_IN_STATS_FAILED',
        error.message || 'Failed to fetch check-in stats'
      );
    }
  }

  // ============================================
  // SEND CHECK-IN REMINDERS
  // ============================================
  async sendCheckInReminders(tournamentId: string): Promise<number> {
    try {
      logger.info('Sending check-in reminders', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // Only send reminders if check-in window is open or about to open
      const now = new Date();
      const checkInStart = tournament.schedule.check_in_start;
      const checkInEnd = tournament.schedule.check_in_end;

      if (!checkInStart || !checkInEnd) {
        logger.warn('Check-in window not defined, cannot send reminders', { tournamentId });
        return 0;
      }

      // Send reminders if within 1 hour before start or during window
      const reminderWindowStart = new Date(checkInStart.getTime() - 60 * 60 * 1000); // 1 hour before
      if (now < reminderWindowStart || now > checkInEnd) {
        logger.info('Outside reminder window, skipping', { tournamentId });
        return 0;
      }

      // Find all registered players who haven't checked in
      const uncheckedRegistrations = await Registration.find({
        tournament_id: tournamentId,
        status: 'registered',
        'check_in.checked_in': false
      }).populate('user_id', 'email profile.first_name');

      if (uncheckedRegistrations.length === 0) {
        logger.info('All players already checked in', { tournamentId });
        return 0;
      }

      // Send notifications
      let sentCount = 0;
      for (const reg of uncheckedRegistrations) {
        try {
          const user = reg.user_id as any;
          await notificationHelper.notifyCheckInReminder(
            user._id.toString(),
            tournament
          );
          sentCount++;
        } catch (notifyError: any) {
          logger.error('Failed to send reminder to user', {
            tournamentId,
            userId: reg.user_id,
            error: notifyError.message
          });
        }
      }

      logger.info('Check-in reminders sent', { tournamentId, sentCount });
      return sentCount;
    } catch (error: any) {
      logger.error('Send check-in reminders failed', { tournamentId, error: error.message });
      throw new AppError(
        'CHECK_IN_REMINDER_FAILED',
        error.message || 'Failed to send check-in reminders'
      );
    }
  }

  // ============================================
  // DISQUALIFY NO-SHOWS (after check-in closes)
  // ============================================
  async disqualifyNoShows(tournamentId: string): Promise<number> {
    try {
      logger.info('Disqualifying no-show players', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // Only run if check-in window has ended
      const now = new Date();
      if (!tournament.schedule.check_in_end || now <= tournament.schedule.check_in_end) {
        throw new AppError(
          'CHECK_IN_NOT_ENDED',
          'Cannot disqualify no-shows before check-in window ends'
        );
      }

      // Find all registered players who haven't checked in
      const noShowRegistrations = await Registration.find({
        tournament_id: tournamentId,
        status: 'registered',
        'check_in.checked_in': false
      });

      if (noShowRegistrations.length === 0) {
        logger.info('No no-show players found', { tournamentId });
        return 0;
      }

      // Disqualify them
      let disqualifiedCount = 0;
      for (const reg of noShowRegistrations) {
        reg.status = 'disqualified';
        reg.disqualification_reason = 'No-show (failed to check in)';
        await reg.save();
        disqualifiedCount++;
      }

      // Update tournament checked_in_count? No, checked_in_count stays as is (only actual check-ins)
      // But we may need to adjust current_participants? Disqualified players are not participants.
      // They were counted in current_participants at registration time.
      tournament.capacity.current_participants -= disqualifiedCount;
      await tournament.save();

      logger.info('No-show players disqualified', { tournamentId, disqualifiedCount });

      // Optionally, trigger bracket regeneration or notification
      // notificationHelper.notifyDisqualification(...);

      return disqualifiedCount;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Disqualify no-shows failed', { tournamentId, error: error.message });
      throw new AppError(
        'DISQUALIFY_NO_SHOWS_FAILED',
        error.message || 'Failed to disqualify no-shows'
      );
    }
  }

  // ============================================
  // BULK CHECK-IN (organizer/admin)
  // ============================================
  async bulkCheckIn(
    tournamentId: string,
    userIds: string[],
    checkedBy: string
  ): Promise<{ success: number; failed: Array<{ userId: string; reason: string }> }> {
    try {
      logger.info('Bulk check-in initiated', { tournamentId, count: userIds.length });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // Validate that check-in window is open (or organizer override allowed)
      try {
        this.validateCheckInWindow(tournament);
      } catch (error) {
        // Organizer override: allow check-in even if window closed? For flexibility we allow.
        logger.warn('Check-in window validation failed, but proceeding as organizer override', {
          tournamentId
        });
      }

      const results: { success: number; failed: Array<{ userId: string; reason: string }> } = {
        success: 0,
        failed: []
      };

      for (const userId of userIds) {
        try {
          const registration = await Registration.findOne({
            tournament_id: tournamentId,
            user_id: userId,
            status: { $in: ['registered', 'pending_payment'] }
          });

          if (!registration) {
            results.failed.push({ userId, reason: 'Registration not found' });
            continue;
          }

          if (registration.check_in?.checked_in) {
            results.failed.push({ userId, reason: 'Already checked in' });
            continue;
          }

          registration.check_in = {
            checked_in: true,
            checked_in_at: new Date(),
            checked_in_by: new mongoose.Types.ObjectId(checkedBy)
          };
          registration.status = 'checked_in';
          await registration.save();

          tournament.capacity.checked_in_count = (tournament.capacity.checked_in_count || 0) + 1;
          results.success++;
        } catch (err: any) {
          results.failed.push({ userId, reason: err.message });
        }
      }

      await tournament.save();
      logger.info('Bulk check-in completed', { tournamentId, success: results.success, failed: results.failed.length });
      return results;
    } catch (error: any) {
      logger.error('Bulk check-in failed', { tournamentId, error: error.message });
      throw new AppError(
        'BULK_CHECK_IN_FAILED',
        error.message || 'Bulk check-in failed'
      );
    }
  }
}

export const checkinService = new CheckinService();