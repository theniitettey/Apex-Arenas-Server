import mongoose from 'mongoose';
import {
  Tournament,
  Registration,
  User,
  EscrowAccount,
  PayoutRequest,
  Transaction,
  Game,  
  type IApexTournament,

} from '../../../models'

import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';

const logger = createLogger('tournament-results-service');

export class TournamentResultsService {
  // ============================================
  // SUBMIT RESULTS (Organizer)
  // ============================================
  async submitResults(
    tournamentId: string,
    organizerId: string,
    winnersData: Array<{ position: number; in_game_id: string }>
  ): Promise<IApexTournament> {
    try {
      logger.info('Submitting tournament results', { tournamentId, organizerId });

      // 1. Fetch tournament
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // 2. Authorization: ensure organizer is the one submitting
      if (tournament.organizer_id.toString() !== organizerId) {
        throw new AppError(
          'TOURNAMENT_ORGANIZER_NOT_AUTHENTICATED',
          'Only the tournament organizer can submit results'
        );
      }

      // 3. Status check – must be 'awaiting_results'
      if (tournament.status !== 'awaiting_results') {
        throw new AppError(
          'TOURNAMENT_INVALID_STATUS',
          `Results can only be submitted when tournament is awaiting_results, current: ${tournament.status}`
        );
      }

      // 4. Validate winners data
      if (!winnersData || winnersData.length === 0) {
        throw new AppError(
          'TOURNAMENT_WINNERS_RESULTS_EMPTY',
          'Winners data cannot be empty'
        );
      }

      // Check for duplicate positions
      const positions = winnersData.map(w => w.position);
      if (new Set(positions).size !== winnersData.length) {
        throw new AppError(
          'TOURNAMENT_DUPLICATE_POSITION',
          'Duplicate positions are not allowed'
        );
      }

      // Check that positions are positive integers and within expected range
      if (positions.some(p => !Number.isInteger(p) || p <= 0)) {
        throw new AppError(
          'TOURNAMENT_INVALID_POSITION',
          'Positions must be positive integers'
        );
      }

      // Optional: validate that the number of winners matches prize_structure.total_winning_positions
      if (tournament.prize_structure?.total_winning_positions &&
          winnersData.length !== tournament.prize_structure.total_winning_positions) {
        logger.warn('Number of submitted winners does not match prize structure', {
          tournamentId,
          submitted: winnersData.length,
          expected: tournament.prize_structure.total_winning_positions
        });
        // We don't throw an error – organizers can submit fewer winners if positions are unclaimed
      }

      // 5. Store results in tournament
      tournament.results = {
        submitted_by: new mongoose.Types.ObjectId(organizerId),
        submitted_at: new Date(),
        winners: winnersData.map(w => ({
          position: w.position,
          in_game_id: w.in_game_id,
          user_id: null as any, // will be populated during verification
          verified: false
        })) as [{ position: number; in_game_id: string; user_id: mongoose.Types.ObjectId; verified: boolean }],
        verification_status: 'pending',
        verified_at: new Date()
      };

      // 6. Transition status
      tournament.status = 'verifying_results';
      await tournament.save();

      // 7. Trigger async verification (optional: could be done immediately or via queue)
      // For simplicity, we call verifyWinners here, but in production you might queue it.
      // We'll do it async without awaiting to not block response.
      this.verifyWinners(tournamentId).catch(async (err) => {
        logger.error('Auto-verification failed', { tournamentId, error: err.message });
        // Mark the tournament so admins can find and manually intervene
        await Tournament.findByIdAndUpdate(tournamentId, {
          'results.verification_status': 'failed',
          'results.failure_reason': err.message
        }).catch(updateErr => {
          logger.error('Could not mark verification failure on tournament', {
            tournamentId, error: updateErr.message
          });
        });
      });

      logger.info('Tournament results submitted, verification started', { tournamentId });
      return tournament;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Submit results failed', { tournamentId, error: error.message });
      throw new AppError(
        'TOURNAMENT_RESULTS_SUBMISSION_FAILED',
        error.message || 'Results submission failed'
      );
    }
  }

  // ============================================
  // VERIFY WINNERS (Match in-game IDs to registrations)
  // ============================================
  async verifyWinners(tournamentId: string): Promise<IApexTournament> {
    try {
      logger.info('Verifying tournament winners', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      if (tournament.status !== 'verifying_results') {
        throw new AppError(
          'TOURNAMENT_INVALID_STATUS',
          `Cannot verify winners: tournament status is ${tournament.status}`
        );
      }

      if (!tournament.results || !tournament.results.winners) {
        throw new AppError(
          'TOURNAMENT_RESULTS_NOT_FOUND',
          'No results found to verify'
        );
      }

      // Get game config for in-game ID case sensitivity
      const game = await Game.findById(tournament.game_id);
      const caseSensitive = game?.in_game_id_config?.case_sensitive ?? false;

      // Get all registrations for this tournament (only registered/checked_in status)
      const registrations = await Registration.find({
        tournament_id: tournamentId,
        status: { $in: ['registered', 'checked_in'] }
      }).select('user_id in_game_id');

      // Build lookup map: in_game_id -> user_id
      const registrationMap = new Map<string, mongoose.Types.ObjectId>();
      registrations.forEach(reg => {
        let key = reg.in_game_id;
        if (!caseSensitive) key = key.toLowerCase();
        registrationMap.set(key, reg.user_id);
      });

      // Verify each winner
      let allVerified = true;
      for (const winner of tournament.results.winners) {
        let lookupId = winner.in_game_id;
        if (!caseSensitive) lookupId = lookupId.toLowerCase();

        const matchedUserId = registrationMap.get(lookupId);
        if (matchedUserId) {
          winner.user_id = matchedUserId;
          winner.verified = true;
          // Also update match_status in the structure (for escrow tracking)
          // We'll need to update the winner_submissions in escrow account later.
        } else {
          winner.verified = false;
          allVerified = false;
          logger.warn('Winner in-game ID not matched to any registration', {
            tournamentId,
            in_game_id: winner.in_game_id,
            position: winner.position
          });
        }
      }

      tournament.results.verification_status = allVerified ? 'verified' : 'pending';
      if (allVerified) {
        tournament.results.verified_at = new Date();
      }
      await tournament.save();

      // If all winners are verified, we can proceed to prize distribution
      if (allVerified) {
        logger.info('All winners verified, proceeding to prize distribution', { tournamentId });
        // Trigger distribution – again async
        this.distributePrizes(tournamentId).catch(async (err) => {
          logger.error('Prize distribution failed', { tournamentId, error: err.message });
          await Tournament.findByIdAndUpdate(tournamentId, {
            'results.verification_status': 'distribution_failed',
            'results.failure_reason': err.message
          }).catch(updateErr => {
            logger.error('Could not mark distribution failure on tournament', {
              tournamentId, error: updateErr.message
            });
          });
        });
      } else {
        // If not all verified, tournament remains in verifying_results
        // Organizer may need to correct submissions
        logger.warn('Some winners could not be verified', { tournamentId });
      }

      return tournament;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Verify winners failed', { tournamentId, error: error.message });
      throw new AppError(
        'TOURNAMENT_WINNER_VERIFICATION_FAILED',
        error.message || 'Winner verification failed'
      );
    }
  }

  // ============================================
  // DISTRIBUTE PRIZES
  // ============================================
  async distributePrizes(tournamentId: string): Promise<void> {
    try {
      logger.info('Distributing tournament prizes', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // Free tournaments have no prizes
      if (tournament.is_free || tournament.entry_fee === 0) {
        logger.info('Free tournament no prizes to distribute', { tournamentId });
        tournament.status = 'completed';
        tournament.completed_at = new Date();
        await tournament.save();
        return;
      }

      // Ensure winners are verified
      if (tournament.results?.verification_status !== 'verified') {
        throw new AppError(
          'TOURNAMENT_WINNERS_NOT_VERIFIED',
          'Cannot distribute prizes: winners are not verified'
        );
      }

      // Get escrow account for this tournament
      const escrow = await EscrowAccount.findOne({ tournament_id: tournamentId });
      if (!escrow) {
        throw new AppError(
          'TOURNAMENT_ESCROW_NOT_FOUND',
          'Escrow account not found for prize distribution'
        );
      }

      // Ensure escrow status is appropriate
      if (escrow.status !== 'distributing_prizes' && escrow.status !== 'awaiting_results') {
        // Transition escrow to distributing_prizes
        escrow.status = 'distributing_prizes';
        escrow.processing_schedule.prizes_distributed = false;
        await escrow.save();
      }

      // Prepare winner submissions for escrow
      const winners = tournament.results.winners.filter(w => w.verified && w.user_id);
      if (winners.length === 0) {
        throw new AppError(
          'TOURNAMENT_NO_VERIFIED_WINNERS',
          'No verified winners to distribute prizes to'
        );
      }

      // Map prize percentages from tournament prize_structure
      const prizeDistributionMap = new Map<number, number>();
      tournament.prize_structure.distribution.forEach(d => {
        prizeDistributionMap.set(d.position, d.percentage);
      });

      // Build winner submissions array
      const winnerSubmissions = winners.map(winner => {
        const percentage = prizeDistributionMap.get(winner.position) || 0;
        const prizeAmount = (tournament.prize_structure.net_prize_pool * percentage) / 100;

        return {
          position: winner.position,
          in_game_id: winner.in_game_id,
          matched_user_id: winner.user_id,
          match_status: 'matched' as string,
          prize_percentage: percentage,
          prize_amount: prizeAmount,
          payout_status: 'allocated' as string,
          payout_transaction_id: undefined as unknown as mongoose.Types.ObjectId,
          paid_at: undefined as unknown as Date,
          failure_reason: '',
          retry_count: 0
        };
      });

      // Update escrow with winner submissions
      escrow.winner_submissions = {
        submitted_by: tournament.results.submitted_by!,
        submitted_at: tournament.results.submitted_at!,
        winners: winnerSubmissions as any,
        all_winners_verified: true,
        total_prize_distributed: winnerSubmissions.reduce((sum, w) => sum + w.prize_amount, 0)
      };

      await escrow.save();

      // For each winner, create a payout request (or initiate payment via finance service)
      // This is a simplified version – in reality you'd call a finance service or event.
      for (const winner of winnerSubmissions) {
        await this.createPrizePayout(
          tournament,
          winner.matched_user_id.toString(),
          winner.prize_amount,
          winner.position
        );
      }

      // Update tournament stats and mark as completed
      tournament.status = 'completed';
      tournament.completed_at = new Date();
      await tournament.save();

      // Update escrow status
      escrow.status = 'distributing_organizer';
      escrow.processing_schedule.prizes_distributed = true;
      await escrow.save();

      // Also update player stats for each winner
      for (const winner of winnerSubmissions) {
        await this.updatePlayerStats(
          winner.matched_user_id.toString(),
          winner.position,
          winner.prize_amount
        );
      }

      logger.info('Prize distribution completed', { tournamentId });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Prize distribution failed', { tournamentId, error: error.message });
      throw new AppError(
        'TOURNAMENT_PRIZE_DISTRIBUTION_FAILED',
        error.message || 'Prize distribution failed'
      );
    }
  }

  // ============================================
  // CREATE PRIZE PAYOUT (Helper)
  // ============================================
  private async createPrizePayout(
    tournament: IApexTournament,
    userId: string,
    amount: number,
    position: number
  ): Promise<void> {
    try {
      // Generate idempotency key
      const idempotencyKey = `prize_${tournament._id}_${userId}_${position}`;

      // Check if payout request already exists
      const existing = await PayoutRequest.findOne({ idempotency_key: idempotencyKey });
      if (existing) {
        logger.info('Payout request already exists, skipping', { idempotencyKey });
        return;
      }

      // Get user's mobile money details
      const user = await User.findById(userId).select('momo_account');
      if (!user || !user.momo_account || !user.momo_account.phone_number) {
        logger.error('User missing mobile money details for payout', { userId });
        // In production, you might queue a task to contact user or use alternative method
        return;
      }

      // Create payout request
      await PayoutRequest.create({
        user_id: new mongoose.Types.ObjectId(userId),
        idempotency_key: idempotencyKey,
        request_type: 'tournament_winnings',
        amount,
        currency: tournament.currency || 'GHS',
        source: {
          type: 'tournament_winnings',
          tournament_id: tournament._id,
          position
        },
        payout_details: {
          momo_number: user.momo_account.phone_number,
          network: user.momo_account.network,
          account_name: user.momo_account.account_name || user.profile?.first_name + ' ' + user.profile?.last_name
        },
        status: 'pending',
        dispute_check: {
          has_active_disputes: false,
          dispute_ids: []
        },
        fees: {
          platform_fee: 0,
          processing_fee: 0,
          total_fees: 0,
          net_amount: amount
        }
      });

      logger.info('Prize payout request created', { userId, tournamentId: tournament._id, amount });
    } catch (error: any) {
      logger.error('Failed to create prize payout', { userId, tournamentId: tournament._id, error: error.message });
      // Don't throw – we want other payouts to continue
    }
  }

  // ============================================
  // GET FINAL STANDINGS
  // ============================================
  async getFinalStandings(
    tournamentId: string,
    options: { includePrizes?: boolean; limit?: number } = {}
  ): Promise<any[]> {
    try {
      logger.info('Fetching final standings', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // If tournament is completed, we have final_placement and prize_won on registrations
      // Otherwise, we might only have the winners from results
      const registrations = await Registration.find({
        tournament_id: tournamentId,
        status: { $in: ['registered', 'checked_in', 'disqualified'] }
      })
        .populate('user_id', 'username profile.first_name profile.last_name profile.avatar_url')
        .sort({ final_placement: 1, prize_won: -1, created_at: 1 })
        .lean();

      // Map to standings format
      const standings = registrations.map(reg => {
        const user = reg.user_id as any;
        return {
          position: reg.final_placement || null,
          user: {
            _id: user._id,
            username: user.username,
            name: `${user.profile?.first_name || ''} ${user.profile?.last_name || ''}`.trim(),
            avatar: user.profile?.avatar_url
          },
          in_game_id: reg.in_game_id,
          status: reg.status,
          prize_won: options.includePrizes ? reg.prize_won || 0 : undefined,
          checked_in: reg.check_in?.checked_in || false,
          disqualified: reg.status === 'disqualified',
          disqualification_reason: reg.disqualification_reason
        };
      });

      // If we have winners from results but registrations don't have placements,
      // we can augment with that data
      if (tournament.results?.winners && tournament.results.winners.length > 0) {
        for (const winner of tournament.results.winners) {
          if (winner.verified && winner.user_id) {
            const existing = standings.find(s => s.user?._id.toString() === winner.user_id.toString());
            if (existing && !existing.position) {
              existing.position = winner.position;
            }
          }
        }
      }

      // Sort by position (nulls last)
      standings.sort((a, b) => {
        if (a.position === null && b.position === null) return 0;
        if (a.position === null) return 1;
        if (b.position === null) return -1;
        return a.position - b.position;
      });

      return standings;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Get final standings failed', { tournamentId, error: error.message });
      throw new AppError(
        'STANDINGS_FETCH_FAILED',
        error.message || 'Failed to fetch final standings'
      );
    }
  }

  // ============================================
  // UPDATE PLAYER STATS
  // ============================================
  async updatePlayerStats(
    userId: string,
    placement: number,
    prize: number = 0
  ): Promise<void> {
    try {
      logger.info('Updating player statistics', { userId, placement, prize });

      const user = await User.findById(userId);
      if (!user) {
        logger.warn('User not found for stats update', { userId });
        return;
      }

      // Update stats
      user.stats.tournaments_played = (user.stats.tournaments_played || 0) + 1;
      if (placement === 1) {
        user.stats.tournaments_won = (user.stats.tournaments_won || 0) + 1;
        user.stats.current_streak = (user.stats.current_streak || 0) + 1;
        user.stats.best_streak = Math.max(user.stats.best_streak || 0, user.stats.current_streak);
      } else {
        user.stats.current_streak = 0;
      }

      user.stats.total_earnings = (user.stats.total_earnings || 0) + prize;

      // Calculate win rate
      if (user.stats.tournaments_played > 0) {
        user.stats.win_rate = ((user.stats.tournaments_won || 0) / user.stats.tournaments_played) * 100;
      }

      await user.save();
      
      // Update wallet with prize (if applicable)
      if (prize > 0) {
        await User.findByIdAndUpdate(userId, {
          $inc: {
            'wallet.pending_balance': prize,
            'wallet.total_balance': prize
          },
          $set: {
            'wallet.last_transaction_at': new Date()
          }
        });
      }

      

      logger.info('Player stats updated', { userId });
    } catch (error: any) {
      logger.error('Failed to update player stats', { userId, error: error.message });
      // Don't throw – stats update is non-critical
    }
  }

  // ============================================
  // ORGANIZER PAYOUT (if needed separately)
  // ============================================
  async releaseOrganizerEarnings(tournamentId: string): Promise<void> {
    try {
      logger.info('Releasing organizer earnings', { tournamentId });

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      const escrow = await EscrowAccount.findOne({ tournament_id: tournamentId });
      if (!escrow) {
        throw new AppError('TOURNAMENT_ESCROW_NOT_FOUND', 'Escrow account not found');
      }

      if (escrow.status !== 'distributing_organizer' && escrow.status !== 'distributing_prizes') {
        throw new AppError(
          'INVALID_ESCROW_STATUS',
          `Cannot release organizer earnings when escrow status is ${escrow.status}`
        );
      }

      // Calculate organizer earnings from escrow
      const organizerShare = escrow.player_entries.payments
        .filter(p => !p.cancelled)
        .reduce((sum, p) => sum + p.organizer_share, 0);

      // Create payout request for organizer
      const idempotencyKey = `organizer_payout_${tournamentId}`;
      const existing = await PayoutRequest.findOne({ idempotency_key: idempotencyKey });
      if (!existing) {
        await PayoutRequest.create({
          user_id: tournament.organizer_id,
          idempotency_key: idempotencyKey,
          request_type: 'tournament_winnings', // or 'organizer_revenue'
          amount: organizerShare,
          currency: tournament.currency || 'GHS',
          source: {
            type: 'tournament_winnings',
            tournament_id: tournament._id,
            position: 0 // 0 indicates organizer
          },
          payout_details: {
            // Organizer must have MoMo account on file
            momo_number: '', // Should fetch from user profile
            network: '',
            account_name: ''
          },
          status: 'pending',
          dispute_check: {
            has_active_disputes: false,
            dispute_ids: []
          },
          fees: {
            platform_fee: 0,
            processing_fee: 0,
            total_fees: 0,
            net_amount: organizerShare
          }
        });
      }

      escrow.organizer_payout = {
        total_earnings: organizerShare,
        platform_fees_deducted: 0,
        net_amount: organizerShare,
        status: 'ready',
        released_at: new Date(),
        payout_transaction_id: undefined as unknown as mongoose.Types.ObjectId,
        paid_at: undefined as unknown as Date,
        failure_reason: '',
        retry_count: 0
      };
      escrow.status = 'completed';
      escrow.closed_at = new Date();
      await escrow.save();

      logger.info('Organizer earnings released', { tournamentId, amount: organizerShare });
    } catch (error: any) {
      logger.error('Failed to release organizer earnings', { tournamentId, error: error.message });
      throw new AppError(
        'TOURNAMENT_ORGANIZER_PAYOUT_FAILED',
        error.message || 'Organizer payout failed'
      );
    }
  }
}

export const tournamentResultsService = new TournamentResultsService();