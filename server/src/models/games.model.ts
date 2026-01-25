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



const ApexGameSchema = new Schema<IApexGame>({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  
  category: { 
    type: String, 
    enum: ['fps', 'moba', 'sports', 'fighting', 'battle_royale', 'card', 'racing', 'other'],
    required: true 
  },
  platform: [{ 
    type: String, 
    enum: ['pc', 'ps4', 'ps5', 'xbox', 'nintendo', 'mobile', 'cross_platform'] 
  }],
  
  supported_formats: [{ type: String }],
  default_format: { type: String },
  supported_tournament_types: [{ 
    type: String, 
    enum: ['single_elimination', 'double_elimination', 'round_robin', 'swiss', 'battle_royale'] 
  }],
  
  in_game_id_config: {
    label: { type: String, required: true },
    format: { type: String },
    format_description: { type: String },
    example: { type: String, required: true },
    is_required: { type: Boolean, default: true },
    case_sensitive: { type: Boolean, default: false }
  },
  
  logo_url: { type: String, default: '' },
  banner_url: { type: String, default: '' },
  icon_url: { type: String },
  
  default_rules: {
    maps: [{ type: String }],
    game_modes: [{ type: String }],
    match_duration: { type: Number },
    default_best_of: { type: Number, default: 1 }
  },
  
  publisher: { type: String },
  release_year: { type: Number },
  official_website: { type: String },
  
  stats: {
    tournaments_hosted: { type: Number, default: 0 },
    total_players: { type: Number, default: 0 },
    active_tournaments: { type: Number, default: 0 },
    total_prize_distributed: { type: Number, default: 0 }
  },
  
  is_active: { type: Boolean, default: true },
  is_featured: { type: Boolean, default: false },
  display_order: { type: Number, default: 0 },
  
  added_by: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexGameSchema.index({ slug: 1 }, { unique: true });
ApexGameSchema.index({ is_active: 1 });
ApexGameSchema.index({ is_featured: 1 });
ApexGameSchema.index({ category: 1 });
ApexGameSchema.index({ display_order: 1 });
ApexGameSchema.index({ is_active: 1, category: 1 });
ApexGameSchema.index({ is_active: 1, is_featured: 1, display_order: 1 });

export const Game = mongoose.model<IApexGame>('ApexGame', ApexGameSchema);