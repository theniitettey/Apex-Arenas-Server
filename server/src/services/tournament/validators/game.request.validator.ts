import { AppError } from '../../../shared/utils/error.utils';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

type GameRequestInput = {
  game_name: string;
  category?: string;
  platform?: string[] | string;
  reason?: string;
  additional_info?: string;
  [key: string]: any;
};

class GameRequestValidator {
  async validateRequest(data: any): Promise<GameRequestInput> {
    if (!data || typeof data !== 'object') {
      throw new AppError(ERROR_CODES.OPEN_VALIDATION_FAILED, 'Invalid payload');
    }

    if (!data.game_name || typeof data.game_name !== 'string' || !data.game_name.trim()) {
      throw new AppError(ERROR_CODES.OPEN_VALIDATION_FAILED, 'Game name is required');
    }

    const sanitized: GameRequestInput = {
      ...data,
      game_name: data.game_name.trim()
    };

    if (sanitized.category !== undefined) {
      if (typeof sanitized.category !== 'string' || !sanitized.category.trim()) {
        throw new AppError(ERROR_CODES.OPEN_VALIDATION_FAILED, 'Category must be a non-empty string');
      }
      sanitized.category = sanitized.category.trim();
    }

    if (sanitized.reason !== undefined) {
      if (typeof sanitized.reason !== 'string' || !sanitized.reason.trim()) {
        throw new AppError(ERROR_CODES.OPEN_VALIDATION_FAILED, 'Reason must be a non-empty string');
      }
      sanitized.reason = sanitized.reason.trim();
    }

    if (sanitized.additional_info !== undefined) {
      if (typeof sanitized.additional_info !== 'string') {
        throw new AppError(ERROR_CODES.OPEN_VALIDATION_FAILED, 'Additional info must be a string');
      }
      sanitized.additional_info = sanitized.additional_info.trim();
    }

    if (sanitized.platform !== undefined) {
      const platform = Array.isArray(sanitized.platform)
        ? sanitized.platform
        : [sanitized.platform];

      const normalized = platform
        .filter(p => typeof p === 'string' && p.trim())
        .map(p => p.trim());

      if (!normalized.length) {
        throw new AppError(ERROR_CODES.OPEN_VALIDATION_FAILED, 'Platform must be a non-empty string or array');
      }

      sanitized.platform = normalized;
    }

    return sanitized;
  }
}

export const gameRequestValidator = new GameRequestValidator();