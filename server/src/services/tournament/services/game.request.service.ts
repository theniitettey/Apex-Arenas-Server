/**
 * create(userId, data) - User requests game
upvote(requestId, userId) - Upvote request
list(filters, sort) - List requests (sorted by upvotes)
adminReview(requestId, adminId, decision) - Approve/reject
createGameFromRequest(requestId) - Convert request to game
markDuplicate(requestId, duplicateOfId) - Mark as duplicate
 */

// file: game.request.service.ts

import mongoose from 'mongoose';
import { GameRequest, IApexGameRequest } from '../../models/game_request.model';
import { Game } from '../../models/games.model';
import { User } from '../../models/user.model';
import { gameService } from './game.service';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { GAME_REQUEST_ERROR_CODES } from '../../../shared/constants/error-codes';
import { gameRequestValidator } from '../validators/game.request.validator';
import { notificationHelper } from './notification.helper';

const logger = createLogger('game-request-service');

export class GameRequestService {
  // ============================================
  // CREATE GAME REQUEST
  // ============================================
  async create(userId: string, data: any): Promise<IApexGameRequest> {
    try {
      logger.info('Creating game request', { userId, gameName: data.game_name });

      // 1. Validate input
      const validated = await gameRequestValidator.validateRequest(data);

      // 2. Generate slug from game name
      const slug = this.generateSlug(validated.game_name);

      // 3. Check for existing pending/approved request with same slug
      const existing = await GameRequest.findOne({
        slug,
        status: { $in: ['pending', 'under_review', 'approved'] }
      });

      if (existing) {
        throw new AppError(
          GAME_REQUEST_ERROR_CODES.DUPLICATE_REQUEST,
          'A request for this game is already pending or approved'
        );
      }

      // 4. Also check if game already exists
      const existingGame = await Game.findOne({ slug });
      if (existingGame) {
        throw new AppError(
          GAME_REQUEST_ERROR_CODES.GAME_ALREADY_EXISTS,
          'This game already exists in our platform'
        );
      }

      // 5. Create request
      const request = await GameRequest.create({
        requester_id: new mongoose.Types.ObjectId(userId),
        ...validated,
        slug,
        upvotes: 1, // Auto-upvote from creator
        upvoted_by: [new mongoose.Types.ObjectId(userId)],
        status: 'pending',
        priority: 'low',
        created_at: new Date(),
        updated_at: new Date()
      });

      logger.info('Game request created', { requestId: request._id });
      return request;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Game request creation failed', { error: error.message });
      throw new AppError(
        GAME_REQUEST_ERROR_CODES.CREATE_FAILED,
        error.message || 'Failed to create game request'
      );
    }
  }

  // ============================================
  // UPVOTE REQUEST
  // ============================================
  async upvote(requestId: string, userId: string): Promise<IApexGameRequest> {
    try {
      logger.info('Upvoting game request', { requestId, userId });

      const request = await GameRequest.findById(requestId);
      if (!request) {
        throw new AppError(GAME_REQUEST_ERROR_CODES.NOT_FOUND, 'Game request not found');
      }

      // Check if user already upvoted
      const userIdObj = new mongoose.Types.ObjectId(userId);
      const alreadyUpvoted = request.upvoted_by.some(id => id.toString() === userId);

      if (alreadyUpvoted) {
        throw new AppError(
          GAME_REQUEST_ERROR_CODES.ALREADY_UPVOTED,
          'User has already upvoted this request'
        );
      }

      // Add upvote
      request.upvoted_by.push(userIdObj);
      request.upvotes += 1;
      await request.save();

      logger.info('Game request upvoted', { requestId, userId, totalUpvotes: request.upvotes });
      return request;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Upvote failed', { requestId, userId, error: error.message });
      throw new AppError(
        GAME_REQUEST_ERROR_CODES.UPVOTE_FAILED,
        error.message || 'Failed to upvote request'
      );
    }
  }

  // ============================================
  // LIST REQUESTS (with filters & sorting)
  // ============================================
  async list(
    filters: any = {},
    sort: any = { upvotes: -1, created_at: -1 }
  ): Promise<IApexGameRequest[]> {
    try {
      logger.info('Listing game requests', { filters });

      const query: any = {};

      if (filters.status) query.status = filters.status;
      if (filters.category) query.category = filters.category;
      if (filters.priority) query.priority = filters.priority;
      if (filters.requester_id) query.requester_id = filters.requester_id;
      if (filters.search) {
        query.$or = [
          { game_name: { $regex: filters.search, $options: 'i' } },
          { reason: { $regex: filters.search, $options: 'i' } }
        ];
      }

      const requests = await GameRequest.find(query)
        .sort(sort)
        .populate('requester_id', 'username profile.first_name profile.last_name profile.avatar_url')
        .populate('admin_review.reviewed_by', 'username')
        .lean();

      return requests;
    } catch (error: any) {
      logger.error('List game requests failed', { error: error.message });
      throw new AppError(
        GAME_REQUEST_ERROR_CODES.LIST_FAILED,
        error.message || 'Failed to list game requests'
      );
    }
  }

  // ============================================
  // ADMIN REVIEW (Approve/Reject/Mark Duplicate)
  // ============================================
  async adminReview(
    requestId: string,
    adminId: string,
    decision: 'approved' | 'rejected' | 'duplicate',
    options?: {
      reviewNotes?: string;
      rejectionReason?: string;
      duplicateOfId?: string;
    }
  ): Promise<IApexGameRequest> {
    try {
      logger.info('Admin reviewing game request', { requestId, adminId, decision });

      const request = await GameRequest.findById(requestId);
      if (!request) {
        throw new AppError(GAME_REQUEST_ERROR_CODES.NOT_FOUND, 'Game request not found');
      }

      // Update admin review fields
      request.admin_review = {
        reviewed_by: new mongoose.Types.ObjectId(adminId),
        reviewed_at: new Date(),
        review_notes: options?.reviewNotes || '',
        rejection_reason: options?.rejectionReason || ''
      };

      // Update status based on decision
      switch (decision) {
        case 'approved':
          request.status = 'approved';
          request.priority = 'high'; // Auto-prioritize approved requests
          break;
        case 'rejected':
          request.status = 'rejected';
          break;
        case 'duplicate':
          request.status = 'duplicate';
          if (options?.duplicateOfId) {
            request.duplicate_of = new mongoose.Types.ObjectId(options.duplicateOfId);
          }
          break;
      }

      request.reviewed_at = new Date();
      await request.save();

      // If approved, optionally create game from request (could be manual or automatic)
      // We'll not auto-create here, but provide a separate method.

      // Notify requester
      await notificationHelper.notifyGameRequestApproved?.(
        request.requester_id.toString(),
        request
      ).catch(err => {
        logger.error('Failed to send game request approval notification', { requestId, error: err.message });
      });

      logger.info('Game request reviewed', { requestId, decision });
      return request;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Admin review failed', { requestId, adminId, error: error.message });
      throw new AppError(
        GAME_REQUEST_ERROR_CODES.ADMIN_REVIEW_FAILED,
        error.message || 'Failed to process admin review'
      );
    }
  }

  // ============================================
  // CREATE GAME FROM REQUEST
  // ============================================
  async createGameFromRequest(requestId: string): Promise<any> {
    try {
      logger.info('Creating game from request', { requestId });

      const request = await GameRequest.findById(requestId);
      if (!request) {
        throw new AppError(GAME_REQUEST_ERROR_CODES.NOT_FOUND, 'Game request not found');
      }

      if (request.status !== 'approved') {
        throw new AppError(
          GAME_REQUEST_ERROR_CODES.REQUEST_NOT_APPROVED,
          'Cannot create game from non-approved request'
        );
      }

      if (request.approved_game_id) {
        throw new AppError(
          GAME_REQUEST_ERROR_CODES.GAME_ALREADY_CREATED,
          'Game has already been created from this request'
        );
      }

      // Check if game already exists (prevent race conditions)
      const existingGame = await Game.findOne({ slug: request.slug });
      if (existingGame) {
        // Link existing game and mark request as duplicate
        request.approved_game_id = existingGame._id;
        request.status = 'duplicate';
        await request.save();
        throw new AppError(
          GAME_REQUEST_ERROR_CODES.GAME_ALREADY_EXISTS,
          'Game already exists, request marked as duplicate'
        );
      }

      // Prepare game data from request
      const gameData = {
        name: request.game_name,
        slug: request.slug,
        category: request.category,
        platform: request.platform,
        supported_formats: ['1v1'], // Default – admin can update later
        default_format: '1v1',
        supported_tournament_types: ['single_elimination'],
        in_game_id_config: {
          label: `${request.game_name} ID`,
          format: '',
          format_description: '',
          example: '',
          is_required: true,
          case_sensitive: false
        },
        is_active: true,
        is_featured: false,
        display_order: 0,
        // Other default fields
      };

      // Use game service to create the game
      const game = await gameService.create(request.requester_id.toString(), gameData);

      // Update request with approved_game_id
      request.approved_game_id = game._id;
      await request.save();

      logger.info('Game created from request', { requestId, gameId: game._id });
      return game;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Create game from request failed', { requestId, error: error.message });
      throw new AppError(
        GAME_REQUEST_ERROR_CODES.CREATE_GAME_FAILED,
        error.message || 'Failed to create game from request'
      );
    }
  }

  // ============================================
  // MARK DUPLICATE
  // ============================================
  async markDuplicate(requestId: string, duplicateOfId: string): Promise<IApexGameRequest> {
    try {
      logger.info('Marking game request as duplicate', { requestId, duplicateOfId });

      const request = await GameRequest.findById(requestId);
      if (!request) {
        throw new AppError(GAME_REQUEST_ERROR_CODES.NOT_FOUND, 'Game request not found');
      }

      request.status = 'duplicate';
      request.duplicate_of = new mongoose.Types.ObjectId(duplicateOfId);
      await request.save();

      logger.info('Game request marked as duplicate', { requestId, duplicateOfId });
      return request;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Mark duplicate failed', { requestId, duplicateOfId, error: error.message });
      throw new AppError(
        GAME_REQUEST_ERROR_CODES.MARK_DUPLICATE_FAILED,
        error.message || 'Failed to mark request as duplicate'
      );
    }
  }

  // ============================================
  // GET REQUEST BY ID
  // ============================================
  async getById(requestId: string): Promise<IApexGameRequest> {
    try {
      const request = await GameRequest.findById(requestId)
        .populate('requester_id', 'username profile.first_name profile.last_name profile.avatar_url')
        .populate('admin_review.reviewed_by', 'username')
        .populate('duplicate_of', 'game_name')
        .populate('approved_game_id', 'name slug logo_url');

      if (!request) {
        throw new AppError(GAME_REQUEST_ERROR_CODES.NOT_FOUND, 'Game request not found');
      }

      return request;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Get game request failed', { requestId, error: error.message });
      throw new AppError(
        GAME_REQUEST_ERROR_CODES.FETCH_FAILED,
        error.message || 'Failed to fetch game request'
      );
    }
  }

  // ============================================
  // HELPER: Generate slug
  // ============================================
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

export const gameRequestService = new GameRequestService();