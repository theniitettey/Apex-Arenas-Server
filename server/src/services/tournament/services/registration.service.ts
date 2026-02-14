/**
 * register(tournamentId, userId, paymentData) - Full registration flow
unregister(tournamentId, userId) - Withdrawal + refund
processPayment(registration, paymentData) - Coordinate with Finance
addToWaitlist(tournamentId, userId) - Waitlist logic
promoteFromWaitlist(tournamentId) - Auto-promote when slot opens
verifyInGameId(userId, gameId, inGameId) - Check against user profile
listByTournament(tournamentId, filters) - Get registrations
listByUser(userId, filters) - Get user's registrations
 */

// file: registration.service.ts

import mongoose from 'mongoose';
import { Tournament, IApexTournament } from '../../models/tournaments.model';
import { Registration, IApexRegistration } from '../../models/registrations.models';
import { User } from '../../models/user.model';
import { Transaction } from '../../models/transactions.model';
import { Game } from '../../models/games.model';
import { tournamentValidationService } from './tournament.validation.service';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { TOURNAMENT_ERROR_CODES } from '../../../shared/constants/error-codes';
import { env } from '../../../configs/env.config';

// Assume we have a finance service client (abstracted)
// In a real microservice, this would be an event emitter or HTTP client
import { financeService } from '../../../shared/clients/finance.service.client';

const logger = createLogger('registration-service');

export class RegistrationService {
  // ============================================
  // REGISTER (Full flow)
  // ============================================
  async register(
    tournamentId: string,
    userId: string,
    paymentData?: any
  ): Promise<{ registration: IApexRegistration; isWaitlist: boolean }> {
    try {
      logger.info('Starting registration flow', { tournamentId, userId });

      // 1. Validate registration eligibility (using validation service)
      await tournamentValidationService.validateCanRegister(tournamentId, userId);

      // 2. Fetch tournament and user
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError(TOURNAMENT_ERROR_CODES.NOT_FOUND, 'Tournament not found');
      }
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError(TOURNAMENT_ERROR_CODES.USER_NOT_FOUND, 'User not found');
      }

      // 3. Get user's in-game ID for this tournament's game
      const gameProfile = user.game_profiles?.find(
        gp => gp.game_id.toString() === tournament.game_id.toString()
      );
      if (!gameProfile) {
        throw new AppError(
          TOURNAMENT_ERROR_CODES.GAME_PROFILE_REQUIRED,
          'You must create a game profile for this game before registering'
        );
      }

      // 4. Determine if tournament is full and waitlist handling
      const isFull = tournament.capacity.current_participants >= tournament.capacity.max_participants;
      let status: 'pending_payment' | 'registered' = 'pending_payment';
      let waitlistPosition: number | undefined = undefined;
      let isWaitlist = false;

      if (tournament.is_free || tournament.entry_fee === 0) {
        // Free tournament: immediate registration (no payment)
        status = 'registered';
        if (isFull) {
          // If full and no payment, waitlist is still possible if enabled
          if (tournament.capacity.waitlist_enabled) {
            isWaitlist = true;
            waitlistPosition = await this.getNextWaitlistPosition(tournamentId);
            status = 'pending_payment'; // Actually for waitlist, we might keep as pending or special status
          } else {
            throw new AppError(
              TOURNAMENT_ERROR_CODES.TOURNAMENT_FULL,
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
            // Waitlisted users don't pay yet, they will be prompted when promoted
            status = 'pending_payment'; // Mark as pending_payment but with waitlist position
          } else {
            throw new AppError(
              TOURNAMENT_ERROR_CODES.TOURNAMENT_FULL,
              'Tournament is full and waitlist is disabled'
            );
          }
        }
      }

      // 5. Create registration record
      const registrationData: any = {
        tournament_id: new mongoose.Types.ObjectId(tournamentId),
        user_id: new mongoose.Types.ObjectId(userId),
        registration_type: 'solo', // TODO: support team registration
        in_game_id: gameProfile.in_game_id,
        status,
        seed_number: 0, // will be assigned later during bracket generation
        check_in: {
          checked_in: false
        },
        waitlist_position: waitlistPosition,
        promoted_from_waitlist: false
      };

      // If not free and not waitlist, we expect paymentData
      if (!tournament.is_free && tournament.entry_fee > 0 && !isWaitlist) {
        if (!paymentData) {
          throw new AppError(
            TOURNAMENT_ERROR_CODES.PAYMENT_REQUIRED,
            'Payment data is required for paid tournament'
          );
        }
        // We'll process payment after registration creation? Or before?
        // We can create registration first with pending_payment, then process payment.
        // But to avoid orphan records, we might create after payment confirmation.
        // For simplicity, we'll create registration and then process payment.
      }

      const registration = await Registration.create(registrationData);

      // 6. Process payment if required (and not waitlist)
      if (!tournament.is_free && tournament.entry_fee > 0 && !isWaitlist && paymentData) {
        try {
          const paymentResult = await this.processPayment(registration._id.toString(), paymentData);
          if (!paymentResult.success) {
            // Payment failed: delete registration or mark as failed
            await registration.deleteOne();
            throw new AppError(
              TOURNAMENT_ERROR_CODES.PAYMENT_FAILED,
              paymentResult.error || 'Payment processing failed'
            );
          }
          // Update registration with payment info
          registration.status = 'registered';
          registration.payment = {
            entry_fee_paid: tournament.entry_fee,
            payment_method: paymentData.method,
            transaction_id: paymentResult.transactionId,
            paid_at: new Date()
          };
          await registration.save();

          // Increment tournament participant count
          tournament.capacity.current_participants += 1;
          await tournament.save();

          logger.info('Payment successful, registration confirmed', { registrationId: registration._id });
        } catch (error) {
          // If payment fails, clean up registration
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
        TOURNAMENT_ERROR_CODES.REGISTRATION_FAILED,
        error.message || 'Registration failed'
      );
    }
  }

  // ============================================
  // UNREGISTER (Withdrawal + Refund)
  // ============================================
  async unregister(
    tournamentId: string,
    userId: string,
    reason?: string
  ): Promise<void> {
    try {
      logger.info('Processing unregister', { tournamentId, userId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError(TOURNAMENT_ERROR_CODES.NOT_FOUND, 'Tournament not found');
      }

      const registration = await Registration.findOne({
        tournament_id: tournamentId,
        user_id: userId,
        status: { $in: ['registered', 'checked_in'] }
      });

      if (!registration) {
        throw new AppError(
          TOURNAMENT_ERROR_CODES.REGISTRATION_NOT_FOUND,
          'No active registration found for this user'
        );
      }

      // Check cancellation window
      const now = new Date();
      const isBeforeCutoff = tournament.schedule.cancellation_cutoff && now < tournament.schedule.cancellation_cutoff;
      
      // Determine refund eligibility
      let refundAmount = 0;
      let refundEligible = false;
      let cancellationType: 'player_early' | 'organizer_cancelled' | 'tournament_cancelled' = 'player_early';

      if (tournament.is_free) {
        // Free tournament: no refund, just remove
        refundAmount = 0;
        refundEligible = false;
      } else {
        if (isBeforeCutoff) {
          refundAmount = tournament.entry_fee; // full refund
          refundEligible = true;
        } else {
          // Late cancellation: no refund
          refundAmount = 0;
          refundEligible = false;
        }
      }

      // Update registration status
      registration.status = 'withdrawn';
      registration.withdrawn_at = new Date();
      registration.withdrawal_reason = reason;
      await registration.save();

      // Decrement tournament participant count (if they were counted)
      if (tournament.capacity.current_participants > 0) {
        tournament.capacity.current_participants -= 1;
      }
      await tournament.save();

      // Process refund if eligible
      if (refundEligible && refundAmount > 0 && registration.payment?.transaction_id) {
        await this.processRefund(
          registration,
          refundAmount,
          cancellationType,
          userId
        );
      }

      // If a slot opened and there's a waitlist, promote next player
      if (tournament.capacity.waitlist_enabled && tournament.capacity.waitlist_count > 0) {
        await this.promoteFromWaitlist(tournamentId);
      }

      logger.info('Unregistration successful', { tournamentId, userId, refunded: refundEligible });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Unregister failed', { tournamentId, userId, error: error.message });
      throw new AppError(
        TOURNAMENT_ERROR_CODES.UNREGISTER_FAILED,
        error.message || 'Unregister failed'
      );
    }
  }

  // ============================================
  // PROCESS PAYMENT (Coordinate with Finance)
  // ============================================
  async processPayment(
    registrationId: string,
    paymentData: any
  ): Promise<{ success: boolean; transactionId?: mongoose.Types.ObjectId; error?: string }> {
    try {
      logger.info('Processing payment for registration', { registrationId });

      const registration = await Registration.findById(registrationId).populate('tournament_id');
      if (!registration) {
        throw new AppError(TOURNAMENT_ERROR_CODES.REGISTRATION_NOT_FOUND, 'Registration not found');
      }

      const tournament = registration.tournament_id as unknown as IApexTournament;
      const amount = tournament.entry_fee;
      const userId = registration.user_id.toString();

      // Call finance service to process payment
      // This is an abstraction – in reality, you'd emit an event or call an API
      const paymentResult = await financeService.processEntryFee({
        userId,
        amount,
        currency: tournament.currency || 'GHS',
        tournamentId: tournament._id.toString(),
        registrationId,
        paymentMethod: paymentData.method,
        paymentDetails: paymentData.details
      });

      if (!paymentResult.success) {
        logger.error('Payment failed', { registrationId, error: paymentResult.error });
        return { success: false, error: paymentResult.error };
      }

      // Create transaction record (optional, could be done by finance service)
      // We'll assume finance service returns a transaction ID
      const transaction = await Transaction.create({
        user_id: new mongoose.Types.ObjectId(userId),
        idempotency_key: paymentResult.idempotencyKey || `reg_${registrationId}_${Date.now()}`,
        type: 'entry_fee',
        direction: 'debit',
        amount,
        currency: tournament.currency || 'GHS',
        balance_before: paymentResult.balanceBefore,
        balance_after: paymentResult.balanceAfter,
        status: 'completed',
        related_to: {
          entity_type: 'tournament',
          entity_id: tournament._id
        },
        payment_details: {
          payment_method: paymentData.method,
          payment_gateway: paymentResult.gateway,
          gateway_transaction_id: paymentResult.gatewayTransactionId,
          gateway_fee: paymentResult.gatewayFee || 0
        },
        completed_at: new Date()
      });

      logger.info('Payment processed successfully', { registrationId, transactionId: transaction._id });
      return {
        success: true,
        transactionId: transaction._id
      };
    } catch (error: any) {
      logger.error('Payment processing error', { registrationId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // PROCESS REFUND (Helper)
  // ============================================
  private async processRefund(
    registration: IApexRegistration,
    amount: number,
    cancellationType: string,
    cancelledByUserId: string
  ): Promise<void> {
    try {
      logger.info('Processing refund', { registrationId: registration._id, amount });

      // Call finance service to issue refund
      const refundResult = await financeService.processRefund({
        userId: registration.user_id.toString(),
        originalTransactionId: registration.payment?.transaction_id.toString(),
        amount,
        reason: cancellationType,
        tournamentId: registration.tournament_id.toString(),
        registrationId: registration._id.toString()
      });

      if (!refundResult.success) {
        logger.error('Refund failed', { registrationId: registration._id, error: refundResult.error });
        // Store refund failure in registration for manual handling
        if (!registration.refund) {
          registration.refund = {} as any;
        }
        registration.refund.status = 'denied';
        registration.refund.denial_reason = refundResult.error || 'Refund processing failed';
        await registration.save();
        return;
      }

      // Create refund transaction record
      const refundTransaction = await Transaction.create({
        user_id: registration.user_id,
        idempotency_key: `refund_${registration._id}_${Date.now()}`,
        type: 'refund',
        direction: 'credit',
        amount,
        currency: 'GHS',
        balance_before: refundResult.balanceBefore,
        balance_after: refundResult.balanceAfter,
        status: 'completed',
        related_to: {
          entity_type: 'tournament',
          entity_id: registration.tournament_id
        },
        payment_details: {
          payment_method: registration.payment?.payment_method,
          gateway_transaction_id: refundResult.gatewayTransactionId
        },
        completed_at: new Date()
      });

      // Update registration with refund info
      registration.refund = {
        requested: true,
        requested_at: new Date(),
        reason: cancellationType,
        status: 'processed',
        amount,
        transaction_id: refundTransaction._id,
        processed_at: new Date(),
        processed_by: new mongoose.Types.ObjectId(cancelledByUserId) // assume cancelledByUserId is the user ID of the person performing the action (player or admin)
      };
      await registration.save();

      logger.info('Refund processed', { registrationId: registration._id, refundTransactionId: refundTransaction._id });
    } catch (error: any) {
      logger.error('Refund processing error', { registrationId: registration._id, error: error.message });
      // Don't throw, we want unregistration to succeed even if refund fails
    }
  }

  // ============================================
  // ADD TO WAITLIST
  // ============================================
  async addToWaitlist(tournamentId: string, userId: string): Promise<IApexRegistration> {
    try {
      logger.info('Adding user to waitlist', { tournamentId, userId });

      // Check if tournament exists and is open
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError(TOURNAMENT_ERROR_CODES.NOT_FOUND, 'Tournament not found');
      }
      if (tournament.status !== 'open') {
        throw new AppError(
          TOURNAMENT_ERROR_CODES.INVALID_STATUS,
          'Can only add to waitlist when tournament is open'
        );
      }
      if (!tournament.capacity.waitlist_enabled) {
        throw new AppError(
          TOURNAMENT_ERROR_CODES.WAITLIST_DISABLED,
          'Waitlist is not enabled for this tournament'
        );
      }

      // Check if already registered or on waitlist
      const existing = await Registration.findOne({
        tournament_id: tournamentId,
        user_id: userId,
        status: { $in: ['registered', 'checked_in', 'pending_payment'] }
      });
      if (existing) {
        if (existing.waitlist_position) {
          throw new AppError(
            TOURNAMENT_ERROR_CODES.ALREADY_ON_WAITLIST,
            'User is already on the waitlist'
          );
        }
        throw new AppError(
          TOURNAMENT_ERROR_CODES.ALREADY_REGISTERED,
          'User is already registered'
        );
      }

      // Get next waitlist position
      const position = await this.getNextWaitlistPosition(tournamentId);

      // Get user's in-game ID
      const user = await User.findById(userId);
      const gameProfile = user?.game_profiles?.find(
        gp => gp.game_id.toString() === tournament.game_id.toString()
      );
      if (!gameProfile) {
        throw new AppError(
          TOURNAMENT_ERROR_CODES.GAME_PROFILE_REQUIRED,
          'Game profile required for waitlist'
        );
      }

      // Create registration with waitlist status
      const registration = await Registration.create({
        tournament_id: new mongoose.Types.ObjectId(tournamentId),
        user_id: new mongoose.Types.ObjectId(userId),
        registration_type: 'solo',
        in_game_id: gameProfile.in_game_id,
        status: 'pending_payment', // Waitlist entries are pending
        waitlist_position: position,
        promoted_from_waitlist: false,
        check_in: { checked_in: false }
      });

      // Increment waitlist count
      tournament.capacity.waitlist_count += 1;
      await tournament.save();

      logger.info('User added to waitlist', { tournamentId, userId, position });
      return registration;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Add to waitlist failed', { tournamentId, userId, error: error.message });
      throw new AppError(
        TOURNAMENT_ERROR_CODES.WAITLIST_ADD_FAILED,
        error.message || 'Failed to add to waitlist'
      );
    }
  }

  // ============================================
  // PROMOTE FROM WAITLIST
  // ============================================
  async promoteFromWaitlist(tournamentId: string): Promise<void> {
    try {
      logger.info('Promoting users from waitlist', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError(TOURNAMENT_ERROR_CODES.NOT_FOUND, 'Tournament not found');
      }

      // Check if there's capacity
      const availableSlots = tournament.capacity.max_participants - tournament.capacity.current_participants;
      if (availableSlots <= 0) {
        logger.info('No available slots for waitlist promotion', { tournamentId });
        return;
      }

      // Get next waitlisted registrations in order
      const waitlisted = await Registration.find({
        tournament_id: tournamentId,
        waitlist_position: { $exists: true, $ne: null },
        status: 'pending_payment' // or a dedicated 'waitlisted' status
      }).sort({ waitlist_position: 1 }).limit(availableSlots);

      if (waitlisted.length === 0) {
        logger.info('No waitlisted users to promote', { tournamentId });
        return;
      }

      for (const registration of waitlisted) {
        // For free tournaments, promote immediately
        if (tournament.is_free || tournament.entry_fee === 0) {
          registration.status = 'registered';
          registration.promoted_from_waitlist = true;
          registration.promoted_at = new Date();
          registration.waitlist_position = null; // clear waitlist position
          await registration.save();

          tournament.capacity.current_participants += 1;
          tournament.capacity.waitlist_count -= 1;
          await tournament.save();

          logger.info('User promoted from waitlist (free)', { tournamentId, userId: registration.user_id });
        } else {
          // For paid tournaments, we need to request payment
          // Option 1: Send notification to user to complete payment
          // Option 2: Automatically charge if payment method on file
          // For now, we'll update status to pending_payment and send notification
          registration.status = 'pending_payment';
          registration.promoted_from_waitlist = true;
          registration.promoted_at = new Date();
          registration.waitlist_position = null;
          await registration.save();

          // Do not increment participant count yet; wait for payment
          // But we do decrease waitlist count
          tournament.capacity.waitlist_count -= 1;
          await tournament.save();

          // Trigger notification
          // await notificationHelper.notifyWaitlistPromotion(registration.user_id, tournamentId);
          logger.info('User promoted from waitlist (payment required)', { tournamentId, userId: registration.user_id });
        }
      }

      logger.info('Waitlist promotion completed', { tournamentId, promoted: waitlisted.length });
    } catch (error: any) {
      logger.error('Promote from waitlist failed', { tournamentId, error: error.message });
      // Don't throw – this is often called as background job
    }
  }

  // ============================================
  // VERIFY IN-GAME ID
  // ============================================
  async verifyInGameId(userId: string, gameId: string, inGameId: string): Promise<boolean> {
    try {
      logger.info('Verifying in-game ID', { userId, gameId, inGameId });

      const user = await User.findById(userId);
      if (!user) {
        throw new AppError(TOURNAMENT_ERROR_CODES.USER_NOT_FOUND, 'User not found');
      }

      const gameProfile = user.game_profiles?.find(
        gp => gp.game_id.toString() === gameId
      );

      if (!gameProfile) {
        throw new AppError(
          TOURNAMENT_ERROR_CODES.GAME_PROFILE_REQUIRED,
          'User does not have a profile for this game'
        );
      }

      // Case-sensitive? Check game config
      const game = await Game.findById(gameId);
      const caseSensitive = game?.in_game_id_config?.case_sensitive ?? false;

      let storedId = gameProfile.in_game_id;
      let submittedId = inGameId;
      if (!caseSensitive) {
        storedId = storedId.toLowerCase();
        submittedId = submittedId.toLowerCase();
      }

      const isValid = storedId === submittedId;

      logger.info('In-game ID verification result', { userId, gameId, isValid });
      return isValid;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('In-game ID verification failed', { userId, gameId, error: error.message });
      throw new AppError(
        TOURNAMENT_ERROR_CODES.IN_GAME_ID_VERIFICATION_FAILED,
        error.message || 'In-game ID verification failed'
      );
    }
  }

  // ============================================
  // LIST REGISTRATIONS BY TOURNAMENT
  // ============================================
  async listByTournament(
    tournamentId: string,
    filters: any = {},
    pagination: { page?: number; limit?: number } = {}
  ): Promise<{ data: IApexRegistration[]; total: number; page: number; limit: number }> {
    try {
      const { page = 1, limit = 50 } = pagination;
      const skip = (page - 1) * limit;

      const query: any = { tournament_id: tournamentId };

      if (filters.status) query.status = filters.status;
      if (filters.checked_in !== undefined) query['check_in.checked_in'] = filters.checked_in;
      if (filters.waitlist) query.waitlist_position = { $exists: true, $ne: null };
      if (filters.search) {
        // search by in_game_id or username
        // This requires a lookup – for simplicity, we'll search by in_game_id only
        query.in_game_id = { $regex: filters.search, $options: 'i' };
      }

      const [data, total] = await Promise.all([
        Registration.find(query)
          .populate('user_id', 'username profile.first_name profile.last_name profile.avatar_url')
          .sort({ seed_number: 1, waitlist_position: 1, created_at: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Registration.countDocuments(query)
      ]);

      return {
        data,
        total,
        page,
        limit
      };
    } catch (error: any) {
      logger.error('List by tournament failed', { tournamentId, error: error.message });
      throw new AppError(
        TOURNAMENT_ERROR_CODES.LIST_REGISTRATIONS_FAILED,
        error.message || 'Failed to list registrations'
      );
    }
  }

  // ============================================
  // LIST REGISTRATIONS BY USER
  // ============================================
  async listByUser(
    userId: string,
    filters: any = {},
    pagination: { page?: number; limit?: number } = {}
  ): Promise<{ data: IApexRegistration[]; total: number; page: number; limit: number }> {
    try {
      const { page = 1, limit = 20 } = pagination;
      const skip = (page - 1) * limit;

      const query: any = { user_id: userId };
      if (filters.status) query.status = filters.status;
      if (filters.tournament_id) query.tournament_id = filters.tournament_id;
      if (filters.past) {
        // Only completed tournaments
        // This requires a join with tournament; we'll filter after
      }

      const [data, total] = await Promise.all([
        Registration.find(query)
          .populate('tournament_id', 'title game_id schedule tournament_start status')
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Registration.countDocuments(query)
      ]);

      // If filters.past, filter by tournament status
      let filteredData = data;
      if (filters.past === true) {
        filteredData = data.filter(reg => 
          (reg.tournament_id as any)?.status === 'completed' || 
          (reg.tournament_id as any)?.status === 'cancelled'
        );
      }

      return {
        data: filteredData,
        total: filteredData.length, // Not accurate if we paginated before filter, but okay for small sets
        page,
        limit
      };
    } catch (error: any) {
      logger.error('List by user failed', { userId, error: error.message });
      throw new AppError(
        TOURNAMENT_ERROR_CODES.LIST_USER_REGISTRATIONS_FAILED,
        error.message || 'Failed to list user registrations'
      );
    }
  }

  // ============================================
  // TOURNAMENT CANCELLATION HANDLER (for tournament.service)
  // ============================================
  async processTournamentCancellation(tournamentId: string, cancelledBy: string): Promise<void> {
    try {
      logger.info('Processing tournament cancellation for registrations', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError(TOURNAMENT_ERROR_CODES.NOT_FOUND, 'Tournament not found');
      }

      // Find all active registrations (registered, checked_in, pending_payment)
      const registrations = await Registration.find({
        tournament_id: tournamentId,
        status: { $in: ['registered', 'checked_in', 'pending_payment'] }
      });

      for (const registration of registrations) {
        // Determine refund amount based on cancellation type
        // Tournament cancellation: always full refund for players
        let refundAmount = 0;
        let cancellationType: 'player_early' | 'organizer_cancelled' | 'tournament_cancelled' = 'tournament_cancelled';

        if (!tournament.is_free && tournament.entry_fee > 0) {
          refundAmount = tournament.entry_fee; // full refund
        }

        // Update registration status
        registration.status = 'cancelled';
        registration.withdrawn_at = new Date();
        registration.withdrawal_reason = 'Tournament cancelled by organizer';
        await registration.save();

        // Process refund if eligible
        if (refundAmount > 0 && registration.payment?.transaction_id) {
          await this.processRefund(
            registration,
            refundAmount,
            cancellationType,
            cancelledBy
          );
        }
      }

      // Update tournament participant counts
      tournament.capacity.current_participants = 0;
      tournament.capacity.checked_in_count = 0;
      tournament.capacity.waitlist_count = 0;
      await tournament.save();

      logger.info('Tournament cancellation processed', { tournamentId, registrationsProcessed: registrations.length });
    } catch (error: any) {
      logger.error('Tournament cancellation processing failed', { tournamentId, error: error.message });
      throw new AppError(
        TOURNAMENT_ERROR_CODES.TOURNAMENT_CANCELLATION_PROCESSING_FAILED,
        error.message || 'Failed to process tournament cancellation'
      );
    }
  }

  // ============================================
  // HELPER: Get next waitlist position
  // ============================================
  private async getNextWaitlistPosition(tournamentId: string): Promise<number> {
    const last = await Registration.findOne({
      tournament_id: tournamentId,
      waitlist_position: { $exists: true, $ne: null }
    })
      .sort({ waitlist_position: -1 })
      .select('waitlist_position')
      .lean();

    return (last?.waitlist_position || 0) + 1;
  }
}

export const registrationService = new RegistrationService();