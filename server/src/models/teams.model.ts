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

const ApexTeamSchema = new Schema<IApexTeam>({
  name: { type: String, required: true, trim: true, maxlength: 50 },
  tag: { type: String, required: true, trim: true, maxlength: 10, uppercase: true },
  captain_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
  game_id: { type: Schema.Types.ObjectId, ref: 'Game', required: true },
  
  description: { type: String, maxlength: 500 },
  logo_url: { type: String, default: '' },
  banner_url: { type: String },
  
  social_links: {
    discord: { type: String },
    twitter: { type: String },
    youtube: { type: String },
    website: { type: String }
  },
  
  members: [{
    user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
    in_game_id: { type: String, required: true },
    role: { type: String, enum: ['captain', 'player', 'substitute'], default: 'player' },
    position: { type: String },
    joined_at: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'inactive', 'kicked'], default: 'active' }
  }],
  
  invitations: [{
    user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
    invited_by: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
    invited_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined', 'expired'], default: 'pending' }
  }],
  
  join_requests: [{
    user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
    message: { type: String, maxlength: 300 },
    requested_at: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
    reviewed_at: { type: Date }
  }],
  
  max_size: { type: Number, default: 10 },
  min_size: { type: Number, default: 1 },
  
  settings: {
    is_recruiting: { type: Boolean, default: false },
    auto_accept_invites: { type: Boolean, default: false },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' }
  },
  
  stats: {
    tournaments_played: { type: Number, default: 0 },
    tournaments_won: { type: Number, default: 0 },
    win_rate: { type: Number, default: 0 },
    total_earnings: { type: Number, default: 0 },
    matches_played: { type: Number, default: 0 },
    matches_won: { type: Number, default: 0 }
  },
  
  region: { type: String },
  
  disbanded_at: { type: Date },
  is_active: { type: Boolean, default: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexTeamSchema.index({ name: 1, game_id: 1 }, { unique: true });
ApexTeamSchema.index({ captain_id: 1 });
ApexTeamSchema.index({ game_id: 1 });
ApexTeamSchema.index({ 'members.user_id': 1 });
ApexTeamSchema.index({ 'invitations.user_id': 1 });
ApexTeamSchema.index({ 'join_requests.user_id': 1 });
ApexTeamSchema.index({ is_active: 1 });
ApexTeamSchema.index({ 'settings.is_recruiting': 1 });
ApexTeamSchema.index({ game_id: 1, is_active: 1, 'settings.is_recruiting': 1 });


export const Team = mongoose.model<IApexTeam>('ApexTeam', ApexTeamSchema);