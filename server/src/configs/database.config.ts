import mongoose from 'mongoose';
import { createLogger } from '../shared/utils/logger.utils';
import { env } from "./env.config"

const logger = createLogger('database.config');

class DatabaseManager {
  private static instance: DatabaseManager;
  private isConnected: boolean = false;
  private connectionAttempts: number = 0;
  private readonly maxRetries: number = 5;
  private readonly initialRetryDelay: number = 1000; // 1 second

  private constructor() {
    this.setupEventListeners();
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private setupEventListeners(): void {
    mongoose.connection.on('connected', () => {
      this.isConnected = true;
      this.connectionAttempts = 0;
      logger.info('MongoDB connected successfully');
    });

    mongoose.connection.on('error', (error) => {
      this.isConnected = false;
      logger.error('MongoDB connection error:', error);
    });

    mongoose.connection.on('disconnected', () => {
      this.isConnected = false;
      logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      this.isConnected = true;
      logger.info('MongoDB reconnected');
    });
  }

  public async connect(): Promise<void> {
    if (this.isConnected) {
      logger.info('📊 MongoDB already connected');
      return;
    }

    try {
      const options: mongoose.ConnectOptions = {
        maxPoolSize: env.MONGODB_POOL_SIZE,
        connectTimeoutMS: env.MONGODB_CONNECTION_TIMEOUT,
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 30000,
        family: 4,
        retryWrites: true,
        retryReads: true,
      };

      await mongoose.connect(env.MONGODB_URI, options);
      this.isConnected = true;
    } catch (error: any) {
      logger.error('Failed to connect to MongoDB:', error);
      await this.handleConnectionFailure();
      throw error;
    }
  }

  private async handleConnectionFailure(): Promise<void> {
    this.connectionAttempts++;

    if (this.connectionAttempts <= this.maxRetries) {
      const delay = this.initialRetryDelay * Math.pow(2, this.connectionAttempts - 1);
      logger.warn(`🔄 Retrying MongoDB connection in ${delay}ms (attempt ${this.connectionAttempts}/${this.maxRetries})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      await this.connect();
    } else {
      logger.error('💥 Maximum MongoDB connection retries exceeded');
      process.exit(1);
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await mongoose.disconnect();
      this.isConnected = false;
      logger.info('MongoDB disconnected gracefully');
    } catch (error:any) {
      logger.error('Error disconnecting from MongoDB:', error);
      throw error;
    }
  }

  public async healthCheck(): Promise<{ status: string; latency?: number }> {
    if (!this.isConnected || ! mongoose.connection.db) {
      return { status: 'disconnected' };
    }

    try {
      const start = Date.now();
      await mongoose.connection.db.admin().ping();
      const latency = Date.now() - start;

      return {
        status: 'healthy',
        latency,
      };
    } catch (error:any) {
      logger.error('MongoDB health check failed:', error);
      return { status: 'unhealthy' };
    }
  }

  public getConnectionState(): string {
    return mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  }

  public async withTransaction<T>(
    operation: (session: mongoose.ClientSession) => Promise<T>
  ): Promise<T> {
    const session = await mongoose.startSession();
    
    try {
      session.startTransaction();
      const result = await operation(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  public isHealthy(): boolean {
    return this.isConnected && mongoose.connection.readyState === 1;
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  logger.info('🔄 Received SIGINT, closing MongoDB connection...');
  await DatabaseManager.getInstance().disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🔄 Received SIGTERM, closing MongoDB connection...');
  await DatabaseManager.getInstance().disconnect();
  process.exit(0);
});

export const databaseManager = DatabaseManager.getInstance();