import mongoose from 'mongoose';
import {
  Match,
  Tournament,
  Registration,
  User,
  type IApexMatch
} from '../../../models';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { notificationHelper } from './notification.helper';

const logger = createLogger('match-service');



export class MatchService {
  // ============================================
  // GET MATCH BY ID
  // ============================================
  async getById(
    matchId: string,
    includeParticipants: boolean = false
  ): Promise<IApexMatch> {
    try {
      logger.info('Fetching match', { matchId, includeParticipants });

      let query = Match.findById(matchId);

      if (includeParticipants) {
        query = query
          .populate('participants.user_id', 'username profile.first_name profile.last_name profile.avatar_url')
          .populate('participants.team_id', 'name tag logo_url')
          .populate('tournament_id', 'title game_id tournament_type format')
          .populate('next_match_id')
          .populate('previous_match_ids');
      }

      const match = await query.exec();
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Fetch match failed', { matchId, error: error.message });
      throw new AppError(
        'MATCH_NOT_FOUND',
        error.message || 'Failed to fetch match'
      );
    }
  }

  // ============================================
  // SUBMIT RESULT (Player reports)
  // ============================================
  async submitResult(
    matchId: string,
    userId: string,
    winnerId: string,
    proof?: { screenshots?: string[]; video_url?: string }
  ): Promise<IApexMatch> {
    try {
      logger.info('Submitting match result', { matchId, userId, winnerId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // 1. Check match status – only allow if status is 'ongoing' or 'scheduled'
      if (!['ongoing', 'scheduled', 'ready_check'].includes(match.status)) {
        throw new AppError(
          'MATCH_INVALID_STATUS',
          `Cannot submit result when match status is ${match.status}`
        );
      }

      // 2. Verify user is a participant
      const isParticipant = match.participants.some(
        p => p.user_id?.toString() === userId || p.team_id?.toString() === userId
      );
      if (!isParticipant) {
        throw new AppError(
          'MATCH_UNAUTHORIZED',
          'Only participants can submit match results'
        );
      }

      // 3. Verify winner is a participant
      const winnerParticipant = match.participants.find(
        p => p.user_id?.toString() === winnerId || p.team_id?.toString() === winnerId
      );
      if (!winnerParticipant) {
        throw new AppError(
          'MATCH_INVALID_WINNER',
          'Winner must be a participant of this match'
        );
      }

      // 4. Check if result already submitted (to prevent overwriting)
      if (match.result_reported_by) {
        throw new AppError(
          'MATCH_RESULT_ALREADY_SUBMITTED',
          'Result already submitted by a player'
        );
      }

      // 5. Update match with result submission
      match.result_reported_by = new mongoose.Types.ObjectId(userId);
      match.result_reported_at = new Date();
      match.winner_id = new mongoose.Types.ObjectId(winnerId);
      match.proof = {
        screenshots: proof?.screenshots || [],
        video_url: proof?.video_url,
        submitted_by: new mongoose.Types.ObjectId(userId),
        submitted_at: new Date()
      };
      // Set status to 'pending_confirmation' – we can add this status or use 'disputed'? 
      // Better to add 'pending_confirmation' to enum? We'll use 'completed' only after confirmation.
      // For now, we'll keep status as 'ongoing' but mark that result is submitted.
      // We'll add a custom field or just rely on result_reported_by flag.
      // To avoid changing model, we'll just update result_reported_by and leave status.
      // The frontend will check if result_reported_by exists and not confirmed yet.
      await match.save();

      // 6. Notify opponent to confirm
      const opponent = match.participants.find(
        p => p.user_id?.toString() !== userId && p.team_id?.toString() !== userId
      );
      if (opponent?.user_id) {
        await notificationHelper.notifyResultSubmitted(opponent.user_id.toString(), match);
      }

      logger.info('Match result submitted', { matchId, userId, winnerId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Submit result failed', { matchId, error: error.message });
      throw new AppError(
        'MATCH_RESULT_SUBMIT_FAILED',
        error.message || 'Failed to submit result'
      );
    }
  }

  // ============================================
  // CONFIRM RESULT (Opponent confirms)
  // ============================================
  async confirmResult(matchId: string, userId: string): Promise<IApexMatch> {
    try {
      logger.info('Confirming match result', { matchId, userId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // Find the participant who submitted the result (by their user_id)
      const submitterParticipant = match.participants.find(
        p => p.user_id?.toString() === match.result_reported_by?.toString()
      );

      // The confirming user must be a participant, but NOT the one who submitted
      const isOpponent = match.participants.some(p => {
        const isThisUser = 
          p.user_id?.toString() === userId || 
          p.team_id?.toString() === userId;

        const isSubmitter = submitterParticipant
          ? (p.user_id?.toString() === submitterParticipant.user_id?.toString() ||
            p.team_id?.toString() === submitterParticipant.team_id?.toString())
          : false;

        return isThisUser && !isSubmitter;
      });

      if (!isOpponent) {
        throw new AppError(
          'MATCH_UNAUTHORIZED',
          'Only the opponent can confirm the result'
        );
      }

      // 2. Check that result was submitted
      if (!match.result_reported_by) {
        throw new AppError(
          'MATCH_CONFIRMATION_FAILED',
          'No result has been submitted yet'
        );
      }

      // 3. Check match is not already completed or disputed
      if (match.status === 'completed') {
        throw new AppError(
          'MATCH_ALREADY_COMPLETED',
          'Match is already completed'
        );
      }
      if (match.dispute?.is_disputed) {
        throw new AppError(
          'MATCH_ALREADY_DISPUTED',
          'Match is under dispute, cannot confirm'
        );
      }

      // 4. Update match as confirmed
      match.result_confirmed_by = new mongoose.Types.ObjectId(userId);
      match.result_confirmed_at = new Date();
      match.status = 'completed';
      match.schedule.completed_at = new Date();

      // 5. Set loser_id
      const loser = match.participants.find(
        p => p.user_id?.toString() !== match.winner_id?.toString() &&
             p.team_id?.toString() !== match.winner_id?.toString()
      );
      if (loser) {
        match.loser_id = loser.user_id || loser.team_id;
      }

      // 6. Update participant results
      match.participants.forEach(p => {
        if (p.user_id?.toString() === match.winner_id?.toString() ||
            p.team_id?.toString() === match.winner_id?.toString()) {
          p.result = 'win';
          p.score = match.format.games_to_win; // or actual score if provided
        } else {
          p.result = 'loss';
        }
      });

      await match.save();

      // 7. Advance winner to next match
      await this.advanceWinner(matchId);

      logger.info('Match result confirmed', { matchId, userId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Confirm result failed', { matchId, error: error.message });
      throw new AppError(
        'MATCH_CONFIRMATION_FAILED',
        error.message || 'Failed to confirm result'
      );
    }
  }

  // ============================================
  // DISPUTE RESULT
  // ============================================
  async disputeResult(
    matchId: string,
    userId: string,
    reason: string,
    evidence?: string[]
  ): Promise<IApexMatch> {
    try {
      logger.info('Disputing match result', { matchId, userId, reason });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // 1. Verify user is a participant
      const isParticipant = match.participants.some(
        p => p.user_id?.toString() === userId || p.team_id?.toString() === userId
      );
      if (!isParticipant) {
        throw new AppError(
          'MATCH_UNAUTHORIZED',
          'Only participants can dispute a result'
        );
      }

      // 2. Check that result was submitted
      if (!match.result_reported_by) {
        throw new AppError(
          'MATCH_DISPUTE_FAILED',
          'No result has been submitted yet'
        );
      }

      // 3. Check not already disputed
      if (match.dispute?.is_disputed) {
        throw new AppError(
          'MATCH_ALREADY_DISPUTED',
          'Match is already under dispute'
        );
      }

      // 4. Set dispute details
      match.dispute = {
        is_disputed: true,
        disputed_by: new mongoose.Types.ObjectId(userId),
        dispute_reason: reason,
        disputed_at: new Date(),
        evidence: evidence || [],
        resolved: false
      };
      match.status = 'disputed';
      await match.save();

      // 5. Notify tournament organizer
      const tournament = await Tournament.findById(match.tournament_id);
      if (tournament) {
        await notificationHelper.notifyResultDisputed(
          [tournament.organizer_id.toString()],
          match
        );
      }

      logger.info('Match dispute created', { matchId, userId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Dispute result failed', { matchId, error: error.message });
      throw new AppError(
        'MATCH_DISPUTE_FAILED',
        error.message || 'Failed to dispute result'
      );
    }
  }

  // ============================================
  // RESOLVE DISPUTE (Organizer)
  // ============================================
  async resolveDispute(
    matchId: string,
    organizerId: string,
    winnerId: string,
    resolution: string
  ): Promise<IApexMatch> {
    try {
      logger.info('Resolving match dispute', { matchId, organizerId, winnerId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // 1. Verify user is tournament organizer
      const tournament = await Tournament.findById(match.tournament_id);
      if (!tournament || tournament.organizer_id.toString() !== organizerId) {
        throw new AppError(
          'MATCH_UNAUTHORIZED',
          'Only tournament organizer can resolve disputes'
        );
      }

      // 2. Check match is disputed
      if (!match.dispute?.is_disputed) {
        throw new AppError(
          'MATCH_RESOLVE_FAILED',
          'Match is not under dispute'
        );
      }

      // 3. Verify winner is a participant
      const winnerParticipant = match.participants.find(
        p => p.user_id?.toString() === winnerId || p.team_id?.toString() === winnerId
      );
      if (!winnerParticipant) {
        throw new AppError(
          'MATCH_INVALID_WINNER',
          'Winner must be a participant of this match'
        );
      }

      // 4. Update match with resolution
      match.dispute.resolved = true;
      match.dispute.resolution = resolution;
      match.dispute.resolved_at = new Date();
      match.dispute.resolved_by = new mongoose.Types.ObjectId(organizerId);
      
      match.winner_id = new mongoose.Types.ObjectId(winnerId);
      match.status = 'completed';
      match.schedule.completed_at = new Date();

      // Set loser
      const loser = match.participants.find(
        p => p.user_id?.toString() !== winnerId && p.team_id?.toString() !== winnerId
      );
      if (loser) {
        match.loser_id = loser.user_id || loser.team_id;
      }

      // Update participant results
      match.participants.forEach(p => {
        if (p.user_id?.toString() === winnerId || p.team_id?.toString() === winnerId) {
          p.result = 'win';
        } else {
          p.result = 'loss';
        }
      });

      await match.save();

      // 5. Advance winner
      await this.advanceWinner(matchId);

      // 6. Notify participants
      await notificationHelper.notifyDisputeResolved(
        match.participants.map(p => p.user_id?.toString()).filter(Boolean) as string[],
        match,
        winnerId
      );

      logger.info('Match dispute resolved', { matchId, winnerId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Resolve dispute failed', { matchId, error: error.message });
      throw new AppError(
        'MATCH_RESOLVE_FAILED',
        error.message || 'Failed to resolve dispute'
      );
    }
  }

  // ============================================
  // ADMIN OVERRIDE
  // ============================================
  async adminOverride(
    matchId: string,
    adminId: string,
    winnerId: string,
    reason: string
  ): Promise<IApexMatch> {
    try {
      logger.info('Admin overriding match result', { matchId, adminId, winnerId, reason });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_.NOT_FOUND', 'Match not found');
      }

      // 1. Verify winner is a participant
      const winnerParticipant = match.participants.find(
        p => p.user_id?.toString() === winnerId || p.team_id?.toString() === winnerId
      );
      if (!winnerParticipant) {
        throw new AppError(
          'MATCH_INVALID_WINNER',
          'Winner must be a participant of this match'
        );
      }

      // 2. Store original winner if exists
      const originalWinner = match.winner_id?.toString();

      // 3. Set admin override
      match.admin_override = {
        overridden: true,
        overridden_by: new mongoose.Types.ObjectId(adminId),
        overridden_at: new Date(),
        reason,
        original_winner_id: originalWinner ? new mongoose.Types.ObjectId(originalWinner) : undefined
      };

      // 4. Override winner
      match.winner_id = new mongoose.Types.ObjectId(winnerId);
      match.status = 'completed';
      match.schedule.completed_at = new Date();

      // Set loser
      const loser = match.participants.find(
        p => p.user_id?.toString() !== winnerId && p.team_id?.toString() !== winnerId
      );
      if (loser) {
        match.loser_id = loser.user_id || loser.team_id;
      }

      // Update participant results
      match.participants.forEach(p => {
        if (p.user_id?.toString() === winnerId || p.team_id?.toString() === winnerId) {
          p.result = 'win';
        } else {
          p.result = 'loss';
        }
      });

      await match.save();

      // 5. Advance winner
      await this.advanceWinner(matchId);

      logger.info('Match admin override completed', { matchId, adminId, winnerId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Admin override failed', { matchId, error: error.message });
      throw new AppError(
        'MATCH_OVERRIDE_FAILED',
        error.message || 'Failed to override match result'
      );
    }
  }

  // ============================================
  // ADVANCE WINNER TO NEXT MATCH
  // ============================================
  async advanceWinner(matchId: string): Promise<void> {
    try {
      logger.info('Advancing winner to next match', { matchId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      if (!match.next_match_id) {
        logger.info('No next match defined, winner is tournament champion', { matchId });
        return;
      }

      if (!match.winner_id) {
        throw new AppError(
          'MATCH_ADVANCE_FAILED',
          'Cannot advance: match has no winner'
        );
      }

      const nextMatch = await Match.findById(match.next_match_id);
      if (!nextMatch) {
        throw new AppError(
          'MATCH_NOT_FOUND',
          'Next match not found'
        );
      }

      // Find the winner participant from current match
      const winnerParticipant = match.participants.find(
        p => p.user_id?.toString() === match.winner_id?.toString() ||
             p.team_id?.toString() === match.winner_id?.toString()
      );

      if (!winnerParticipant) {
        throw new AppError(
          'MATCH_ADVANCE_FAILED',
          'Winner participant not found in match'
        );
      }

      // Add winner to next match participants
      // Determine which slot (participant 0 or 1) needs to be filled
      const emptySlotIndex = nextMatch.participants.findIndex(p => !p.user_id && !p.team_id);
      if (emptySlotIndex === -1) {
        // Both slots are already filled – this shouldn't happen in single elim
        logger.warn('Next match already has both participants', { nextMatchId: nextMatch._id });
        return;
      }

      nextMatch.participants[emptySlotIndex] = {
        user_id: winnerParticipant.user_id,
        team_id: winnerParticipant.team_id,
        in_game_id: winnerParticipant.in_game_id,
        seed_number: winnerParticipant.seed_number,
        score: 0,
        result: 'pending',
        is_ready: false
      };

      await nextMatch.save();

      logger.info('Winner advanced to next match', {
        matchId,
        nextMatchId: nextMatch._id,
        slot: emptySlotIndex
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Advance winner failed', { matchId, error: error.message });
      throw new AppError(
        'MATCH_ADVANCE_FAILED',
        error.message || 'Failed to advance winner'
      );
    }
  }

  // ============================================
  // UPDATE MATCH STATUS (State machine)
  // ============================================
  async updateMatchStatus(matchId: string, newStatus: string): Promise<IApexMatch> {
    try {
      logger.info('Updating match status', { matchId, newStatus });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      const allowedTransitions: Record<string, string[]> = {
        pending: ['scheduled', 'cancelled'],
        scheduled: ['ready_check', 'ongoing', 'cancelled'],
        ready_check: ['ongoing', 'cancelled'],
        ongoing: ['completed', 'disputed', 'cancelled'],
        disputed: ['completed', 'cancelled'],
        completed: [],
        cancelled: []
      };

      if (!allowedTransitions[match.status]?.includes(newStatus)) {
        throw new AppError(
          'MATCH_STATUS_TRANSITION_FAILED',
          `Cannot transition from ${match.status} to ${newStatus}`
        );
      }

      // Additional business rules
      if (newStatus === 'ongoing' && match.status === 'scheduled') {
        match.schedule.started_at = new Date();
      }
      if (newStatus === 'completed') {
        match.schedule.completed_at = new Date();
      }
      if (newStatus === 'ready_check') {
        match.schedule.ready_check_time = new Date();
      }

      match.status = newStatus;
      await match.save();

      logger.info('Match status updated', { matchId, from: match.status, to: newStatus });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Update match status failed', { matchId, newStatus, error: error.message });
      throw new AppError(
        'MATCH_STATUS_TRANSITION_FAILED',
        error.message || 'Failed to update match status'
      );
    }
  }

  // ============================================
  // AUTO FORFEIT (No-show handling)
  // ============================================
  async autoForfeit(matchId: string): Promise<IApexMatch> {
    try {
      logger.info('Auto-forfeiting match due to no-show', { matchId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // Only applicable for scheduled or ready_check status
      if (!['scheduled', 'ready_check', 'ongoing'].includes(match.status)) {
        throw new AppError(
          'MATCH_INVALID_STATUS',
          `Cannot auto-forfeit match with status ${match.status}`
        );
      }

      // Determine which participant is no-show (not ready)
      const noShowParticipant = match.participants.find(p => !p.is_ready);
      if (!noShowParticipant) {
        throw new AppError(
          'MATCH_AUTO_FORFEIT_FAILED',
          'No participant marked as not ready'
        );
      }

      // The other participant is winner
      const winner = match.participants.find(p => p !== noShowParticipant);
      if (!winner) {
        throw new AppError(
          'MATCH_AUTO_FORFEIT_FAILED',
          'Could not determine winner'
        );
      }

      // Set winner and loser
      match.winner_id = winner.user_id || winner.team_id;
      match.loser_id = noShowParticipant.user_id || noShowParticipant.team_id;
      
      // Update participant results
      match.participants.forEach(p => {
        if (p === winner) {
          p.result = 'win';
        } else {
          p.result = 'no_show';
        }
      });

      match.status = 'completed';
      match.schedule.completed_at = new Date();

      // Add to proof/notes
      match.proof = {
        screenshots: [],
        submitted_by: match.participants[0]?.user_id, // placeholder
        submitted_at: new Date()
      };

      await match.save();

      // Advance winner
      await this.advanceWinner(matchId);

      logger.info('Match auto-forfeited', { matchId, winnerId: match.winner_id });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Auto forfeit failed', { matchId, error: error.message });
      throw new AppError(
        'MATCH_AUTO_FORFEIT_FAILED',
        error.message || 'Failed to auto-forfeit match'
      );
    }
  }

  // ============================================
  // LIST MATCHES BY TOURNAMENT
  // ============================================
  async listByTournament(
    tournamentId: string,
    round?: number,
    options: { status?: string; bracket_position?: string } = {}
  ): Promise<IApexMatch[]> {
    try {
      logger.info('Listing matches for tournament', { tournamentId, round });

      const query: any = { tournament_id: tournamentId };
      if (round !== undefined) query.round = round;
      if (options.status) query.status = options.status;
      if (options.bracket_position) query.bracket_position = options.bracket_position;

      const matches = await Match.find(query)
        .sort({ round: 1, match_number: 1 })
        .populate('participants.user_id', 'username profile.first_name profile.last_name')
        .populate('participants.team_id', 'name tag')
        .lean();

      return matches;
    } catch (error: any) {
      logger.error('List matches by tournament failed', { tournamentId, error: error.message });
      throw new AppError(
        'MATCH_LIST_FAILED',
        error.message || 'Failed to list matches'
      );
    }
  }
}

export const matchService = new MatchService();