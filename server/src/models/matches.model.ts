import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexMatch extends Document {
  _id: mongoose.Types.ObjectId;
  tournament_id: mongoose.Types.ObjectId;
  round: number; // 1, 2, 3...
  round_name?: string; // optional: 'quarter_final', 'semi_final', 'final'
  match_number: number;
  
  // Match format
  format: {
    best_of: number; // 1, 3, 5, etc.
    games_played: number;
    games_to_win: number; // Math.ceil(best_of / 2)
  };
  
  // Bracket progression
  next_match_id?: mongoose.Types.ObjectId; // winner advances to this match
  previous_match_ids?: mongoose.Types.ObjectId[]; // matches that feed into this one
  bracket_position: string; // e.g., 'upper', 'lower', 'grand_final' (for double elim)
  
  participants: {
    user_id?: mongoose.Types.ObjectId; // or team_id for team tournaments
    team_id?: mongoose.Types.ObjectId;
    in_game_id: string; // for result verification
    seed_number: number;
    score: number; // games won in best-of series
    result: string; // enum: ['win', 'loss', 'draw', 'no_show', 'pending']
    is_ready: boolean; // player confirmed ready
    ready_at?: Date;
  }[];
  
  // Individual games in a best-of series
  games?: {
    game_number: number; // 1, 2, 3...
    winner_id?: mongoose.Types.ObjectId;
    scores: [
      {
        participant_id: mongoose.Types.ObjectId;
        score: number;
      }
    ];
    map?: string;
    duration_minutes?: number;
    started_at?: Date;
    completed_at?: Date;
  }[];
  
  winner_id?: mongoose.Types.ObjectId; // user_id or team_id
  loser_id?: mongoose.Types.ObjectId; // useful for loser bracket in double elim
  
  schedule: {
    scheduled_time: Date;
    ready_check_time?: Date; // when both players must be ready
    started_at?: Date;
    completed_at?: Date;
  };
  
  status: string; // enum: ['pending', 'scheduled', 'ongoing', 'completed', 'disputed', 'cancelled']
  
  game_details: {
    map?: string;
    game_mode?: string;
    duration_minutes?: number;
  };
  
  // Who reports the result
  result_reported_by?: mongoose.Types.ObjectId;
  result_reported_at?: Date;
  result_confirmed_by?: mongoose.Types.ObjectId; // opponent confirms
  result_confirmed_at?: Date;
  
  proof: {
    screenshots: string[]; // URLs
    video_url?: string;
    submitted_by?: mongoose.Types.ObjectId;
    submitted_at?: Date;
  };
  
  dispute: {
    is_disputed: boolean;
    disputed_by?: mongoose.Types.ObjectId;
    dispute_reason?: string;
    disputed_at?: Date;
    evidence?: string[]; // URLs to evidence
    resolved: boolean;
    resolution?: string;
    resolved_at?: Date;
    resolved_by?: mongoose.Types.ObjectId; // admin who resolved
  };
  
  // Admin override
  admin_override?: {
    overridden: boolean;
    overridden_by?: mongoose.Types.ObjectId;
    overridden_at?: Date;
    reason?: string;
    original_winner_id?: mongoose.Types.ObjectId;
  };

  // Add to IApexMatch
  timeouts: {
    no_show_timeout_minutes: number; // default: 15
    result_submission_deadline?: Date;
    auto_forfeit_enabled: boolean;
  };
  
  created_at: Date;
  updated_at: Date;
}


const ApexMatchSchema = new Schema<IApexMatch>({
  tournament_id: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true },
  round: { type: Number, required: true },
  round_name: { type: String },
  match_number: { type: Number, required: true },
  
  format: {
    best_of: { type: Number, default: 1 },
    games_played: { type: Number, default: 0 },
    games_to_win: { type: Number, default: 1 }
  },
  
  next_match_id: { type: Schema.Types.ObjectId, ref: 'Match' },
  previous_match_ids: [{ type: Schema.Types.ObjectId, ref: 'Match' }],
  bracket_position: { type: String, enum: ['upper', 'lower', 'grand_final', 'main'], default: 'main' },
  
  participants: [{
    user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
    team_id: { type: Schema.Types.ObjectId, ref: 'Team' },
    in_game_id: { type: String, required: true },
    seed_number: { type: Number },
    score: { type: Number, default: 0 },
    result: { type: String, enum: ['win', 'loss', 'draw', 'no_show', 'pending'], default: 'pending' },
    is_ready: { type: Boolean, default: false },
    ready_at: { type: Date }
  }],
  
  games: [{
    game_number: { type: Number, required: true },
    winner_id: { type: Schema.Types.ObjectId },
    scores: [{
      participant_id: { type: Schema.Types.ObjectId, required: true },
      score: { type: Number, default: 0 }
    }],
    map: { type: String },
    duration_minutes: { type: Number },
    started_at: { type: Date },
    completed_at: { type: Date }
  }],
  
  winner_id: { type: Schema.Types.ObjectId },
  loser_id: { type: Schema.Types.ObjectId },
  
  schedule: {
    scheduled_time: { type: Date, required: true },
    ready_check_time: { type: Date },
    started_at: { type: Date },
    completed_at: { type: Date }
  },
  
  status: { 
    type: String, 
    enum: ['pending', 'scheduled', 'ready_check', 'ongoing', 'completed', 'disputed', 'cancelled'],
    default: 'pending' 
  },
  
  game_details: {
    map: { type: String },
    game_mode: { type: String },
    duration_minutes: { type: Number }
  },
  
  result_reported_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
  result_reported_at: { type: Date },
  result_confirmed_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
  result_confirmed_at: { type: Date },
  
  proof: {
    screenshots: [{ type: String }],
    video_url: { type: String },
    submitted_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
    submitted_at: { type: Date }
  },
  
  dispute: {
    is_disputed: { type: Boolean, default: false },
    disputed_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
    dispute_reason: { type: String },
    disputed_at: { type: Date },
    evidence: [{ type: String }],
    resolved: { type: Boolean, default: false },
    resolution: { type: String },
    resolved_at: { type: Date },
    resolved_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' }
  },
  
  admin_override: {
    overridden: { type: Boolean, default: false },
    overridden_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
    overridden_at: { type: Date },
    reason: { type: String },
    original_winner_id: { type: Schema.Types.ObjectId }
  },

  // Add to IApexMatch
  timeouts: {
    no_show_timeout_minutes: {type: Number},// default: 15
    result_submission_deadline: {type: Date},
    auto_forfeit_enabled: {type: Boolean}
  },

}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexMatchSchema.index({ tournament_id: 1 });
ApexMatchSchema.index({ status: 1 });
ApexMatchSchema.index({ 'participants.user_id': 1 });
ApexMatchSchema.index({ 'participants.team_id': 1 });
ApexMatchSchema.index({ 'schedule.scheduled_time': 1 });
ApexMatchSchema.index({ next_match_id: 1 }, { sparse: true });
ApexMatchSchema.index({ winner_id: 1 }, { sparse: true });
ApexMatchSchema.index({ tournament_id: 1, round: 1, match_number: 1 }, { unique: true });
ApexMatchSchema.index({ tournament_id: 1, status: 1 });


export const Match = mongoose.model<IApexMatch>('ApexMatch', ApexMatchSchema);