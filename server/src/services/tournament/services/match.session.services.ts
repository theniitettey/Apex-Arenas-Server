/**
 * createSession(matchId) - Create chat session when match starts
getSession(matchId, userId) - Get session if user is participant
sendMessage(matchId, userId, message) - Add chat message
uploadEvidence(matchId, userId, fileUrl) - Upload proof
getMessages(matchId, pagination) - Get chat history
notifyParticipants(sessionId, notification) - Notify all in session
archiveSession(matchId) - Make read-only after resolution
getArchivedSessions(userId) - User's past sessions
 */

// file: match.session.services.ts

import mongoose, { Document, Schema, Model } from 'mongoose';
import { Match } from '../../models/matches.model';
import { User } from '../../models/user.model';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { notificationHelper } from './notification.helper';

const logger = createLogger('match-session-service');

// -------------------------------------------------------------------------
// Local error codes (to be moved to shared constants)
// -------------------------------------------------------------------------
const MATCH_SESSION_ERROR_CODES = {
  NOT_FOUND: 'MATCH_SESSION_NOT_FOUND',
  ALREADY_EXISTS: 'MATCH_SESSION_ALREADY_EXISTS',
  UNAUTHORIZED: 'MATCH_SESSION_UNAUTHORIZED',
  MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
  CREATE_FAILED: 'MATCH_SESSION_CREATE_FAILED',
  FETCH_FAILED: 'MATCH_SESSION_FETCH_FAILED',
  MESSAGE_FAILED: 'MATCH_SESSION_MESSAGE_FAILED',
  EVIDENCE_FAILED: 'MATCH_SESSION_EVIDENCE_FAILED',
  NOTIFY_FAILED: 'MATCH_SESSION_NOTIFY_FAILED',
  ARCHIVE_FAILED: 'MATCH_SESSION_ARCHIVE_FAILED',
  ARCHIVED_SESSIONS_FAILED: 'MATCH_SESSION_ARCHIVED_FAILED',
};

// -------------------------------------------------------------------------
// Message Subdocument Schema
// -------------------------------------------------------------------------
interface IMessage {
  _id?: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  username?: string; // denormalized for quick display
  message: string;
  type: 'text' | 'system' | 'evidence';
  attachments?: string[];
  created_at: Date;
  edited: boolean;
  edited_at?: Date;
}

const MessageSchema = new Schema<IMessage>({
  user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
  username: { type: String },
  message: { type: String, required: true, maxlength: 1000 },
  type: { type: String, enum: ['text', 'system', 'evidence'], default: 'text' },
  attachments: [{ type: String }],
  created_at: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  edited_at: { type: Date }
});

// -------------------------------------------------------------------------
// Match Session Model Interface
// -------------------------------------------------------------------------
export interface IApexMatchSession extends Document {
  _id: mongoose.Types.ObjectId;
  match_id: mongoose.Types.ObjectId;
  tournament_id: mongoose.Types.ObjectId;
  
  // Participants (denormalized for quick auth checks)
  participant_ids: mongoose.Types.ObjectId[];
  organizer_id: mongoose.Types.ObjectId;
  
  // Session data
  status: 'active' | 'archived' | 'locked';
  started_at: Date;
  ended_at?: Date;
  
  // Messages
  messages: IMessage[];
  message_count: number;
  
  // Evidence (screenshots, videos)
  evidence: Array<{
    _id?: mongoose.Types.ObjectId;
    user_id: mongoose.Types.ObjectId;
    username?: string;
    file_url: string;
    file_type: string; // 'image', 'video', 'other'
    uploaded_at: Date;
    description?: string;
  }>;
  
  // Settings
  is_read_only: boolean;
  allow_evidence_upload: boolean;
  
  created_at: Date;
  updated_at: Date;
}

const MatchSessionSchema = new Schema<IApexMatchSession>({
  match_id: { type: Schema.Types.ObjectId, ref: 'ApexMatch', required: true, unique: true },
  tournament_id: { type: Schema.Types.ObjectId, ref: 'ApexTournament', required: true },
  
  participant_ids: [{ type: Schema.Types.ObjectId, ref: 'ApexUser', required: true }],
  organizer_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
  
  status: { type: String, enum: ['active', 'archived', 'locked'], default: 'active' },
  started_at: { type: Date, default: Date.now },
  ended_at: { type: Date },
  
  messages: [MessageSchema],
  message_count: { type: Number, default: 0 },
  
  evidence: [{
    user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
    username: { type: String },
    file_url: { type: String, required: true },
    file_type: { type: String, enum: ['image', 'video', 'other'], required: true },
    uploaded_at: { type: Date, default: Date.now },
    description: { type: String, maxlength: 500 }
  }],
  
  is_read_only: { type: Boolean, default: false },
  allow_evidence_upload: { type: Boolean, default: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
MatchSessionSchema.index({ match_id: 1 }, { unique: true });
MatchSessionSchema.index({ tournament_id: 1 });
MatchSessionSchema.index({ participant_ids: 1 });
MatchSessionSchema.index({ status: 1 });
MatchSessionSchema.index({ started_at: -1 });

export const MatchSession = mongoose.model<IApexMatchSession>('ApexMatchSession', MatchSessionSchema);

// -------------------------------------------------------------------------
// Service Class
// -------------------------------------------------------------------------
export class MatchSessionService {
  // ============================================
  // CREATE SESSION (when match starts)
  // ============================================
  async createSession(matchId: string): Promise<IApexMatchSession> {
    try {
      logger.info('Creating match session', { matchId });

      // 1. Check if session already exists
      const existing = await MatchSession.findOne({ match_id: matchId });
      if (existing) {
        throw new AppError(
          MATCH_SESSION_ERROR_CODES.ALREADY_EXISTS,
          'Match session already exists for this match'
        );
      }

      // 2. Fetch match with participants
      const match = await Match.findById(matchId)
        .populate('participants.user_id', 'username')
        .populate('tournament_id', 'organizer_id');
      
      if (!match) {
        throw new AppError(
          MATCH_SESSION_ERROR_CODES.MATCH_NOT_FOUND,
          'Match not found'
        );
      }

      // 3. Extract participant user IDs (only individual users, not teams)
      const participantIds: mongoose.Types.ObjectId[] = [];
      match.participants.forEach(p => {
        if (p.user_id) {
          participantIds.push(p.user_id as mongoose.Types.ObjectId);
        }
        // If team, we might need to get all team members – for simplicity, skip
      });

      // 4. Get organizer ID from tournament
      const tournament = match.tournament_id as any;
      const organizerId = tournament.organizer_id;

      // 5. Create session
      const session = await MatchSession.create({
        match_id: match._id,
        tournament_id: match.tournament_id,
        participant_ids: participantIds,
        organizer_id: organizerId,
        started_at: new Date(),
        status: 'active',
        messages: [],
        message_count: 0,
        evidence: [],
        is_read_only: false,
        allow_evidence_upload: true
      });

      // 6. Send system message
      await this.addSystemMessage(session._id.toString(), 'Match session started');

      logger.info('Match session created', { sessionId: session._id, matchId });
      return session;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Create session failed', { matchId, error: error.message });
      throw new AppError(
        MATCH_SESSION_ERROR_CODES.CREATE_FAILED,
        error.message || 'Failed to create match session'
      );
    }
  }

  // ============================================
  // GET SESSION (with participant authorization)
  // ============================================
  async getSession(matchId: string, userId: string): Promise<IApexMatchSession> {
    try {
      logger.info('Fetching match session', { matchId, userId });

      const session = await MatchSession.findOne({ match_id: matchId });
      if (!session) {
        throw new AppError(
          MATCH_SESSION_ERROR_CODES.NOT_FOUND,
          'Match session not found'
        );
      }

      // Authorization: user must be participant or tournament organizer
      const isParticipant = session.participant_ids.some(
        id => id.toString() === userId
      );
      const isOrganizer = session.organizer_id.toString() === userId;

      if (!isParticipant && !isOrganizer) {
        throw new AppError(
          MATCH_SESSION_ERROR_CODES.UNAUTHORIZED,
          'You are not authorized to view this session'
        );
      }

      return session;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Get session failed', { matchId, userId, error: error.message });
      throw new AppError(
        MATCH_SESSION_ERROR_CODES.FETCH_FAILED,
        error.message || 'Failed to fetch match session'
      );
    }
  }

  // ============================================
  // SEND MESSAGE
  // ============================================
  async sendMessage(
    matchId: string,
    userId: string,
    message: string
  ): Promise<IApexMatchSession> {
    try {
      logger.info('Sending message', { matchId, userId });

      const session = await this.getSession(matchId, userId);
      
      if (session.is_read_only || session.status !== 'active') {
        throw new AppError(
          MATCH_SESSION_ERROR_CODES.UNAUTHORIZED,
          'Session is read-only or archived'
        );
      }

      // Fetch user for username denormalization
      const user = await User.findById(userId).select('username');
      const username = user?.username || 'Unknown';

      const newMessage: IMessage = {
        user_id: new mongoose.Types.ObjectId(userId),
        username,
        message,
        type: 'text',
        created_at: new Date(),
        edited: false
      };

      session.messages.push(newMessage);
      session.message_count += 1;
      await session.save();

      logger.info('Message sent', { sessionId: session._id, messageId: newMessage._id });
      return session;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Send message failed', { matchId, userId, error: error.message });
      throw new AppError(
        MATCH_SESSION_ERROR_CODES.MESSAGE_FAILED,
        error.message || 'Failed to send message'
      );
    }
  }

  // ============================================
  // UPLOAD EVIDENCE
  // ============================================
  async uploadEvidence(
    matchId: string,
    userId: string,
    fileUrl: string,
    fileType: 'image' | 'video' | 'other' = 'image',
    description?: string
  ): Promise<IApexMatchSession> {
    try {
      logger.info('Uploading evidence', { matchId, userId, fileUrl });

      const session = await this.getSession(matchId, userId);
      
      if (!session.allow_evidence_upload || session.is_read_only || session.status !== 'active') {
        throw new AppError(
          MATCH_SESSION_ERROR_CODES.UNAUTHORIZED,
          'Evidence upload is not allowed at this time'
        );
      }

      const user = await User.findById(userId).select('username');
      const username = user?.username || 'Unknown';

      session.evidence.push({
        user_id: new mongoose.Types.ObjectId(userId),
        username,
        file_url: fileUrl,
        file_type: fileType,
        uploaded_at: new Date(),
        description
      });
      await session.save();

      // Also add a system message about evidence upload
      await this.addSystemMessage(
        session._id.toString(),
        `${username} uploaded evidence: ${fileType}`
      );

      logger.info('Evidence uploaded', { sessionId: session._id });
      return session;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Upload evidence failed', { matchId, userId, error: error.message });
      throw new AppError(
        MATCH_SESSION_ERROR_CODES.EVIDENCE_FAILED,
        error.message || 'Failed to upload evidence'
      );
    }
  }

  // ============================================
  // GET MESSAGES (paginated)
  // ============================================
  async getMessages(
    matchId: string,
    userId: string,
    pagination: { page?: number; limit?: number; before?: Date } = {}
  ): Promise<{ messages: IMessage[]; total: number; hasMore: boolean }> {
    try {
      const session = await this.getSession(matchId, userId);
      
      const { page = 1, limit = 50, before } = pagination;
      
      let messages = session.messages.sort((a, b) => 
        b.created_at.getTime() - a.created_at.getTime()
      ); // newest first for pagination

      if (before) {
        messages = messages.filter(m => m.created_at < before);
      }

      const total = messages.length;
      const start = (page - 1) * limit;
      const end = start + limit;
      const paginatedMessages = messages.slice(start, end);
      
      return {
        messages: paginatedMessages,
        total,
        hasMore: end < total
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Get messages failed', { matchId, userId, error: error.message });
      throw new AppError(
        MATCH_SESSION_ERROR_CODES.FETCH_FAILED,
        error.message || 'Failed to fetch messages'
      );
    }
  }

  // ============================================
  // NOTIFY PARTICIPANTS
  // ============================================
  async notifyParticipants(
    sessionId: string,
    notification: { title: string; message: string; type?: string }
  ): Promise<void> {
    try {
      logger.info('Notifying session participants', { sessionId });

      const session = await MatchSession.findById(sessionId);
      if (!session) {
        throw new AppError(
          MATCH_SESSION_ERROR_CODES.NOT_FOUND,
          'Session not found'
        );
      }

      // Send notification to each participant via notification helper
      for (const participantId of session.participant_ids) {
        await notificationHelper.notifyMatchStarting?.(
          [participantId.toString()],
          { _id: session.match_id } as any // simplified
        ).catch(err => {
          logger.error('Failed to notify participant', { participantId, error: err.message });
        });
      }

      logger.info('Participants notified', { sessionId });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Notify participants failed', { sessionId, error: error.message });
      throw new AppError(
        MATCH_SESSION_ERROR_CODES.NOTIFY_FAILED,
        error.message || 'Failed to notify participants'
      );
    }
  }

  // ============================================
  // ARCHIVE SESSION
  // ============================================
  async archiveSession(matchId: string): Promise<IApexMatchSession> {
    try {
      logger.info('Archiving match session', { matchId });

      const session = await MatchSession.findOne({ match_id: matchId });
      if (!session) {
        throw new AppError(
          MATCH_SESSION_ERROR_CODES.NOT_FOUND,
          'Match session not found'
        );
      }

      session.status = 'archived';
      session.is_read_only = true;
      session.allow_evidence_upload = false;
      session.ended_at = new Date();
      await session.save();

      await this.addSystemMessage(session._id.toString(), 'Match session archived');

      logger.info('Session archived', { sessionId: session._id });
      return session;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Archive session failed', { matchId, error: error.message });
      throw new AppError(
        MATCH_SESSION_ERROR_CODES.ARCHIVE_FAILED,
        error.message || 'Failed to archive session'
      );
    }
  }

  // ============================================
  // GET ARCHIVED SESSIONS (for a user)
  // ============================================
  async getArchivedSessions(
    userId: string,
    pagination: { page?: number; limit?: number } = {}
  ): Promise<{ sessions: IApexMatchSession[]; total: number }> {
    try {
      logger.info('Fetching archived sessions for user', { userId });

      const { page = 1, limit = 20 } = pagination;
      const skip = (page - 1) * limit;

      const query = {
        participant_ids: new mongoose.Types.ObjectId(userId),
        status: 'archived'
      };

      const [sessions, total] = await Promise.all([
        MatchSession.find(query)
          .populate('match_id', 'round match_number schedule')
          .populate('tournament_id', 'title game_id')
          .sort({ ended_at: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        MatchSession.countDocuments(query)
      ]);

      return { sessions, total };
    } catch (error: any) {
      logger.error('Get archived sessions failed', { userId, error: error.message });
      throw new AppError(
        MATCH_SESSION_ERROR_CODES.ARCHIVED_SESSIONS_FAILED,
        error.message || 'Failed to fetch archived sessions'
      );
    }
  }

  // ============================================
  // PRIVATE: Add system message
  // ============================================
  private async addSystemMessage(sessionId: string, text: string): Promise<void> {
    try {
      const session = await MatchSession.findById(sessionId);
      if (!session) return;

      const systemMessage: IMessage = {
        user_id: session.organizer_id, // system messages attributed to organizer? better have a system user.
        username: 'System',
        message: text,
        type: 'system',
        created_at: new Date(),
        edited: false
      };

      session.messages.push(systemMessage);
      session.message_count += 1;
      await session.save();
    } catch (error) {
      logger.error('Failed to add system message', { sessionId, error: error.message });
    }
  }
}

export const matchSessionService = new MatchSessionService();