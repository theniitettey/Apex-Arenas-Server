import * as cron from 'node-cron';
import { registrationService } from '../../services/tournament/services/registration.service';
import { tournamentScheduler } from '../../services/tournament/services/tournament.scheduler';
import { matchSessionService } from '../../services/tournament/services/match.session.services';
import { createLogger } from '../utils';

const logger = createLogger('cron-jobs');

class CronJobsManager {
  private static instance: CronJobsManager;
  private jobs: cron.ScheduledTask[] = [];

  private constructor() {}

  public static getInstance(): CronJobsManager {
    if (!CronJobsManager.instance) {
      CronJobsManager.instance = new CronJobsManager();
    }
    return CronJobsManager.instance;
  }

  public start() {
    logger.info('Starting cron jobs...');

    // Expire unpaid promotions every 2 minutes
    const expireUnpaidPromotionsJob = cron.schedule('*/2 * * * *', async () => {
      logger.info('Running expireUnpaidPromotions cron job...');
      try {
        const count = await registrationService.expireUnpaidPromotions();
        logger.info(`Expired unpaid promotions: ${count}`);
      } catch (err: any) {
        logger.error('Error in expireUnpaidPromotions cron job', { error: err.message });
      }
    });

    this.jobs.push(expireUnpaidPromotionsJob);

    const cleanupSessionsJob = cron.schedule('0 3 * * *', async () => {
      const count = await matchSessionService.cleanupOldSessions();
      logger.info(`Cleaned up old match sessions: ${count}`);
    });
    this.jobs.push(cleanupSessionsJob);


    tournamentScheduler.start();
    logger.info('All cron jobs scheduled.');
  }

  public stop() {
    logger.info('Stopping all cron jobs...');
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    tournamentScheduler.stop();
  }
}

export const cronJobsManager = CronJobsManager.getInstance();