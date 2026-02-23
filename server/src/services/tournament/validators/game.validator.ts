import { AppError } from '../../../shared/utils/error.utils';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

type GameCreateInput = {
  name: string;
  slug?: string;
  description?: string;
  category?: string;
  platform?: string[] | string;
  is_featured?: boolean;
  display_order?: number;
  in_game_id_config?: {
    format?: string;
    format_description?: string;
    case_sensitive?: boolean;
  };
  [key: string]: any;
};

type GameUpdateInput = Partial<GameCreateInput>;

class GameValidator {
  async validateCreate(data: any): Promise<GameCreateInput> {
    if (!data || typeof data !== 'object') {
      throw new AppError(ERROR_CODES.OPEN_VALIDATION_FAILED, 'Invalid payload');
    }

    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      throw new AppError(ERROR_CODES.OPEN_VALIDATION_FAILED, 'Game name is required');
    }

    return {
      ...data,
      name: data.name.trim()
    };
  }

  async validateUpdate(data: any): Promise<GameUpdateInput> {
    if (!data || typeof data !== 'object') {
      throw new AppError(ERROR_CODES.OPEN_VALIDATION_FAILED, 'Invalid payload');
    }

    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || !data.name.trim()) {
        throw new AppError(ERROR_CODES.OPEN_VALIDATION_FAILED, 'Game name must be a non-empty string');
      }
      data.name = data.name.trim();
    }

    return { ...data };
  }
}

export const gameValidator = new GameValidator();