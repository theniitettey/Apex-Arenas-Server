/**
 * ============================================
 * TOURNAMENT STATE MACHINE
 * ============================================
 * Enforces valid state transitions and prevents invalid status changes
 * 
 * Status Flow:
 * draft → awaiting_deposit → open → locked → ready_to_start 
 * → ongoing → awaiting_results → verifying_results → completed
 * 
 * Any status can transition to: cancelled
 */

import { IApexTournament } from '../../../models/tournaments.model';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';

const logger = createLogger('tournament-state-machine');

export type TournamentStatus = 
  | 'draft'
  | 'awaiting_deposit'
  | 'open'
  | 'locked'
  | 'ready_to_start'
  | 'ongoing'
  | 'awaiting_results'
  | 'verifying_results'
  | 'completed'
  | 'cancelled';

export interface StateTransitionContext {
  tournament: IApexTournament;
  userId?: string;
  reason?: string;
  metadata?: Record<string, any>;
}

export interface TransitionValidation {
  allowed: boolean;
  reason?: string;
}

/**
 * Tournament State Machine
 * Enforces business rules for status transitions
 */
export class TournamentStateMachine {
  private static instance: TournamentStateMachine;

  // Define valid transitions
  private readonly VALID_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
    draft: ['awaiting_deposit', 'open', 'cancelled'], // Can skip awaiting_deposit if free
    awaiting_deposit: ['open', 'cancelled'],
    open: ['locked', 'cancelled'],
    locked: ['ready_to_start', 'cancelled'],
    ready_to_start: ['ongoing', 'cancelled'],
    ongoing: ['awaiting_results', 'cancelled'],
    awaiting_results: ['verifying_results', 'cancelled'],
    verifying_results: ['completed', 'ongoing', 'cancelled'], // Can go back to ongoing if results invalid
    completed: [], // Terminal state
    cancelled: [] // Terminal state
  };

  // Terminal states that cannot transition to anything
  private readonly TERMINAL_STATES: TournamentStatus[] = ['completed', 'cancelled'];

  private constructor() {}

  public static getInstance(): TournamentStateMachine {
    if (!TournamentStateMachine.instance) {
      TournamentStateMachine.instance = new TournamentStateMachine();
    }
    return TournamentStateMachine.instance;
  }

  /**
   * Check if a status transition is valid
   */
  canTransition(
    from: TournamentStatus,
    to: TournamentStatus,
    context: StateTransitionContext
  ): TransitionValidation {
    // Check if from state is terminal
    if (this.TERMINAL_STATES.includes(from)) {
      return {
        allowed: false,
        reason: `Cannot transition from terminal state: ${from}`
      };
    }

    // Check if transition is in allowed list
    if (!this.VALID_TRANSITIONS[from]?.includes(to)) {
      return {
        allowed: false,
        reason: `Invalid transition: ${from} → ${to}`
      };
    }

    // Apply business rule validations
    return this.validateBusinessRules(from, to, context);
  }

  /**
   * Apply business rules for specific transitions
   */
  private validateBusinessRules(
    from: TournamentStatus,
    to: TournamentStatus,
    context: StateTransitionContext
  ): TransitionValidation {
    const { tournament } = context;

    // Rule: Can only go to 'open' if deposit is made (for paid tournaments)
    if (to === 'open' && !tournament.is_free) {
      if (!tournament.escrow_account_id) {
        return {
          allowed: false,
          reason: 'Cannot open paid tournament without escrow deposit'
        };
      }
    }

    // Rule: Can only lock if within 24 hours of start
    if (to === 'locked') {
      const now = new Date();
      const tournamentStart = new Date(tournament.schedule.tournament_start);
      const hoursUntilStart = (tournamentStart.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursUntilStart > 24) {
        return {
          allowed: false,
          reason: 'Can only lock tournament within 24 hours of start time'
        };
      }

      // Must have minimum participants
      if (tournament.capacity.current_participants < tournament.capacity.min_participants) {
        return {
          allowed: false,
          reason: `Need at least ${tournament.capacity.min_participants} participants (currently: ${tournament.capacity.current_participants})`
        };
      }
    }

    // Rule: Can only start if bracket is generated and check-in is done
    if (to === 'ready_to_start') {
      if (!tournament.bracket.generated) {
        return {
          allowed: false,
          reason: 'Cannot start tournament without generated bracket'
        };
      }

      const checkedInCount = tournament.capacity.checked_in_count || 0;
      if (checkedInCount < tournament.capacity.min_participants) {
        return {
          allowed: false,
          reason: `Not enough checked-in participants (need: ${tournament.capacity.min_participants}, have: ${checkedInCount})`
        };
      }
    }

    // Rule: Can only go to ongoing if tournament_start time has passed
    if (to === 'ongoing') {
      const now = new Date();
      const tournamentStart = new Date(tournament.schedule.tournament_start);

      if (now < tournamentStart) {
        return {
          allowed: false,
          reason: 'Tournament start time has not been reached yet'
        };
      }
    }

    // Rule: Can only await results if tournament_end time has passed
    if (to === 'awaiting_results') {
      if (tournament.schedule.tournament_end) {
        const now = new Date();
        const tournamentEnd = new Date(tournament.schedule.tournament_end);

        if (now < tournamentEnd) {
          return {
            allowed: false,
            reason: 'Tournament end time has not been reached yet'
          };
        }
      }
    }

    // Rule: Can only verify results if results have been submitted
    if (to === 'verifying_results') {
      if (!tournament.results?.winners || tournament.results.winners.length < 1) {
        return {
          allowed: false,
          reason: 'No results submitted yet'
        };
      }
    }

    // Rule: Can only complete if all results are verified
    if (to === 'completed') {
      if (tournament.results?.verification_status !== 'verified') {
        return {
          allowed: false,
          reason: 'Results must be verified before completion'
        };
      }
    }

    // Rule: Can only cancel before tournament starts (unless admin override)
    if (to === 'cancelled' && from !== 'draft' && from !== 'awaiting_deposit') {
      const now = new Date();
      const cancellationCutoff = tournament.schedule.cancellation_cutoff;

      if (cancellationCutoff && now > new Date(cancellationCutoff)) {
        // Allow admin override with reason
        if (!context.metadata?.adminOverride) {
          return {
            allowed: false,
            reason: 'Cancellation cutoff time has passed. Admin override required.'
          };
        }
      }
    }

    // All validations passed
    return { allowed: true };
  }

  /**
   * Get next possible states from current state
   */
  getNextStates(currentStatus: TournamentStatus): TournamentStatus[] {
    return this.VALID_TRANSITIONS[currentStatus] || [];
  }

  /**
   * Check if a state is terminal
   */
  isTerminalState(status: TournamentStatus): boolean {
    return this.TERMINAL_STATES.includes(status);
  }

  /**
   * Get automatic transition that should happen at specific time
   * Used by scheduler to know which transitions to trigger
   */
  getScheduledTransition(tournament: IApexTournament): {
    to: TournamentStatus;
    when: Date;
  } | null {
    const now = new Date();

    switch (tournament.status) {
      case 'open': {
        // Auto-lock 24 hours before tournament start
        const tournamentStart = new Date(tournament.schedule.tournament_start);
        const lockTime = new Date(tournamentStart.getTime() - 24 * 60 * 60 * 1000);
        
        if (now >= lockTime) {
          return { to: 'locked', when: lockTime };
        }
        break;
      }

      case 'locked': {
        // Auto-transition to ready_to_start after check-in ends
        if (tournament.schedule.check_in_end) {
          const checkInEnd = new Date(tournament.schedule.check_in_end);
          if (now >= checkInEnd) {
            return { to: 'ready_to_start', when: checkInEnd };
          }
        }
        break;
      }

      case 'ready_to_start': {
        // Auto-start at tournament_start time
        const tournamentStart = new Date(tournament.schedule.tournament_start);
        if (now >= tournamentStart) {
          return { to: 'ongoing', when: tournamentStart };
        }
        break;
      }

      case 'ongoing': {
        // Auto-transition to awaiting_results at tournament_end time
        if (tournament.schedule.tournament_end) {
          const tournamentEnd = new Date(tournament.schedule.tournament_end);
          if (now >= tournamentEnd) {
            return { to: 'awaiting_results', when: tournamentEnd };
          }
        }
        break;
      }
    }

    return null;
  }

  /**
   * Generate a human-readable status description
   */
  getStatusDescription(status: TournamentStatus): string {
    const descriptions: Record<TournamentStatus, string> = {
      draft: 'Tournament is being created by organizer',
      awaiting_deposit: 'Waiting for organizer to deposit prize pool',
      open: 'Accepting registrations (more than 24hrs before start)',
      locked: 'Less than 24hrs to start - no cancellations allowed',
      ready_to_start: 'Check-in complete, bracket generated, ready to begin',
      ongoing: 'Tournament matches are in progress',
      awaiting_results: 'Tournament ended, waiting for organizer to submit winners',
      verifying_results: 'System is verifying submitted results',
      completed: 'Tournament completed, prizes distributed',
      cancelled: 'Tournament was cancelled'
    };

    return descriptions[status] || status;
  }

  /**
   * Log state transition for audit trail
   */
  logTransition(
    tournamentId: string,
    from: TournamentStatus,
    to: TournamentStatus,
    context: StateTransitionContext
  ): void {
    logger.info('Tournament status transition', {
      tournamentId,
      from,
      to,
      userId: context.userId,
      reason: context.reason,
      timestamp: new Date().toISOString()
    });
  }
}

// Export singleton instance
export const tournamentStateMachine = TournamentStateMachine.getInstance();