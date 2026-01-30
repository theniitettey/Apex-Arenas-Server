import express from 'express';
import { env } from './configs/env.config';
import { databaseManager } from './configs/database.config';
import { redisManager } from './configs/redis.config';
import gatewayRoutes from './gateway/routes';

const app = express();

app.use(express.json());
app.use('/api', gatewayRoutes);

const startServer = async () => {
  try {
    await databaseManager.connect();
    await redisManager.connect();

    app.listen(env.PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`🚀 Server running on http://localhost:${env.PORT}/api`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
