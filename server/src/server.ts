import app from './app';
import { databaseManager } from './configs/database.config';
import { redisManager } from './configs/redis.config';
import { cronJobsManager } from './shared/utils/cron-jobs.utils';
import { createLogger } from './shared/utils';

const logger = createLogger('apex-server');

const PORT = process.env.PORT

async function startServer() {
  try{
    logger.info("Starting Apex Server");

    logger.info("Connecting to database...");
    await databaseManager.connect();

    logger.info("Connecting to Redis...");
    await redisManager.connect();

    logger.info("Starting Express server...");
    app.listen(PORT, () => {
      logger.info(`Apex Server running on ${PORT}`, {
        port: PORT,
        timeStamp: new Date().toISOString()
      });
    });

    cronJobsManager.start();

  } catch (error: any) {
    logger.error("Falied to start server", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  try {
    logger.info("Stopping cron jobs...");
    cronJobsManager.stop();
    logger.info("Closing redis connection...");
    await redisManager.disconnect();
    logger.info("Closing database connection...");
    await databaseManager.disconnect();
    logger.info("Shutdown complete, exiting process.");
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during graceful shutdown', {error: error.message, stack: error.stack});
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {error: error.message, stack: error.stack});
  process.exit(1);
})


startServer();
