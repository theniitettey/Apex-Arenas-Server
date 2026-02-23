/**
 * ============================================
 * MATCH ORCHESTRATOR
 * ============================================
 * Manages complete match lifecycle:
 * - Ready checks before matches
 * - Auto-forfeit for no-shows
 * - Result submission and verification
 * - Automatic winner advancement
 * - Dispute handling
 */

import mongoose from 'mongoose';
import { Match, IApexMatch } from '../../../models/matches.model';
import { Tournament } from '../../../models/tournaments.model';
import { Registration } from '../../../models/registrations.models';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { redisLock, LockKeys } from '../../../shared/utils/redis-lock.utils';
import { bracketManager } from './bracket.manager';
import { notificationHelper } from '../services/notification.helper';

const logger = createLogger('match-orchestrator');

export interface MatchResult {
  winnerId: string;
  loserId: string;
  score: {
    winner: number;
    loser: number;
  };
  proof?: {
    screenshots?: string[];
    videoUrl?: string;
  };
}

/**
 * Match Orchestrator
 * Coordinates the entire match lifecycle
 */
export class MatchOrchestrator {
  private static instance: MatchOrchestrator;

  private constructor() {}

  public static getInstance(): MatchOrchestrator {
    if (!MatchOrchestrator.instance) {
      MatchOrchestrator.instance = new MatchOrchestrator();
    }
    return MatchOrchestrator.instance;
  }

  /**
   * Start a match (initiate ready check)
   */
  async startMatch(matchId: string): Promise<IApexMatch> {
    return redisLock.executeWithLock(
      LockKeys.matchStatusChange(matchId),
      async () => this._startMatchInternal(matchId),
      { ttl: 10000 }
    );
  }

  private async _startMatchInternal(matchId: string): Promise<IApexMatch> {
    try {
      logger.info('Starting match', { matchId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // Validate match can be started
      if (match.status !== 'pending' && match.status !== 'scheduled') {
        throw new AppError(
          'INVALID_MATCH_STATUS',
          `Cannot start match with status: ${match.status}`
        );
      }

      // Check if all participants are present
      if (match.participants.length < 2) {
        throw new AppError(
          'INSUFFICIENT_PARTICIPANTS',
          'Match needs at least 2 participants'
        );
      }

      // Set match to ready_check status
      match.status = 'ready_check';
      match.schedule.ready_check_time = new Date();
      
      await match.save();

      // Send ready check notifications to participants
      const userIds = match.participants
        .map(p => p.user_id?.toString())
        .filter(Boolean) as string[];

      await notificationHelper.notifyMatchStarting(userIds, match);

      logger.info('Match ready check initiated', { matchId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to start match', { matchId, error: error.message });
      throw new AppError('MATCH_START_FAILED', error.message || 'Failed to start match');
    }
  }

  /**
   * Mark participant as ready
   */
  async markReady(matchId: string, userId: string): Promise<IApexMatch> {
    return redisLock.executeWithLock(
      LockKeys.matchStatusChange(matchId),
      async () => this._markReadyInternal(matchId, userId),
      { ttl: 5000 }
    );
  }

  private async _markReadyInternal(matchId: string, userId: string): Promise<IApexMatch> {
    try {
      logger.info('Marking participant ready', { matchId, userId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // Find participant
      const participant = match.participants.find(
        p => p.user_id?.toString() === userId || p.team_id?.toString() === userId
      );

      if (!participant) {
        throw new AppError('PARTICIPANT_NOT_FOUND', 'Participant not found in match');
      }

      if (participant.is_ready) {
        throw new AppError('ALREADY_READY', 'Participant already marked as ready');
      }

      // Mark as ready
      participant.is_ready = true;
      participant.ready_at = new Date();

      // Check if all participants are ready
      const allReady = match.participants.every(p => p.is_ready);

      if (allReady) {
        // All ready - transition to ongoing
        match.status = 'ongoing';
        match.schedule.started_at = new Date();
        logger.info('All participants ready, match starting', { matchId });
      }

      await match.save();
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to mark ready', { matchId, userId, error: error.message });
      throw new AppError('MARK_READY_FAILED', error.message || 'Failed to mark participant ready');
    }
  }

  /**
   * Submit match result
   */
  async submitResult(
    matchId: string,
    submitterId: string,
    result: MatchResult
  ): Promise<IApexMatch> {
    return redisLock.executeWithLock(
      LockKeys.matchResultSubmission(matchId),
      async () => this._submitResultInternal(matchId, submitterId, result),
      { ttl: 15000 }
    );
  }

  private async _submitResultInternal(
    matchId: string,
    submitterId: string,
    result: MatchResult
  ): Promise<IApexMatch> {
    try {
      logger.info('Submitting match result', { matchId, submitterId, result });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // Validate match status
      if (match.status === 'completed') {
        throw new AppError('MATCH_ALREADY_COMPLETED', 'Match already completed');
      }

      if (match.status !== 'ongoing') {
        throw new AppError(
          'INVALID_MATCH_STATUS',
          `Cannot submit result for match with status: ${match.status}`
        );
      }

      // Validate submitter is a participant
      const submitterParticipant = match.participants.find(
        p => p.user_id?.toString() === submitterId || p.team_id?.toString() === submitterId
      );

      if (!submitterParticipant) {
        throw new AppError('NOT_A_PARTICIPANT', 'Only match participants can submit results');
      }

      // Check if result already submitted
      if (match.result_reported_by) {
        throw new AppError(
          'RESULT_ALREADY_SUBMITTED',
          'Match result has already been submitted. Opponent must confirm or dispute.'
        );
      }

      // Validate winner and loser are participants
      const winnerParticipant = match.participants.find(
        p => p.user_id?.toString() === result.winnerId || p.team_id?.toString() === result.winnerId
      );
      const loserParticipant = match.participants.find(
        p => p.user_id?.toString() === result.loserId || p.team_id?.toString() === result.loserId
      );

      if (!winnerParticipant || !loserParticipant) {
        throw new AppError('INVALID_RESULT', 'Winner and loser must be match participants');
      }

      // Update match with result
      match.result_reported_by = new mongoose.Types.ObjectId(submitterId);
      match.result_reported_at = new Date();
      match.winner_id = new mongoose.Types.ObjectId(result.winnerId);
      match.loser_id = new mongoose.Types.ObjectId(result.loserId);

      // Update participant results
      winnerParticipant.result = 'win';
      winnerParticipant.score = result.score.winner;
      loserParticipant.result = 'loss';
      loserParticipant.score = result.score.loser;

      // Add proof if provided
      if (result.proof) {
        match.proof = {
          screenshots: result.proof.screenshots || [],
          video_url: result.proof.videoUrl,
          submitted_by: new mongoose.Types.ObjectId(submitterId),
          submitted_at: new Date()
        };
      }

      await match.save();

      // Notify opponent to confirm result
      const opponentId = match.participants
        .find(p => 
          (p.user_id?.toString() !== submitterId && p.team_id?.toString() !== submitterId)
        )
        ?.user_id?.toString();

      if (opponentId) {
        await notificationHelper.notifyResultSubmitted(opponentId, match);
      }

      logger.info('Match result submitted, awaiting confirmation', { matchId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to submit result', { matchId, submitterId, error: error.message });
      throw new AppError('RESULT_SUBMISSION_FAILED', error.message || 'Failed to submit match result');
    }
  }

  /**
   * Confirm match result (opponent confirms)
   */
  async confirmResult(matchId: string, confirmerId: string): Promise<IApexMatch> {
    return redisLock.executeWithLock(
      LockKeys.matchResultSubmission(matchId),
      async () => this._confirmResultInternal(matchId, confirmerId),
      { ttl: 15000 }
    );
  }

  private async _confirmResultInternal(matchId: string, confirmerId: string): Promise<IApexMatch> {
    try {
      logger.info('Confirming match result', { matchId, confirmerId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // Validate result was submitted
      if (!match.result_reported_by) {
        throw new AppError('NO_RESULT_SUBMITTED', 'No result has been submitted yet');
      }

      // Validate confirmer is the opponent
      if (match.result_reported_by.toString() === confirmerId) {
        throw new AppError('CANNOT_CONFIRM_OWN_RESULT', 'Cannot confirm your own result submission');
      }

      // Validate confirmer is a participant
      const confirmerParticipant = match.participants.find(
        p => p.user_id?.toString() === confirmerId || p.team_id?.toString() === confirmerId
      );

      if (!confirmerParticipant) {
        throw new AppError('NOT_A_PARTICIPANT', 'Only match participants can confirm results');
      }

      // Update match status to completed
      match.status = 'completed';
      match.schedule.completed_at = new Date();
      match.result_confirmed_by = new mongoose.Types.ObjectId(confirmerId);
      match.result_confirmed_at = new Date();

      await match.save();

      // Advance winner to next match
      if (match.next_match_id) {
        await bracketManager.advanceWinner(matchId);
      }

      logger.info('Match result confirmed, match completed', { matchId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to confirm result', { matchId, confirmerId, error: error.message });
      throw new AppError('RESULT_CONFIRMATION_FAILED', error.message || 'Failed to confirm match result');
    }
  }

  /**
   * Dispute match result
   */
  async disputeResult(
    matchId: string,
    disputerId: string,
    reason: string,
    evidence?: string[]
  ): Promise<IApexMatch> {
    try {
      logger.info('Disputing match result', { matchId, disputerId, reason });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // Validate result was submitted
      if (!match.result_reported_by) {
        throw new AppError('NO_RESULT_SUBMITTED', 'No result has been submitted to dispute');
      }

      // Validate disputer is a participant
      const disputerParticipant = match.participants.find(
        p => p.user_id?.toString() === disputerId || p.team_id?.toString() === disputerId
      );

      if (!disputerParticipant) {
        throw new AppError('NOT_A_PARTICIPANT', 'Only match participants can dispute results');
      }

      // Update match with dispute
      match.status = 'disputed';
      match.dispute = {
        is_disputed: true,
        disputed_by: new mongoose.Types.ObjectId(disputerId),
        dispute_reason: reason,
        disputed_at: new Date(),
        evidence: evidence || [],
        resolved: false,
        resolution: undefined,
        resolved_at: undefined,
        resolved_by: undefined
      };

      await match.save();

      // Notify tournament organizer and admins
      const tournament = await Tournament.findById(match.tournament_id);
      if (tournament) {
        await notificationHelper.notifyResultDisputed(
          [tournament.organizer_id.toString()],
          match
        );
      }

      logger.info('Match result disputed', { matchId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to dispute result', { matchId, disputerId, error: error.message });
      throw new AppError('DISPUTE_SUBMISSION_FAILED', error.message || 'Failed to dispute match result');
    }
  }

  /**
   * Resolve dispute (admin/organizer only)
   */
  async resolveDispute(
    matchId: string,
    resolverId: string,
    winnerId: string,
    resolution: string
  ): Promise<IApexMatch> {
    return redisLock.executeWithLock(
      LockKeys.matchResultSubmission(matchId),
      async () => this._resolveDisputeInternal(matchId, resolverId, winnerId, resolution),
      { ttl: 15000 }
    );
  }

  private async _resolveDisputeInternal(
    matchId: string,
    resolverId: string,
    winnerId: string,
    resolution: string
  ): Promise<IApexMatch> {
    try {
      logger.info('Resolving dispute', { matchId, resolverId, winnerId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      if (!match.dispute?.is_disputed) {
        throw new AppError('NO_DISPUTE', 'Match is not disputed');
      }

      // Store original winner if this is an override
      const originalWinnerId = match.winner_id;

      // Update match with resolution
      match.dispute.resolved = true;
      match.dispute.resolution = resolution;
      match.dispute.resolved_at = new Date();
      match.dispute.resolved_by = new mongoose.Types.ObjectId(resolverId);

      // Update winner
      match.winner_id = new mongoose.Types.ObjectId(winnerId);
      const loserId = match.participants.find(
        p => p.user_id?.toString() !== winnerId && p.team_id?.toString() !== winnerId
      );
      if (loserId) {
        match.loser_id = loserId.user_id || loserId.team_id;
      }

      // Update participant results
      match.participants.forEach(p => {
        if (p.user_id?.toString() === winnerId || p.team_id?.toString() === winnerId) {
          p.result = 'win';
        } else {
          p.result = 'loss';
        }
      });

      // Mark as completed
      match.status = 'completed';
      match.schedule.completed_at = new Date();

      // Add admin override record if winner changed
      if (originalWinnerId?.toString() !== winnerId) {
        match.admin_override = {
          overridden: true,
          overridden_by: new mongoose.Types.ObjectId(resolverId),
          overridden_at: new Date(),
          reason: resolution,
          original_winner_id: originalWinnerId
        };
      }

      await match.save();

      // Advance winner to next match
      if (match.next_match_id) {
        await bracketManager.advanceWinner(matchId);
      }

      // Notify participants
      const userIds = match.participants
        .map(p => p.user_id?.toString())
        .filter(Boolean) as string[];

      await notificationHelper.notifyDisputeResolved(userIds, match, winnerId);

      logger.info('Dispute resolved', { matchId, winnerId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to resolve dispute', { matchId, resolverId, error: error.message });
      throw new AppError('DISPUTE_RESOLUTION_FAILED', error.message || 'Failed to resolve dispute');
    }
  }

  /**
   * Auto-forfeit no-show participant
   */
  async forfeitNoShow(matchId: string, noShowUserId: string): Promise<IApexMatch> {
    return redisLock.executeWithLock(
      LockKeys.matchResultSubmission(matchId),
      async () => this._forfeitNoShowInternal(matchId, noShowUserId),
      { ttl: 10000 }
    );
  }

  private async _forfeitNoShowInternal(matchId: string, noShowUserId: string): Promise<IApexMatch> {
    try {
      logger.info('Forfeiting no-show participant', { matchId, noShowUserId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      // Find no-show participant
      const noShowParticipant = match.participants.find(
        p => p.user_id?.toString() === noShowUserId || p.team_id?.toString() === noShowUserId
      );

      if (!noShowParticipant) {
        throw new AppError('PARTICIPANT_NOT_FOUND', 'Participant not found in match');
      }

      // Find opponent (winner by forfeit)
      const opponent = match.participants.find(
        p => p.user_id?.toString() !== noShowUserId && p.team_id?.toString() !== noShowUserId
      );

      if (!opponent) {
        throw new AppError('OPPONENT_NOT_FOUND', 'Opponent not found');
      }

      // Update match
      noShowParticipant.result = 'no_show';
      opponent.result = 'win';
      
      match.winner_id = opponent.user_id || opponent.team_id;
      match.loser_id = noShowParticipant.user_id || noShowParticipant.team_id;
      match.status = 'completed';
      match.schedule.completed_at = new Date();

      await match.save();

      // Advance winner
      if (match.next_match_id) {
        await bracketManager.advanceWinner(matchId);
      }

      logger.info('No-show forfeit applied', { matchId, noShowUserId });
      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to forfeit no-show', { matchId, noShowUserId, error: error.message });
      throw new AppError('FORFEIT_FAILED', error.message || 'Failed to forfeit no-show');
    }
  }

  /**
   * Get match by ID with full details
   */
  async getMatch(matchId: string): Promise<IApexMatch> {
    try {
      const match = await Match.findById(matchId)
        .populate('participants.user_id', 'username profile.first_name profile.last_name')
        .populate('participants.team_id', 'name tag logo_url')
        .populate('tournament_id', 'title game_id status');

      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      return match;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to get match', { matchId, error: error.message });
      throw new AppError('GET_MATCH_FAILED', error.message || 'Failed to get match');
    }
  }
}

// Export singleton instance
export const matchOrchestrator = MatchOrchestrator.getInstance();