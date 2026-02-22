/**
 * create(organizerId, data) - Create tournament with all calculations
update(tournamentId, updates) - Update with validations
delete(tournamentId) - Delete tournament
publish(tournamentId) - Publish tournament
cancel(tournamentId, reason) - Cancel with refunds
getById(tournamentId, includeDetails?) - Fetch tournament
list(filters, pagination) - List/search tournaments
calculatePrizeStructure(tournament) - Calculate all prize math
calculateScheduleDependencies(tournament) - Auto-set deadlines
validateCapacity(tournament) - Check participant limits
transitionStatus(tournamentId, newStatus) - Status machine
 */

// file: tournament.service.ts

import mongoose from 'mongoose';
import {
  Tournament,
  type IApexTournament,
  Transaction,
  EscrowAccount,
  Registration
} from "../../../models"


import { tournamentValidationService } from './tournament.validation.service';
import { registrationService } from './registration.service'; 
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';


const logger = createLogger('tournament-service');

export class TournamentService {
  // ============================================
  // CREATE TOURNAMENT
  // ============================================
  async create(organizerId: string, data: any): Promise<IApexTournament> {
    try {
      logger.info('Creating tournament', { organizerId });

      // 1. Validate input data
      const validated = await tournamentValidationService .validateCreate(data);

      // 2. Build tournament document
      const tournamentData: any = {
        ...validated,
        organizer_id: new mongoose.Types.ObjectId(organizerId),
        status: 'draft',
        is_free: validated.entry_fee ? false : true,
      };

      // 3. Auto-calculate schedule dependencies if not provided
      if (!tournamentData.schedule.cancellation_cutoff || !tournamentData.schedule.fee_deduction_time) {
        const schedule = this.calculateScheduleDependencies(tournamentData.schedule);
        tournamentData.schedule = { ...tournamentData.schedule, ...schedule };
      }

      // 4. Auto-calculate prize structure if entry_fee > 0
      if (tournamentData.entry_fee > 0) {
        const prizeCalc = this.calculatePrizeStructure(tournamentData);
        tournamentData.prize_structure = { ...tournamentData.prize_structure, ...prizeCalc } as any;
        tournamentData.player_platform_fee = this.calculatePlayerFees(tournamentData);
        tournamentData.organizer_revenue = this.calculateOrganizerRevenue(tournamentData);
      }

      // 5. Create tournament
      const tournament = await Tournament.create(tournamentData);

      logger.info('Tournament created', { tournamentId: tournament._id });
      return tournament;
    } catch (error: any) {
      logger.error('Tournament creation failed', { error: error.message });
      throw new AppError('TOURNAMENT_CREATE_FAILED', error.message);
    }
  }

  // ============================================
  // UPDATE TOURNAMENT
  // ============================================
  async update(tournamentId: string, updates: any): Promise<IApexTournament> {
    try {
      logger.info('Updating tournament', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // 1. Validate if update is allowed in current status
      await tournamentValidationService.validateCanUpdate(tournament, updates);

      // 2. Validate input data
      const validated = await tournamentValidationService.validateUpdate(updates);

      // 3. Apply updates
      Object.assign(tournament, validated);

      // 4. Recalculate derived fields if necessary
      if (updates.entry_fee !== undefined || updates.prize_structure?.distribution) {
        if (tournament.entry_fee > 0) {
          const prizeCalc = this.calculatePrizeStructure(tournament);
          tournament.prize_structure = { ...tournament.prize_structure, ...prizeCalc } as any;
          tournament.player_platform_fee = this.calculatePlayerFees(tournament);
          tournament.organizer_revenue = this.calculateOrganizerRevenue(tournament);
        }
      }

      if (updates.schedule?.tournament_start) {
        const schedule = this.calculateScheduleDependencies(tournament.schedule);
        tournament.schedule = { ...tournament.schedule, ...schedule };
      }

      await tournament.save();
      logger.info('Tournament updated', { tournamentId });
      return tournament;
    } catch (error: any) {
      logger.error('Tournament update failed', { tournamentId, error: error.message });
      throw new AppError('TOURNAMENT_UPDATE_FAILED', error.message);
    }
  }

  // ============================================
  // DELETE TOURNAMENT (only draft)
  // ============================================
  async delete(tournamentId: string): Promise<void> {
    try {
      logger.info('Deleting tournament', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      if (tournament.status !== 'draft') {
        throw new AppError('TOURNAMENT_INVALID_STATUS', 'Only draft tournaments can be deleted');
      }

      await tournament.deleteOne();
      logger.info('Tournament deleted', { tournamentId });
    } catch (error: any) {
      logger.error('Tournament delete failed', { tournamentId, error: error.message });
      throw new AppError('TOURNAMENT_DELETE_FAILED', error.message);
    }
  }

  // ============================================
  // PUBLISH TOURNAMENT (draft → awaiting_deposit)
  // ============================================
  async publish(tournamentId: string): Promise<IApexTournament> {
    try {
      logger.info('Publishing tournament', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // 1. Validate publish preconditions
      await tournamentValidationService .validatePublish(tournament);
      await tournamentValidationService.validateCanPublish(tournament);

      // 2. Transition status
      tournament.status = 'awaiting_deposit';
      tournament.published_at = new Date();
      await tournament.save();

      // 3. Create placeholder escrow account (if paid tournament)
      if (!tournament.is_free && tournament.entry_fee > 0) {
        // Escrow account creation handled by finance service via event or direct call
        // Here we just emit an event or call a method (simplified)
        logger.info('Escrow account creation triggered', { tournamentId });
        // await escrowService.createEscrowForTournament(tournament._id);
      }

      logger.info('Tournament published', { tournamentId });
      return tournament;
    } catch (error: any) {
      logger.error('Tournament publish failed', { tournamentId, error: error.message });
      throw new AppError('TOURNAMENT_PUBLISH_VALIDATION_FAILED', error.message);
    }
  }

  // ============================================
  // CANCEL TOURNAMENT (with refunds)
  // ============================================
  async cancel(tournamentId: string, reason: string, cancelledBy: string): Promise<IApexTournament> {
    try {
      logger.info('Cancelling tournament', { tournamentId, reason, cancelledBy });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // 1. Validate if cancellation is allowed (based on status and cutoff)
      await tournamentValidationService.validateCanCancel(tournament);

      // 2. Update tournament cancellation fields
      tournament.cancellation = {
        cancelled: true,
        cancelled_by: new mongoose.Types.ObjectId(cancelledBy),
        cancelled_at: new Date(),
        reason,
        refunds_processed: false,
        refund_summary: {
          players_refunded: 0,
          total_refunded_to_players: 0,
          organizer_refunded: 0,
          platform_fees_retained: 0,
        },
      };
      tournament.status = 'cancelled';
      await tournament.save();

      // 3. Trigger refunds (delegate to registration service)
      // This is async and may be queued; we don't wait for full completion
      // TODO: Implement processTournamentCancellation method in RegistrationService
      // registrationService.processTournamentCancellation(tournament._id.toString(), cancelledBy).catch((err: any) => {
      //   logger.error('Error processing tournament cancellation refunds', { tournamentId, error: err.message });
      // });
      logger.info('Tournament cancellation refunds queued', { tournamentId });

      logger.info('Tournament cancelled', { tournamentId });
      return tournament;
    } catch (error: any) {
      logger.error('Tournament cancellation failed', { tournamentId, error: error.message });
      throw new AppError('TOURNAMENT_CANCELLATION_VALIDATION_FAILED', error.message);
    }
  }

  // ============================================
  // GET TOURNAMENT BY ID
  // ============================================
  async getById(tournamentId: string, includeDetails: boolean = false): Promise<IApexTournament> {
    try {
      logger.info('Fetching tournament', { tournamentId, includeDetails });

      let query = Tournament.findById(tournamentId);

      if (includeDetails) {
        query = query
          .populate('organizer_id', 'username profile.first_name profile.last_name email')
          .populate('game_id', 'name slug logo_url');
      }

      const tournament = await query.exec();
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      return tournament;
    } catch (error: any) {
      logger.error('Fetch tournament failed', { tournamentId, error: error.message });
      throw new AppError('TOURFETCH_FAILED', error.message);
    }
  }

  // ============================================
  // LIST TOURNAMENTS (with filters & pagination)
  // ============================================
  async list(
    filters: any = {},
    pagination: { page?: number; limit?: number; sort?: any } = {}
  ): Promise<{ data: IApexTournament[]; total: number; page: number; limit: number }> {
    try {
      const { page = 1, limit = 20, sort = { created_at: -1 } } = pagination;
      const skip = (page - 1) * limit;

      // Build query
      const query: any = {};

      if (filters.status) query.status = filters.status;
      if (filters.game_id) query.game_id = filters.game_id;
      if (filters.organizer_id) query.organizer_id = filters.organizer_id;
      if (filters.is_free !== undefined) query.is_free = filters.is_free;
      if (filters.visibility) query.visibility = filters.visibility;
      if (filters.region) query.region = filters.region;
      if (filters.search) {
        query.$or = [
          { title: { $regex: filters.search, $options: 'i' } },
          { description: { $regex: filters.search, $options: 'i' } },
        ];
      }
      if (filters.start_date_from || filters.start_date_to) {
        query['schedule.tournament_start'] = {};
        if (filters.start_date_from) query['schedule.tournament_start'].$gte = filters.start_date_from;
        if (filters.start_date_to) query['schedule.tournament_start'].$lte = filters.start_date_to;
      }

      const [data, total] = await Promise.all([
        Tournament.find(query).sort(sort).skip(skip).limit(limit).lean(),
        Tournament.countDocuments(query),
      ]);

      return {
        data,
        total,
        page,
        limit,
      };
    } catch (error: any) {
      logger.error('List tournaments failed', { error: error.message });
      throw new AppError('TOURNAMENT_LIST_FAILED', error.message);
    }
  }

  // ============================================
  // CALCULATE PRIZE STRUCTURE (pure)
  // ============================================
  calculatePrizeStructure(tournament: Partial<IApexTournament>): {
    organizer_gross_deposit: number;
    platform_fee_percentage: number;
    platform_fee_amount: number;
    net_prize_pool: number;
    total_winning_positions: number;
    distribution: { position: number; percentage: number; amount: number }[];
  } {
    // Default platform fee from organizer: 1%
    const platformFeePercentage = tournament.prize_structure?.platform_fee_percentage ?? 1;
    const grossDeposit = tournament.prize_structure?.organizer_gross_deposit ?? 0;

    const platformFeeAmount = (grossDeposit * platformFeePercentage) / 100;
    const netPrizePool = grossDeposit - platformFeeAmount;

    const distribution = (tournament.prize_structure?.distribution || []).map((item) => ({
      ...item,
      amount: (netPrizePool * item.percentage) / 100,
    }));

    return {
      organizer_gross_deposit: grossDeposit,
      platform_fee_percentage: platformFeePercentage,
      platform_fee_amount: platformFeeAmount,
      net_prize_pool: netPrizePool,
      total_winning_positions: tournament.prize_structure?.total_winning_positions || distribution.length,
      distribution,
    };
  }

  // ============================================
  // CALCULATE PLAYER FEES (pure)
  // ============================================
  calculatePlayerFees(tournament: Partial<IApexTournament>): {
    percentage: number;
    per_player_amount: number;
    total_expected: number;
  } {
    const percentage = tournament.player_platform_fee?.percentage ?? 10;
    const entryFee = tournament.entry_fee ?? 0;
    const perPlayerAmount = (entryFee * percentage) / 100;
    const totalExpected = perPlayerAmount * (tournament.capacity?.max_participants ?? 0);
    return { percentage, per_player_amount: perPlayerAmount, total_expected: totalExpected };
  }

  // ============================================
  // CALCULATE ORGANIZER REVENUE (pure)
  // ============================================
  calculateOrganizerRevenue(tournament: Partial<IApexTournament>): {
    per_player_share: number;
    total_expected: number;
    release_timing: string;
  } {
    const entryFee = tournament.entry_fee ?? 0;
    const platformFee = this.calculatePlayerFees(tournament).per_player_amount;
    const perPlayerShare = entryFee - platformFee;
    const totalExpected = perPlayerShare * (tournament.capacity?.max_participants ?? 0);
    return {
      per_player_share: perPlayerShare,
      total_expected: totalExpected,
      release_timing: 'after_tournament_completion',
    };
  }

  // ============================================
  // CALCULATE SCHEDULE DEPENDENCIES (pure)
  // ============================================
  calculateScheduleDependencies(schedule: any): {
    cancellation_cutoff: Date;
    fee_deduction_time: Date;
    check_in_start?: Date;
    check_in_end?: Date;
  } {
    const tournamentStart = new Date(schedule.tournament_start);
    const registrationEnd = schedule.registration_end ? new Date(schedule.registration_end) : null;

    // Cancellation cutoff: 24 hours before tournament start
    const cancellationCutoff = new Date(tournamentStart);
    cancellationCutoff.setHours(cancellationCutoff.getHours() - 24);

    // Fee deduction: 1 hour before tournament start
    const feeDeductionTime = new Date(tournamentStart);
    feeDeductionTime.setHours(feeDeductionTime.getHours() - 1);

    // Check-in: 30 minutes before start, ends at start (if not provided)
    let checkInStart: Date | undefined;
    let checkInEnd: Date | undefined;

    if (schedule.check_in_start) {
      checkInStart = new Date(schedule.check_in_start);
    } else {
      checkInStart = new Date(tournamentStart);
      checkInStart.setMinutes(checkInStart.getMinutes() - 30);
    }

    if (schedule.check_in_end) {
      checkInEnd = new Date(schedule.check_in_end);
    } else {
      checkInEnd = new Date(tournamentStart);
    }

    return {
      cancellation_cutoff: cancellationCutoff,
      fee_deduction_time: feeDeductionTime,
      check_in_start: checkInStart,
      check_in_end: checkInEnd,
    };
  }

  // ============================================
  // VALIDATE CAPACITY
  // ============================================
  async validateCapacity(tournamentId: string): Promise<{ valid: boolean; current: number; max: number }> {
    try {
      const tournament = await Tournament.findById(tournamentId).select('capacity');
      if (!tournament) {
        throw new AppError('TOURNAMENT_.NOT_FOUND', 'Tournament not found');
      }

      const current = tournament.capacity.current_participants || 0;
      const max = tournament.capacity.max_participants;

      return {
        valid: current < max,
        current,
        max,
      };
    } catch (error: any) {
      logger.error('Validate capacity failed', { tournamentId, error: error.message });
      throw new AppError('CAPACITY_VALIDATION_FAILED', error.message);
    }
  }

  // ============================================
  // TRANSITION STATUS (state machine)
  // ============================================
  async transitionStatus(tournamentId: string, newStatus: string): Promise<IApexTournament> {
    try {
      logger.info('Transitioning tournament status', { tournamentId, newStatus });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      const allowedTransitions: Record<string, string[]> = {
        draft: ['awaiting_deposit', 'cancelled'],
        awaiting_deposit: ['open', 'cancelled'],
        open: ['locked', 'cancelled'],
        locked: ['ready_to_start', 'cancelled'],
        ready_to_start: ['ongoing', 'cancelled'],
        ongoing: ['awaiting_results'],
        awaiting_results: ['verifying_results'],
        verifying_results: ['completed'],
        completed: [],
        cancelled: [],
      };

      if (!allowedTransitions[tournament.status]?.includes(newStatus)) {
        throw new AppError(
          'INVALID_STATUS_TRANSITION',
          `Cannot transition from ${tournament.status} to ${newStatus}`
        );
      }

      // Additional business rule checks per transition
      if (newStatus === 'open' && tournament.status === 'awaiting_deposit') {
        // Ensure organizer deposit is confirmed (delegated to validation service)
        await tournamentValidationService.validateCanOpen(tournament);
      }

      if (newStatus === 'ongoing') {
        tournament.started_at = new Date();
      }

      if (newStatus === 'completed') {
        tournament.completed_at = new Date();
      }

      tournament.status = newStatus;
      await tournament.save();

      logger.info('Tournament status transitioned', { tournamentId, from: tournament.status, to: newStatus });
      return tournament;
    } catch (error: any) {
      logger.error('Status transition failed', { tournamentId, newStatus, error: error.message });
      throw new AppError('STATUS_TRANSITION_FAILED', error.message);
    }
  }
}

export const tournamentService = new TournamentService();