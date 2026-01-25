import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexTeam extends Document {
  _id: mongoose.Types.ObjectId;
  name: string; // unique per game
  tag: string; // team abbreviation
  captain_id: mongoose.Types.ObjectId; // reference to users
  game_id: mongoose.Types.ObjectId; // reference to games - teams are game-specific
  
  members: [
    {
      user_id: mongoose.Types.ObjectId;
      in_game_id: string; // player's in-game ID for this game
      role: string; // enum: ['captain', 'player', 'substitute']
      joined_at: Date;
      status: string; // enum: ['active', 'inactive', 'kicked']
    }
  ];
  
  max_size: number;
  
  logo_url: string;
  
  stats: {
    tournaments_played: number;
    tournaments_won: number;
    win_rate: number;
  };
  
  created_at: Date;
  updated_at: Date;
  is_active: boolean;
}

/**
 * Indexes:
 * - Compound: name + game_id (unique) - team names unique per game
 * - captain_id
 * - game_id
 * - members.user_id
 * - is_active
 */