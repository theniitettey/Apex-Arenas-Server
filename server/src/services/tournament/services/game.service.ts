/**
 * create(adminId, data) - Admin creates game
update(gameId, updates) - Update game
delete(gameId) - Delete game (if no tournaments)
getById(gameId) - Fetch game
list(filters) - List games
toggleActive(gameId) - Activate/deactivate
updateStats(gameId, statsUpdate) - Update statistics
validateInGameId(gameId, inGameId) - Validate format
 */

// file: game.service.ts

import mongoose from 'mongoose';
import { Game, IApexGame } from '../../models/games.model';
import { Tournament } from '../../models/tournaments.model';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { GAME_ERROR_CODES } from '../../../shared/constants/error-codes';
import { gameValidator } from '../validators/game.validator';

const logger = createLogger('game-service');

export class GameService {
  // ============================================
  // CREATE GAME (admin only)
  // ============================================
  async create(adminId: string, data: any): Promise<IApexGame> {
    try {
      logger.info('Creating new game', { adminId, name: data.name });

      // 1. Validate input
      const validated = await gameValidator.validateCreate(data);

      // 2. Generate slug from name
      const slug = this.generateSlug(validated.name);
      
      // 3. Check for duplicate slug
      const existing = await Game.findOne({ slug });
      if (existing) {
        throw new AppError(
          GAME_ERROR_CODES.DUPLICATE_SLUG,
          'A game with this name already exists'
        );
      }

      // 4. Create game document
      const game = await Game.create({
        ...validated,
        slug,
        added_by: new mongoose.Types.ObjectId(adminId),
        is_active: true,
        stats: {
          tournaments_hosted: 0,
          total_players: 0,
          active_tournaments: 0,
          total_prize_distributed: 0
        }
      });

      logger.info('Game created successfully', { gameId: game._id, slug });
      return game;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Game creation failed', { error: error.message });
      throw new AppError(
        GAME_ERROR_CODES.CREATE_FAILED,
        error.message || 'Failed to create game'
      );
    }
  }

  // ============================================
  // UPDATE GAME (admin only)
  // ============================================
  async update(gameId: string, updates: any): Promise<IApexGame> {
    try {
      logger.info('Updating game', { gameId });

      const game = await Game.findById(gameId);
      if (!game) {
        throw new AppError(GAME_ERROR_CODES.NOT_FOUND, 'Game not found');
      }

      // 1. Validate update data
      const validated = await gameValidator.validateUpdate(updates);

      // 2. If name is being updated, regenerate slug
      if (validated.name && validated.name !== game.name) {
        const newSlug = this.generateSlug(validated.name);
        // Check if slug already exists on another game
        const existing = await Game.findOne({ slug: newSlug, _id: { $ne: gameId } });
        if (existing) {
          throw new AppError(
            GAME_ERROR_CODES.DUPLICATE_SLUG,
            'A game with this name already exists'
          );
        }
        validated.slug = newSlug;
      }

      // 3. Apply updates
      Object.assign(game, validated);
      await game.save();

      logger.info('Game updated', { gameId });
      return game;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Game update failed', { gameId, error: error.message });
      throw new AppError(
        GAME_ERROR_CODES.UPDATE_FAILED,
        error.message || 'Failed to update game'
      );
    }
  }

  // ============================================
  // DELETE GAME (admin only) - only if no tournaments
  // ============================================
  async delete(gameId: string): Promise<void> {
    try {
      logger.info('Deleting game', { gameId });

      const game = await Game.findById(gameId);
      if (!game) {
        throw new AppError(GAME_ERROR_CODES.NOT_FOUND, 'Game not found');
      }

      // Check if any tournaments reference this game
      const tournamentsCount = await Tournament.countDocuments({ game_id: gameId });
      if (tournamentsCount > 0) {
        throw new AppError(
          GAME_ERROR_CODES.HAS_TOURNAMENTS,
          `Cannot delete game: ${tournamentsCount} tournament(s) use this game`
        );
      }

      await game.deleteOne();
      logger.info('Game deleted', { gameId });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Game deletion failed', { gameId, error: error.message });
      throw new AppError(
        GAME_ERROR_CODES.DELETE_FAILED,
        error.message || 'Failed to delete game'
      );
    }
  }

  // ============================================
  // GET GAME BY ID
  // ============================================
  async getById(gameId: string): Promise<IApexGame> {
    try {
      logger.info('Fetching game', { gameId });

      const game = await Game.findById(gameId);
      if (!game) {
        throw new AppError(GAME_ERROR_CODES.NOT_FOUND, 'Game not found');
      }

      return game;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Fetch game failed', { gameId, error: error.message });
      throw new AppError(
        GAME_ERROR_CODES.FETCH_FAILED,
        error.message || 'Failed to fetch game'
      );
    }
  }

  // ============================================
  // LIST GAMES (with filters)
  // ============================================
  async list(filters: any = {}): Promise<IApexGame[]> {
    try {
      logger.info('Listing games', { filters });

      const query: any = {};

      if (filters.is_active !== undefined) query.is_active = filters.is_active;
      if (filters.is_featured !== undefined) query.is_featured = filters.is_featured;
      if (filters.category) query.category = filters.category;
      if (filters.platform) {
        // platform is an array; we can match if any of the platforms are in the array
        query.platform = { $in: [filters.platform] };
      }
      if (filters.search) {
        query.$or = [
          { name: { $regex: filters.search, $options: 'i' } },
          { slug: { $regex: filters.search, $options: 'i' } }
        ];
      }

      const sort = filters.sort || { display_order: 1, name: 1 };

      const games = await Game.find(query).sort(sort);
      return games;
    } catch (error: any) {
      logger.error('List games failed', { error: error.message });
      throw new AppError(
        GAME_ERROR_CODES.LIST_FAILED,
        error.message || 'Failed to list games'
      );
    }
  }

  // ============================================
  // TOGGLE ACTIVE/INACTIVE
  // ============================================
  async toggleActive(gameId: string): Promise<IApexGame> {
    try {
      logger.info('Toggling game active status', { gameId });

      const game = await Game.findById(gameId);
      if (!game) {
        throw new AppError(GAME_ERROR_CODES.NOT_FOUND, 'Game not found');
      }

      game.is_active = !game.is_active;
      await game.save();

      logger.info('Game active status toggled', { gameId, is_active: game.is_active });
      return game;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Toggle active failed', { gameId, error: error.message });
      throw new AppError(
        GAME_ERROR_CODES.TOGGLE_ACTIVE_FAILED,
        error.message || 'Failed to toggle active status'
      );
    }
  }

  // ============================================
  // UPDATE STATISTICS
  // ============================================
  async updateStats(gameId: string, statsUpdate: {
    tournaments_hosted?: number; // increment/decrement
    total_players?: number;
    active_tournaments?: number;
    total_prize_distributed?: number;
  }): Promise<IApexGame> {
    try {
      logger.info('Updating game statistics', { gameId, statsUpdate });

      const game = await Game.findById(gameId);
      if (!game) {
        throw new AppError(GAME_ERROR_CODES.NOT_FOUND, 'Game not found');
      }

      if (statsUpdate.tournaments_hosted !== undefined) {
        game.stats.tournaments_hosted += statsUpdate.tournaments_hosted;
      }
      if (statsUpdate.total_players !== undefined) {
        game.stats.total_players += statsUpdate.total_players;
      }
      if (statsUpdate.active_tournaments !== undefined) {
        game.stats.active_tournaments += statsUpdate.active_tournaments;
      }
      if (statsUpdate.total_prize_distributed !== undefined) {
        game.stats.total_prize_distributed += statsUpdate.total_prize_distributed;
      }

      // Ensure no negative values
      if (game.stats.tournaments_hosted < 0) game.stats.tournaments_hosted = 0;
      if (game.stats.total_players < 0) game.stats.total_players = 0;
      if (game.stats.active_tournaments < 0) game.stats.active_tournaments = 0;
      if (game.stats.total_prize_distributed < 0) game.stats.total_prize_distributed = 0;

      await game.save();

      logger.info('Game statistics updated', { gameId });
      return game;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Update stats failed', { gameId, error: error.message });
      throw new AppError(
        GAME_ERROR_CODES.UPDATE_STATS_FAILED,
        error.message || 'Failed to update game statistics'
      );
    }
  }

  // ============================================
  // VALIDATE IN-GAME ID FORMAT
  // ============================================
  async validateInGameId(gameId: string, inGameId: string): Promise<{
    valid: boolean;
    formatted?: string;
    error?: string;
  }> {
    try {
      logger.info('Validating in-game ID format', { gameId, inGameId });

      const game = await Game.findById(gameId).select('in_game_id_config');
      if (!game) {
        throw new AppError(GAME_ERROR_CODES.NOT_FOUND, 'Game not found');
      }

      const config = game.in_game_id_config;
      if (!config || !config.format) {
        // No format defined – assume valid
        return { valid: true, formatted: inGameId };
      }

      try {
        const regex = new RegExp(config.format);
        const isValid = regex.test(inGameId);
        
        if (!isValid) {
          return {
            valid: false,
            error: config.format_description 
              ? `Format should be: ${config.format_description}`
              : `ID does not match required format`
          };
        }

        // Optionally apply formatting/case normalization
        let formatted = inGameId;
        if (!config.case_sensitive) {
          formatted = formatted.toLowerCase();
        }

        return { valid: true, formatted };
      } catch (regexError) {
        // If regex is invalid, log and consider valid
        logger.error('Invalid regex pattern in game config', { gameId, pattern: config.format });
        return { valid: true, formatted: inGameId };
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('In-game ID validation failed', { gameId, inGameId, error: error.message });
      throw new AppError(
        GAME_ERROR_CODES.VALIDATION_FAILED,
        error.message || 'Failed to validate in-game ID'
      );
    }
  }

  // ============================================
  // HELPER: Generate slug from name
  // ============================================
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

export const gameService = new GameService();