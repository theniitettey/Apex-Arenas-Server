import cron, { ScheduledTask } from 'node-cron';
import { Match, Tournament } from '../../../models';
import { tournamentStateMachine } from '../engine/tournament.state-machine';
import { checkinService } from './checkin.service';
import { matchOrchestrator } from '../engine/match.orchestrator';
import { createLogger } from '../../../shared/utils/logger.utils';
import { redisLock, LockKeys } from '../../../shared/utils/redis-lock.utils';

const logger = createLogger('tournament-scheduler');

export class TournamentScheduler {
  private static instance: TournamentScheduler;
  private jobs: Map<string, ScheduledTask> = new Map();
  private isRunning = false;

  private constructor() {}

  public static getInstance(): TournamentScheduler {
    if (!TournamentScheduler.instance) {
      TournamentScheduler.instance = new TournamentScheduler();
    }
    return TournamentScheduler.instance;
  }

  /**
   * Start all cron jobs
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler already running');
      return;
    }

    logger.info('Starting tournament scheduler...');

    // Run every 5 minutes
    this.scheduleJob(
      'auto-lock-tournaments',
      '*/5 * * * *', // Every 5 minutes
      () => this.autoLockTournaments()
    );

    // Run every 5 minutes
    this.scheduleJob(
      'auto-start-tournaments',
      '*/5 * * * *',
      () => this.autoStartTournaments()
    );

    // Run every 15 minutes
    this.scheduleJob(
      'check-in-reminders',
      '*/15 * * * *',
      () => this.sendCheckInReminders()
    );

    // Run every 10 minutes
    this.scheduleJob(
      'disqualify-no-shows',
      '*/10 * * * *',
      () => this.disqualifyNoShows()
    );

    // Run every 2 minutes
    this.scheduleJob(
      'auto-forfeit-matches',
      '*/2 * * * *',
      () => this.autoForfeitMatches()
    );

    // Run every 1 minute
    this.scheduleJob(
      'match-ready-checks',
      '*/1 * * * *',
      () => this.sendMatchReadyChecks()
    );

    this.isRunning = true;
    logger.info('Tournament scheduler started successfully');
  }

  /**
   * Stop all cron jobs
   */
  stop(): void {
    logger.info('Stopping tournament scheduler...');

    this.jobs.forEach((job, name) => {
      job.stop();
      logger.info(`Stopped job: ${name}`);
    });

    this.jobs.clear();
    this.isRunning = false;

    logger.info('Tournament scheduler stopped');
  }

  /**
   * Schedule a cron job
   */
  private scheduleJob(name: string, cronExpression: string, handler: () => Promise<void>): void {
    const job = cron.schedule(cronExpression, async () => {
      try {
        logger.debug(`Running scheduled job: ${name}`);
        await handler();
      } catch (error: any) {
        logger.error(`Scheduled job failed: ${name}`, { error: error.message });
      }
    });

    this.jobs.set(name, job);
    logger.info(`Scheduled job: ${name} (${cronExpression})`);
  }

  // ============================================
  // AUTO-LOCK TOURNAMENTS (24hrs before start)
  // ============================================
  private async autoLockTournaments(): Promise<void> {
    try {
      const now = new Date();
      const lockTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

      // Find tournaments that should be locked
      const tournaments = await Tournament.find({
        status: 'open',
        'schedule.tournament_start': {
          $gte: now,
          $lte: lockTime
        }
      });

      logger.info(`Found ${tournaments.length} tournaments to auto-lock`);

      for (const tournament of tournaments) {
        try {
          // Check if transition is valid
          const validation = tournamentStateMachine.canTransition(
            'open',
            'locked',
            { tournament }
          );

          if (validation.allowed) {
            await redisLock.executeWithLock(
              LockKeys.tournamentStatusChange(tournament._id.toString()),
              async () => {
                tournament.status = 'locked';
                await tournament.save();

                tournamentStateMachine.logTransition(
                  tournament._id.toString(),
                  'open',
                  'locked',
                  { tournament, reason: 'Auto-lock 24hrs before start' }
                );

                logger.info('Tournament auto-locked', { tournamentId: tournament._id });
              },
              { ttl: 5000 }
            );
          } else {
            logger.warn('Cannot auto-lock tournament', {
              tournamentId: tournament._id,
              reason: validation.reason
            });
          }
        } catch (error: any) {
          logger.error('Failed to auto-lock tournament', {
            tournamentId: tournament._id,
            error: error.message
          });
        }
      }
    } catch (error: any) {
      logger.error('Auto-lock tournaments job failed', { error: error.message });
    }
  }

  // ============================================
  // AUTO-START TOURNAMENTS (at scheduled time)
  // ============================================
  private async autoStartTournaments(): Promise<void> {
    try {
      const now = new Date();

      // Find tournaments that should start
      const tournaments = await Tournament.find({
        status: 'ready_to_start',
        'schedule.tournament_start': { $lte: now }
      });

      logger.info(`Found ${tournaments.length} tournaments to auto-start`);

      for (const tournament of tournaments) {
        try {
          const validation = tournamentStateMachine.canTransition(
            'ready_to_start',
            'ongoing',
            { tournament }
          );

          if (validation.allowed) {
            await redisLock.executeWithLock(
              LockKeys.tournamentStatusChange(tournament._id.toString()),
              async () => {
                tournament.status = 'ongoing';
                tournament.started_at = new Date();
                await tournament.save();

                tournamentStateMachine.logTransition(
                  tournament._id.toString(),
                  'ready_to_start',
                  'ongoing',
                  { tournament, reason: 'Auto-start at scheduled time' }
                );

                logger.info('Tournament auto-started', { tournamentId: tournament._id });
              },
              { ttl: 5000 }
            );
          }
        } catch (error: any) {
          logger.error('Failed to auto-start tournament', {
            tournamentId: tournament._id,
            error: error.message
          });
        }
      }
    } catch (error: any) {
      logger.error('Auto-start tournaments job failed', { error: error.message });
    }
  }

  // ============================================
  // SEND CHECK-IN REMINDERS
  // ============================================
  private async sendCheckInReminders(): Promise<void> {
    try {
      const now = new Date();
      const reminderWindow = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

      // Find tournaments with check-in starting soon
      const tournaments = await Tournament.find({
        status: { $in: ['open', 'locked'] },
        'schedule.check_in_start': {
          $gte: now,
          $lte: reminderWindow
        }
      });

      logger.info(`Found ${tournaments.length} tournaments for check-in reminders`);

      for (const tournament of tournaments) {
        try {
          const sent = await checkinService.sendCheckInReminders(tournament._id.toString());
          logger.info('Check-in reminders sent', {
            tournamentId: tournament._id,
            count: sent
          });
        } catch (error: any) {
          logger.error('Failed to send check-in reminders', {
            tournamentId: tournament._id,
            error: error.message
          });
        }
      }
    } catch (error: any) {
      logger.error('Send check-in reminders job failed', { error: error.message });
    }
  }

  // ============================================
  // DISQUALIFY NO-SHOWS (after check-in closes)
  // ============================================
  private async disqualifyNoShows(): Promise<void> {
    try {
      const now = new Date();

      // Find tournaments where check-in has ended
      const tournaments = await Tournament.find({
        status: { $in: ['locked', 'ready_to_start'] },
        'schedule.check_in_end': { $lte: now }
      });

      logger.info(`Found ${tournaments.length} tournaments to check for no-shows`);

      for (const tournament of tournaments) {
        try {
          const disqualified = await checkinService.disqualifyNoShows(tournament._id.toString());
          
          if (disqualified > 0) {
            logger.info('No-show players disqualified', {
              tournamentId: tournament._id,
              count: disqualified
            });
          }
        } catch (error: any) {
          logger.error('Failed to disqualify no-shows', {
            tournamentId: tournament._id,
            error: error.message
          });
        }
      }
    } catch (error: any) {
      logger.error('Disqualify no-shows job failed', { error: error.message });
    }
  }

  // ============================================
  // AUTO-FORFEIT MATCHES (no-shows after timeout)
  // ============================================
  private async autoForfeitMatches(): Promise<void> {
    try {
      const now = new Date();

      // Find matches in ready_check status that have timed out
      const matches = await Match.find({
        status: 'ready_check',
        'schedule.ready_check_time': { $exists: true }
      });

      logger.debug(`Checking ${matches.length} matches for auto-forfeit`);

      for (const match of matches) {
        try {
          const readyCheckTime = match.schedule.ready_check_time;
          if (!readyCheckTime) continue;

          const timeoutMinutes = match.timeouts?.no_show_timeout_minutes || 15;
          const timeoutTime = new Date(readyCheckTime.getTime() + timeoutMinutes * 60 * 1000);

          if (now > timeoutTime) {
            // Check which participants are not ready
            const notReadyParticipants = match.participants.filter(p => !p.is_ready);

            if (notReadyParticipants.length === 1) {
              // One player is ready, other is not - forfeit the no-show
              const noShowId = notReadyParticipants[0].user_id?.toString() || 
                               notReadyParticipants[0].team_id?.toString();

              if (noShowId) {
                await matchOrchestrator.forfeitNoShow(match._id.toString(), noShowId);
                logger.info('Match auto-forfeited due to no-show', {
                  matchId: match._id,
                  noShowId
                });
              }
            } else if (notReadyParticipants.length === 2) {
              // Both players no-show - cancel match
              match.status = 'cancelled';
              await match.save();
              logger.info('Match cancelled - both players no-show', {
                matchId: match._id
              });
            }
          }
        } catch (error: any) {
          logger.error('Failed to auto-forfeit match', {
            matchId: match._id,
            error: error.message
          });
        }
      }
    } catch (error: any) {
      logger.error('Auto-forfeit matches job failed', { error: error.message });
    }
  }

  // ============================================
  // SEND MATCH READY CHECKS (5 mins before match)
  // ============================================
  private async sendMatchReadyChecks(): Promise<void> {
    try {
      const now = new Date();
      const readyCheckWindow = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now

      // Find matches scheduled to start soon
      const matches = await Match.find({
        status: 'pending',
        'schedule.scheduled_time': {
          $gte: now,
          $lte: readyCheckWindow
        }
      });

      logger.debug(`Found ${matches.length} matches for ready check`);

      for (const match of matches) {
        try {
          await matchOrchestrator.startMatch(match._id.toString());
          logger.info('Ready check initiated for match', {
            matchId: match._id
          });
        } catch (error: any) {
          logger.error('Failed to initiate ready check', {
            matchId: match._id,
            error: error.message
          });
        }
      }
    } catch (error: any) {
      logger.error('Send match ready checks job failed', { error: error.message });
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    activeJobs: string[];
  } {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys())
    };
  }
}

// Export singleton instance
export const tournamentScheduler = TournamentScheduler.getInstance();

// Auto-start on import (optional - you can start manually in server.ts)
// tournamentScheduler.start();