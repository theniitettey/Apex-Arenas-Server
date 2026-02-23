import mongoose from 'mongoose';
import { Tournament, IApexTournament } from '../../../models/tournaments.model';
import { Match, IApexMatch } from '../../../models/matches.model';
import { Registration, IApexRegistration } from '../../../models/registrations.models';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { redisLock, LockKeys } from '../../../shared/utils/redis-lock.utils';

const logger = createLogger('bracket-manager');

export interface BracketParticipant {
  userId?: string;
  teamId?: string;
  inGameId: string;
  seedNumber: number;
  registration: IApexRegistration;
}

export interface GeneratedBracket {
  matches: IApexMatch[];
  totalRounds: number;
  totalMatches: number;
  bracketType: string;
}

/**
 * Bracket Manager
 * Handles all bracket generation and progression logic
 */
export class BracketManager {
  private static instance: BracketManager;

  private constructor() {}

  public static getInstance(): BracketManager {
    if (!BracketManager.instance) {
      BracketManager.instance = new BracketManager();
    }
    return BracketManager.instance;
  }

  /**
   * Generate bracket for a tournament (with concurrency protection)
   * This is idempotent - can be called multiple times safely
   */
  async generateBracket(tournamentId: string): Promise<GeneratedBracket> {
    return redisLock.executeWithLock(
      LockKeys.bracketGeneration(tournamentId),
      async () => this._generateBracketInternal(tournamentId),
      { ttl: 30000, retries: 5 } // 30 seconds, 5 retries
    );
  }

  /**
   * Internal bracket generation (protected by lock)
   */
  private async _generateBracketInternal(tournamentId: string): Promise<GeneratedBracket> {
    try {
      logger.info('Generating bracket', { tournamentId });

      // 1. Fetch tournament
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      }

      // 2. Check if bracket already generated (idempotency)
      if (tournament.bracket.generated) {
        logger.info('Bracket already generated, returning existing', { tournamentId });
        
        // Return existing matches
        const existingMatches = await Match.find({ tournament_id: tournamentId }).sort({ round: 1, match_number: 1 });
        return {
          matches: existingMatches,
          totalRounds: tournament.bracket.total_rounds,
          totalMatches: existingMatches.length,
          bracketType: tournament.tournament_type
        };
      }

      // 3. Get checked-in participants with seeding
      const participants = await this.getParticipants(tournamentId);

      if (participants.length < tournament.capacity.min_participants) {
        throw new AppError(
          'INSUFFICIENT_PARTICIPANTS',
          `Need at least ${tournament.capacity.min_participants} participants (have: ${participants.length})`
        );
      }

      // 4. Generate bracket based on tournament type
      let generatedBracket: GeneratedBracket;

      switch (tournament.tournament_type) {
        case 'single_elimination':
          generatedBracket = await this.generateSingleElimination(tournament, participants);
          break;
        
        case 'double_elimination':
          generatedBracket = await this.generateDoubleElimination(tournament, participants);
          break;
        
        case 'round_robin':
          generatedBracket = await this.generateRoundRobin(tournament, participants);
          break;
        
        default:
          throw new AppError(
            'UNSUPPORTED_TOURNAMENT_TYPE',
            `Tournament type ${tournament.tournament_type} not yet supported`
          );
      }

      // 5. Update tournament with bracket metadata
      tournament.bracket = {
        generated: true,
        generated_at: new Date(),
        total_rounds: generatedBracket.totalRounds,
        current_round: 1,
        bracket_url: undefined
      };
      await tournament.save();

      logger.info('Bracket generated successfully', {
        tournamentId,
        type: tournament.tournament_type,
        participants: participants.length,
        matches: generatedBracket.totalMatches,
        rounds: generatedBracket.totalRounds
      });

      return generatedBracket;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Bracket generation failed', { tournamentId, error: error.message });
      throw new AppError('BRACKET_GENERATION_FAILED', error.message || 'Failed to generate bracket');
    }
  }

  /**
   * Generate Single Elimination Bracket
   */
  private async generateSingleElimination(
    tournament: IApexTournament,
    participants: BracketParticipant[]
  ): Promise<GeneratedBracket> {
    const participantCount = participants.length;
    
    // Calculate total rounds (log2 rounded up)
    const totalRounds = Math.ceil(Math.log2(participantCount));
    
    // Calculate bracket size (next power of 2)
    const bracketSize = Math.pow(2, totalRounds);
    
    // Calculate number of byes needed
    const byesNeeded = bracketSize - participantCount;

    logger.info('Single elimination bracket parameters', {
      participants: participantCount,
      bracketSize,
      totalRounds,
      byesNeeded
    });

    // Create matches array
    const matches: any[] = [];
    let matchCounter = 0;

    // Round 1: Create first round matches
    const round1ParticipantsNeeded = bracketSize / 2;
    const round1MatchesNeeded = round1ParticipantsNeeded;

    for (let i = 0; i < round1MatchesNeeded; i++) {
      matchCounter++;
      
      // Seed matching algorithm: 1 vs bracketSize, 2 vs bracketSize-1, etc.
      const topSeedIndex = i;
      const bottomSeedIndex = (bracketSize - 1) - i;

      const topParticipant = participants[topSeedIndex];
      const bottomParticipant = participants[bottomSeedIndex];

      // Determine if this is a bye match (one participant missing)
      const isByeMatch = !bottomParticipant;

      const matchParticipants: any[] = [];

      // Add top participant
      if (topParticipant) {
        matchParticipants.push({
          user_id: topParticipant.userId ? new mongoose.Types.ObjectId(topParticipant.userId) : undefined,
          team_id: topParticipant.teamId ? new mongoose.Types.ObjectId(topParticipant.teamId) : undefined,
          in_game_id: topParticipant.inGameId,
          seed_number: topParticipant.seedNumber,
          score: 0,
          result: isByeMatch ? 'win' : 'pending',
          is_ready: false
        });
      }

      // Add bottom participant (if exists)
      if (bottomParticipant) {
        matchParticipants.push({
          user_id: bottomParticipant.userId ? new mongoose.Types.ObjectId(bottomParticipant.userId) : undefined,
          team_id: bottomParticipant.teamId ? new mongoose.Types.ObjectId(bottomParticipant.teamId) : undefined,
          in_game_id: bottomParticipant.inGameId,
          seed_number: bottomParticipant.seedNumber,
          score: 0,
          result: 'pending',
          is_ready: false
        });
      }

      const match = {
        tournament_id: tournament._id,
        round: 1,
        match_number: matchCounter,
        format: {
          best_of: tournament.rules?.scoring_system === 'best_of_3' ? 3 : 1,
          games_played: 0,
          games_to_win: tournament.rules?.scoring_system === 'best_of_3' ? 2 : 1
        },
        bracket_position: 'main',
        participants: matchParticipants,
        schedule: {
          scheduled_time: new Date(tournament.schedule.tournament_start),
          ready_check_time: undefined,
          started_at: undefined,
          completed_at: undefined
        },
        status: isByeMatch ? 'completed' : 'pending',
        winner_id: isByeMatch && topParticipant ? (topParticipant.userId || topParticipant.teamId) : undefined,
        timeouts: {
          no_show_timeout_minutes: 15,
          result_submission_deadline: undefined,
          auto_forfeit_enabled: true
        }
      };

      matches.push(match);
    }

    // Generate subsequent rounds (empty matches with progression links)
    let previousRoundMatchCount = round1MatchesNeeded;
    
    for (let round = 2; round <= totalRounds; round++) {
      const thisRoundMatchCount = Math.ceil(previousRoundMatchCount / 2);
      
      for (let matchNum = 0; matchNum < thisRoundMatchCount; matchNum++) {
        matchCounter++;
        
        const match = {
          tournament_id: tournament._id,
          round,
          match_number: matchCounter,
          round_name: this.getRoundName(round, totalRounds),
          format: {
            best_of: tournament.rules?.scoring_system === 'best_of_3' ? 3 : 1,
            games_played: 0,
            games_to_win: tournament.rules?.scoring_system === 'best_of_3' ? 2 : 1
          },
          bracket_position: 'main',
          participants: [], // Winners from previous round will be added
          schedule: {
            scheduled_time: new Date(tournament.schedule.tournament_start),
            ready_check_time: undefined,
            started_at: undefined,
            completed_at: undefined
          },
          status: 'pending'
        };

        matches.push(match);
      }

      previousRoundMatchCount = thisRoundMatchCount;
    }

    // Save all matches to database
    const createdMatches = await Match.insertMany(matches) as unknown as IApexMatch[];
    // Link matches (set next_match_id and previous_match_ids)
    await this.linkSingleEliminationMatches(createdMatches, totalRounds);

    logger.info('Single elimination bracket created', {
      tournamentId: tournament._id.toString(),
      totalMatches: createdMatches.length,
      totalRounds
    });

    return {
      matches: createdMatches,
      totalRounds,
      totalMatches: createdMatches.length,
      bracketType: 'single_elimination'
    };
  }

  /**
   * Link matches in single elimination (set progression)
   */
  private async linkSingleEliminationMatches(matches: IApexMatch[], totalRounds: number): Promise<void> {
    const matchesByRound: Map<number, IApexMatch[]> = new Map();

    // Group matches by round
    matches.forEach(match => {
      const roundMatches = matchesByRound.get(match.round) || [];
      roundMatches.push(match);
      matchesByRound.set(match.round, roundMatches);
    });

    // Link each round to the next
    for (let round = 1; round < totalRounds; round++) {
      const currentRoundMatches = matchesByRound.get(round) || [];
      const nextRoundMatches = matchesByRound.get(round + 1) || [];

      for (let i = 0; i < currentRoundMatches.length; i++) {
        const currentMatch = currentRoundMatches[i];
        const nextMatchIndex = Math.floor(i / 2);
        const nextMatch = nextRoundMatches[nextMatchIndex];

        if (nextMatch) {
          currentMatch.next_match_id = nextMatch._id;
          
          if (!nextMatch.previous_match_ids) {
            nextMatch.previous_match_ids = [];
          }
          nextMatch.previous_match_ids.push(currentMatch._id);

          await currentMatch.save();
          await nextMatch.save();
        }
      }
    }
  }

  /**
   * Generate Double Elimination Bracket
   * TODO: Implement double elimination logic
   */
  private async generateDoubleElimination(
    tournament: IApexTournament,
    participants: BracketParticipant[]
  ): Promise<GeneratedBracket> {
    throw new AppError('NOT_IMPLEMENTED', 'Double elimination bracket generation coming soon');
  }

  /**
   * Generate Round Robin Bracket
   * TODO: Implement round robin logic
   */
  private async generateRoundRobin(
    tournament: IApexTournament,
    participants: BracketParticipant[]
  ): Promise<GeneratedBracket> {
    throw new AppError('NOT_IMPLEMENTED', 'Round robin bracket generation coming soon');
  }

  /**
   * Get checked-in participants with seeding
   */
  private async getParticipants(tournamentId: string): Promise<BracketParticipant[]> {
    const registrations = await Registration.find({
      tournament_id: tournamentId,
      status: 'checked_in'
    })
    .sort({ seed_number: 1, created_at: 1 }) // Sort by seed, then registration time
    .lean();

    return registrations.map((reg, index) => ({
      userId: reg.user_id?.toString(),
      teamId: reg.team_id?.toString(),
      inGameId: reg.in_game_id,
      seedNumber: reg.seed_number || (index + 1), // Assign seed if not set
      registration: reg as IApexRegistration
    }));
  }

  /**
   * Get round name for display
   */
  private getRoundName(round: number, totalRounds: number): string {
    const roundsFromEnd = totalRounds - round;

    if (round === totalRounds) return 'final';
    if (roundsFromEnd === 1) return 'semi_final';
    if (roundsFromEnd === 2) return 'quarter_final';
    
    return `round_${round}`;
  }

  /**
   * Advance winner to next match (called after match completion)
   */
  async advanceWinner(matchId: string): Promise<void> {
    try {
      logger.info('Advancing winner', { matchId });

      const match = await Match.findById(matchId);
      if (!match) {
        throw new AppError('MATCH_NOT_FOUND', 'Match not found');
      }

      if (match.status !== 'completed') {
        throw new AppError('MATCH_NOT_COMPLETED', 'Cannot advance winner - match not completed');
      }

      if (!match.winner_id) {
        throw new AppError('NO_WINNER', 'Cannot advance - no winner determined');
      }

      if (!match.next_match_id) {
        logger.info('No next match - this is final match', { matchId });
        return;
      }

      // Find winner participant data
      const winnerParticipant = match.participants.find(p => 
        p.user_id?.toString() === match.winner_id?.toString() ||
        p.team_id?.toString() === match.winner_id?.toString()
      );

      if (!winnerParticipant) {
        throw new AppError('WINNER_NOT_FOUND', 'Winner participant not found in match');
      }

      // Add winner to next match
      const nextMatch = await Match.findById(match.next_match_id);
      if (!nextMatch) {
        throw new AppError('NEXT_MATCH_NOT_FOUND', 'Next match not found');
      }

      // Add winner as participant in next match
      nextMatch.participants.push({
        user_id: winnerParticipant.user_id,
        team_id: winnerParticipant.team_id,
        in_game_id: winnerParticipant.in_game_id,
        seed_number: winnerParticipant.seed_number,
        score: 0,
        result: 'pending',
        is_ready: false,
        ready_at: undefined
      });

      await nextMatch.save();

      logger.info('Winner advanced to next match', {
        fromMatch: matchId,
        toMatch: nextMatch._id.toString(),
        winner: match.winner_id.toString()
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to advance winner', { matchId, error: error.message });
      throw new AppError('WINNER_ADVANCEMENT_FAILED', error.message || 'Failed to advance winner');
    }
  }

  /**
   * Validate bracket integrity
   */
  async validateBracket(tournamentId: string): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      const matches = await Match.find({ tournament_id: tournamentId }).sort({ round: 1, match_number: 1 });
      const tournament = await Tournament.findById(tournamentId);

      if (!tournament) {
        errors.push('Tournament not found');
        return { valid: false, errors };
      }

      // Check if all matches have valid next_match_id (except finals)
      const finalRound = tournament.bracket.total_rounds;
      
      for (const match of matches) {
        if (match.round < finalRound && !match.next_match_id) {
          errors.push(`Match ${match.match_number} (Round ${match.round}) missing next_match_id`);
        }
      }

      // Check if all participants are valid
      for (const match of matches) {
        for (const participant of match.participants) {
          if (!participant.in_game_id) {
            errors.push(`Match ${match.match_number}: Participant missing in_game_id`);
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors
      };
    } catch (error: any) {
      errors.push(`Validation error: ${error.message}`);
      return { valid: false, errors };
    }
  }
}

// Export singleton instance
export const bracketManager = BracketManager.getInstance();