import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexTeam extends Document {
  _id: mongoose.Types.ObjectId;
  name: string; // unique per game
  tag: string; // team abbreviation
  captain_id: mongoose.Types.ObjectId; // reference to users
  game_id: mongoose.Types.ObjectId; // reference to games - teams are game-specific
  
  // Team profile
  description?: string;
  logo_url: string;
  banner_url?: string;
  
  social_links?: {
    discord?: string;
    twitter?: string;
    youtube?: string;
    website?: string;
  };
  
  members: [
    {
      user_id: mongoose.Types.ObjectId;
      in_game_id: string; // player's in-game ID for this game
      role: string; // enum: ['captain', 'player', 'substitute']
      position?: string; // e.g., 'IGL', 'Entry', 'Support' - game specific
      joined_at: Date;
      status: string; // enum: ['active', 'inactive', 'kicked']
    }
  ];
  
  // Pending invitations
  invitations: [
    {
      user_id: mongoose.Types.ObjectId;
      invited_by: mongoose.Types.ObjectId;
      invited_at: Date;
      expires_at: Date;
      status: string; // enum: ['pending', 'accepted', 'declined', 'expired']
    }
  ];
  
  // Join requests (players wanting to join)
  join_requests: [
    {
      user_id: mongoose.Types.ObjectId;
      message?: string;
      requested_at: Date;
      status: string; // enum: ['pending', 'accepted', 'declined']
      reviewed_by?: mongoose.Types.ObjectId;
      reviewed_at?: Date;
    }
  ];
  
  max_size: number;
  min_size: number; // minimum to participate in tournaments
  
  // Team settings
  settings: {
    is_recruiting: boolean;
    auto_accept_invites: boolean;
    visibility: string; // enum: ['public', 'private']
  };
  
  stats: {
    tournaments_played: number;
    tournaments_won: number;
    win_rate: number;
    total_earnings: number;
    matches_played: number;
    matches_won: number;
  };
  
  region?: string; // e.g., 'GH', 'NG'
  
  created_at: Date;
  updated_at: Date;
  disbanded_at?: Date; // if team is disbanded
  is_active: boolean;
}

/**
 * Indexes:
 * - Compound: name + game_id (unique) - team names unique per game
 * - captain_id
 * - game_id
 * - members.user_id
 * - invitations.user_id
 * - join_requests.user_id
 * - is_active
 * - settings.is_recruiting
 */