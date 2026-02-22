import mongoose from 'mongoose';
import {
  Tournament,
  Registration,
  User,
  Game,
  type IApexTournament,
  type IApexRegistration,
} from "../../../models"
import { notificationHelper } from './notification.helper';
import { tournamentValidationService } from './tournament.validation.service';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { redisLock, LockKeys } from '../../../shared/utils/redis-lock.utils';

const logger = createLogger('registration-service');

export class RegistrationService {
  // ============================================
  // REGISTER (Full flow) - NOW WITH RACE CONDITION PROTECTION
  // ============================================
  async register(
    tournamentId: string,
    userId: string,
    paymentData?: any
  ): Promise<{ registration: IApexRegistration; isWaitlist: boolean }> {
    // 🔒 CRITICAL: Use Redis lock to prevent race conditions
    // Two users registering for the last spot simultaneously will be handled safely
    return redisLock.executeWithLock(
      LockKeys.tournamentRegistration(tournamentId),
      async () => this._registerInternal(tournamentId, userId, paymentData),
      { ttl: 15000, retries: 5 } // 15 seconds, allow retries for busy tournaments
    );
  }

  // Internal registration (protected by Redis lock)
  private async _registerInternal(
    tournamentId: string,
    userId: string,
    paymentData?: any
  ): Promise<{ registration: IApexRegistration; isWaitlist: boolean }> {
    try {
      logger.info('Starting registration flow (LOCKED)', { tournamentId, userId });

      // 1. Validate registration eligibility (using validation service)
      await tournamentValidationService.validateCanRegister(tournamentId, userId);

      // 2. Fetch tournament and user (INSIDE LOCK - get fresh data)
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError('USER_NOT_FOUND', 'User not found');
      }

      // 3. Get user's in-game ID for this tournament's game
      const gameProfile = user.game_profiles?.find(
        gp => gp.game_id.toString() === tournament.game_id.toString()
      );
      if (!gameProfile) {
        throw new AppError(
          'GAME_PROFILE_REQUIRED',
          'You must create a game profile for this game before registering'
        );
      }

      // 4. 🔒 ATOMIC CHECK: Determine if tournament is full (inside lock, safe from race conditions)
      const currentCount = await Registration.countDocuments({
        tournament_id: tournamentId,
        status: { $in: ['registered', 'checked_in'] }
      });

      const isFull = currentCount >= tournament.capacity.max_participants;
      let status: 'pending_payment' | 'registered' = 'pending_payment';
      let waitlistPosition: number | undefined = undefined;
      let isWaitlist = false;

      if (tournament.is_free || tournament.entry_fee === 0) {
        // Free tournament: immediate registration (no payment)
        status = 'registered';
        if (isFull) {
          if (tournament.capacity.waitlist_enabled) {
            isWaitlist = true;
            waitlistPosition = await this.getNextWaitlistPosition(tournamentId);
            status = 'pending_payment';
          } else {
            throw new AppError(
              'TOURNAMENT_FULL',
              'Tournament is full and waitlist is disabled'
            );
          }
        }
      } else {
        // Paid tournament
        if (isFull) {
          if (tournament.capacity.waitlist_enabled) {
            isWaitlist = true;
            waitlistPosition = await this.getNextWaitlistPosition(tournamentId);
            status = 'pending_payment';
          } else {
            throw new AppError(
              'TOURNAMENT_FULL',
              'Tournament is full and waitlist is disabled'
            );
          }
        }
      }

      // 5. Create registration record
      const registrationData: any = {
        tournament_id: new mongoose.Types.ObjectId(tournamentId),
        user_id: new mongoose.Types.ObjectId(userId),
        registration_type: 'solo',
        in_game_id: gameProfile.in_game_id,
        status,
        seed_number: 0,
        check_in: {
          checked_in: false
        },
        waitlist_position: waitlistPosition,
        promoted_from_waitlist: false
      };

      if (!tournament.is_free && tournament.entry_fee > 0 && !isWaitlist) {
        if (!paymentData) {
          throw new AppError(
            'PAYMENT_REQUIRED',
            'Payment data is required for paid tournament'
          );
        }
      }

      const registration = await Registration.create(registrationData);

      // 6. Process payment if required (and not waitlist)
      if (!tournament.is_free && tournament.entry_fee > 0 && !isWaitlist && paymentData) {
        try {
          const paymentResult = await this.processPayment(registration._id.toString(), paymentData);
          if (!paymentResult.success) {
            await registration.deleteOne();
            throw new AppError(
              'PAYMENT_FAILED',
              paymentResult.error || 'Payment processing failed'
            );
          }
          registration.status = 'registered';
          registration.payment = {
            entry_fee_paid: tournament.entry_fee,
            payment_method: paymentData.method,
            transaction_id: paymentResult.transactionId || new mongoose.Types.ObjectId(),
            paid_at: new Date()
          };
          await registration.save();

          // Increment tournament participant count
          tournament.capacity.current_participants += 1;
          await tournament.save();

          logger.info('Payment successful, registration confirmed', { registrationId: registration._id });
        } catch (error) {
          await registration.deleteOne();
          throw error;
        }
      } else if (tournament.is_free && !isWaitlist) {
        // Free tournament: confirm immediately
        registration.status = 'registered';
        await registration.save();
        tournament.capacity.current_participants += 1;
        await tournament.save();
      } else if (isWaitlist) {
        // Waitlist: just save, no payment, no participant increment
        logger.info('User added to waitlist', { tournamentId, userId, position: waitlistPosition });
        tournament.capacity.waitlist_count += 1;
        await tournament.save();
      }

      logger.info('Registration completed', { registrationId: registration._id, isWaitlist });

      return { registration, isWaitlist };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Registration failed', { tournamentId, userId, error: error.message });
      throw new AppError(
        'REGISTRATION_FAILED',
        error.message || 'Registration failed'
      );
    }
  }

  // ============================================
  // UNREGISTER - NOW WITH LOCK PROTECTION
  // ============================================
  async unregister(
    tournamentId: string,
    userId: string,
    reason?: string
  ): Promise<void> {
    return redisLock.executeWithLock(
      LockKeys.userRegistration(userId, tournamentId),
      async () => this._unregisterInternal(tournamentId, userId, reason),
      { ttl: 10000 }
    );
  }

  private async _unregisterInternal(
    tournamentId: string,
    userId: string,
    reason?: string
  ): Promise<void> {
    try {
      logger.info('Processing unregister (LOCKED)', { tournamentId, userId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      const registration = await Registration.findOne({
        tournament_id: tournamentId,
        user_id: userId,
        status: { $in: ['registered', 'checked_in'] }
      });

      if (!registration) {
        throw new AppError(
          'REGISTRATION_NOT_FOUND',
          'No active registration found for this user'
        );
      }

      // Check cancellation window
      const now = new Date();
      const isBeforeCutoff = tournament.schedule.cancellation_cutoff && now < tournament.schedule.cancellation_cutoff;
      
      // Determine refund eligibility
      let refundAmount = 0;
      let refundEligible = false;

      if (tournament.is_free) {
        refundAmount = 0;
        refundEligible = false;
      } else {
        if (isBeforeCutoff) {
          refundAmount = tournament.entry_fee;
          refundEligible = true;
        } else {
          refundAmount = 0;
          refundEligible = false;
        }
      }

      // Update registration status
      registration.status = 'withdrawn';
      registration.withdrawn_at = new Date();
      registration.withdrawal_reason = reason || 'User withdrawal';

      if (refundEligible && refundAmount > 0) {
        registration.refund = {
          requested: true,
          requested_at: new Date(),
          reason: 'Withdrawal before cutoff',
          status: 'pending',
          amount: refundAmount,
          transaction_id: undefined,
          processed_at: undefined,
          processed_by: undefined,
          denial_reason: undefined
        };
      }

      await registration.save();

      // Decrement participant count
      if (tournament.capacity.current_participants > 0) {
        tournament.capacity.current_participants -= 1;
        await tournament.save();
      }

      // Promote someone from waitlist
      await this.promoteFromWaitlist(tournamentId);

      logger.info('Unregister successful', { tournamentId, userId });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Unregister failed', { tournamentId, userId, error: error.message });
      throw new AppError(
        'UNREGISTER_FAILED',
        error.message || 'Unregister failed'
      );
    }
  }

  // ============================================
  // PROMOTE FROM WAITLIST - WITH LOCK PROTECTION
  // ============================================
  async promoteFromWaitlist(tournamentId: string): Promise<IApexRegistration | null> {
    return redisLock.executeWithLock(
      LockKeys.waitlistPromotion(tournamentId),
      async () => this._promoteFromWaitlistInternal(tournamentId),
      { ttl: 10000 }
    );
  }

  private async _promoteFromWaitlistInternal(tournamentId: string): Promise<IApexRegistration | null> {
    try {
      logger.info('Attempting waitlist promotion', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // Check if there's space
      const currentCount = await Registration.countDocuments({
        tournament_id: tournamentId,
        status: { $in: ['registered', 'checked_in'] }
      });

      if (currentCount >= tournament.capacity.max_participants) {
        logger.info('Tournament still full, no promotion', { tournamentId });
        return null;
      }

      // Find next waitlisted user
      const waitlistedReg = await Registration.findOne({
        tournament_id: tournamentId,
        status: 'pending_payment',
        waitlist_position: { $exists: true, $ne: null }
      }).sort({ waitlist_position: 1 });

      if (!waitlistedReg) {
        logger.info('No waitlisted users to promote', { tournamentId });
        return null;
      }

      // Promote user
      waitlistedReg.status = tournament.is_free ? 'registered' : 'pending_payment';
      waitlistedReg.promoted_from_waitlist = true;
      waitlistedReg.promoted_at = new Date();
      waitlistedReg.waitlist_position = undefined;
      await waitlistedReg.save();

      try {
        await notificationHelper.notifyWaitlistPromotion(
          waitlistedReg.user_id.toString(),
          tournament
        );
      } catch (notifyError) {
        logger.warn('Failed to send promotion notification', { 
          userId: waitlistedReg.user_id, 
          error: notifyError 
        });
      }

      if (tournament.is_free) {
        waitlistedReg.status = 'registered';
        tournament.capacity.current_participants += 1;
      } else {
        waitlistedReg.status = 'pending_payment';
        // Set payment deadline (e.g., 24 hours)
        waitlistedReg.payment_deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
      }

      // Update counts
      tournament.capacity.waitlist_count = Math.max(0, tournament.capacity.waitlist_count - 1);
      if (tournament.is_free) {
        tournament.capacity.current_participants += 1;
      }
      await tournament.save();

      logger.info('User promoted from waitlist', { 
        tournamentId, 
        userId: waitlistedReg.user_id.toString() 
      });

      return waitlistedReg;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Waitlist promotion failed', { tournamentId, error: error.message });
      return null;
    }
  }

  async expireUnpaidPromotions(): Promise<number> {
    try {
      const now = new Date();
      
      // Find promoted users who haven't paid
      const expiredRegs = await Registration.find({
        status: 'pending_payment',
        promoted_from_waitlist: true,
        payment_deadline: { $lt: now }
      });

      let expiredCount = 0;
      for (const reg of expiredRegs) {
        reg.status = 'cancelled';
        reg.notes = 'Payment deadline expired after waitlist promotion';
        await reg.save();
        
        // Promote next person
        await this.promoteFromWaitlist(reg.tournament_id.toString());
        expiredCount++;
      }

      logger.info('Expired unpaid promotions', { count: expiredCount });
      return expiredCount;
    } catch (error: any) {
      logger.error('Expire unpaid promotions failed', { error: error.message });
      return 0;
    }
  }



  // ============================================
  // HELPER METHODS (Keep original implementations)
  // ============================================

  private async getNextWaitlistPosition(tournamentId: string): Promise<number> {
    const highestPosition = await Registration.findOne({
      tournament_id: tournamentId,
      waitlist_position: { $exists: true }
    }).sort({ waitlist_position: -1 }).select('waitlist_position');

    return (highestPosition?.waitlist_position || 0) + 1;
  }

  private async processPayment(registrationId: string, paymentData: any): Promise<{
    success: boolean;
    transactionId: mongoose.Types.ObjectId;
    error?: string;
  }> {
    // TODO: Implement actual payment processing
    // This is a placeholder
    logger.info('Processing payment (placeholder)', { registrationId, paymentData });
    
    return {
      success: true,
      transactionId: new mongoose.Types.ObjectId(),
      error: undefined
    };
  }

  // ============================================
  // LIST METHODS (Keep original implementations)
  // ============================================

  async listByTournament(
    tournamentId: string,
    filters: any = {}
  ): Promise<IApexRegistration[]> {
    try {
      const query: any = { tournament_id: tournamentId };

      if (filters.status) query.status = filters.status;
      if (filters.checked_in !== undefined) query['check_in.checked_in'] = filters.checked_in;

      const registrations = await Registration.find(query)
        .populate('user_id', 'username profile.first_name profile.last_name profile.avatar_url')
        .populate('team_id', 'name tag logo_url')
        .sort({ created_at: 1 });

      return registrations;
    } catch (error: any) {
      logger.error('List registrations failed', { tournamentId, error: error.message });
      throw new AppError(
        'LIST_REGISTRATIONS_FAILED',
        error.message || 'Failed to list registrations'
      );
    }
  }

  async listByUser(
    userId: string,
    filters: any = {}
  ): Promise<IApexRegistration[]> {
    try {
      const query: any = { user_id: userId };

      if (filters.status) query.status = filters.status;
      if (filters.tournament_id) query.tournament_id = filters.tournament_id;

      const registrations = await Registration.find(query)
        .populate('tournament_id', 'title game_id status schedule')
        .populate('team_id', 'name tag logo_url')
        .sort({ created_at: -1 });

      return registrations;
    } catch (error: any) {
      logger.error('List user registrations failed', { userId, error: error.message });
      throw new AppError(
        'USER_REGISTRATIONS_LIST_FAILED',
        error.message || 'Failed to list user registrations'
      );
    }
  }

  async getById(registrationId: string): Promise<IApexRegistration> {
    try {
      const registration = await Registration.findById(registrationId)
        .populate('user_id', 'username profile email')
        .populate('tournament_id', 'title game_id status entry_fee')
        .populate('team_id', 'name tag');

      if (!registration) {
        throw new AppError(
          'REGISTRATION_NOT_FOUND',
          'Registration not found'
        );
      }

      return registration;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Get registration failed', { registrationId, error: error.message });
      throw new AppError(
        'FETCH_REGISTRATION_FAILED',
        error.message || 'Failed to fetch registration'
      );
    }
  }
}

export const registrationService = new RegistrationService();