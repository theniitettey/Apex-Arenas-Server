import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexGame extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string; // unique, URL-friendly
  
  category: string; // enum: ['fps', 'moba', 'sports', 'fighting', 'battle_royale', 'card', 'racing', 'other']
  platform: string[];
  
  // Tournament configuration
  supported_formats: string[]; // ['1v1', '2v2', '5v5', 'squad', 'solo']
  default_format: string;
  supported_tournament_types: string[]; // ['single_elimination', 'double_elimination', 'round_robin']
  
  // In-game ID configuration - CRITICAL
  in_game_id_config: {
    label: string; // e.g., "Riot ID", "EA ID"
    format?: string; // regex pattern
    format_description?: string; // "Username#1234"
    example: string; // "ProPlayer#1234"
    is_required: boolean;
    case_sensitive: boolean;
  };
  
  // Media
  logo_url: string;
  banner_url: string;
  icon_url?: string;
  
  // Game-specific defaults
  default_rules?: {
    maps: string[];
    game_modes: string[];
    match_duration?: number;
    default_best_of: number;
  };
  
  // Metadata
  publisher?: string;
  release_year?: number;
  official_website?: string;
  
  // Stats
  stats: {
    tournaments_hosted: number;
    total_players: number;
    active_tournaments: number;
    total_prize_distributed: number;
  };
  
  // Admin controls
  is_active: boolean;
  is_featured: boolean;
  display_order: number;
  
  created_at: Date;
  updated_at: Date;
  added_by?: mongoose.Types.ObjectId;
}

/**
 * Indexes:
 * - slug (unique)
 * - is_active
 * - is_featured
 * - category
 * - display_order
 * - Compound: is_active + category
 * - Compound: is_active + is_featured + display_order
 */