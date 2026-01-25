import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexGame extends Document {
  _id: mongoose.Types.ObjectId;
  name: string; // e.g., "Valorant", "FIFA 24"
  slug: string; // unique, e.g., "valorant"
  
  category: string; // enum: ['fps', 'moba', 'sports', 'fighting', 'battle_royale', 'card', 'racing']
  platform: string[]; // e.g., ['pc', 'ps5', 'xbox', 'mobile']
  
  // Tournament configuration
  supported_formats: string[]; // e.g., ['1v1', '2v2', '5v5', 'squad', 'solo']
  default_format: string; // most common format for this game
  
  // In-game ID configuration
  in_game_id_label: string; // e.g., "Riot ID", "EA ID", "Activision ID", "Epic Username"
  in_game_id_format?: string; // regex pattern or description, e.g., "Username#TAG"
  in_game_id_example?: string; // e.g., "Player#1234"
  
  logo_url: string;
  banner_url: string;
  
  // Game-specific rules template
  default_rules?: {
    maps: string[];
    game_modes: string[];
    match_duration?: number; // in minutes
  };
  
  is_active: boolean;
  
  // Stats
  tournaments_hosted: number;
  total_players: number;
  
  created_at: Date;
  updated_at: Date;
}

/**
 * Indexes:
 * - slug (unique)
 * - is_active
 * - category
 * - Compound: is_active + category (for filtering active games by category)
 */