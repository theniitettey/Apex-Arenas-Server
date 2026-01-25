import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexMatch extends Document {
  _id: mongoose.Types.ObjectId;
  tournament_id: mongoose.Types.ObjectId;
  round: number; // 1, 2, 3...
  round_name?: string; // optional: 'quarter_final', 'semi_final', 'final'
  match_number: number;
  
  // Bracket progression
  next_match_id?: mongoose.Types.ObjectId; // winner advances to this match
  previous_match_ids?: mongoose.Types.ObjectId[]; // matches that feed into this one
  bracket_position: string; // e.g., 'upper', 'lower', 'grand_final' (for double elim)
  
  participants: [
    {
      user_id?: mongoose.Types.ObjectId; // or team_id for team tournaments
      team_id?: mongoose.Types.ObjectId;
      in_game_id: string; // for result verification
      seed_number: number;
      score: number;
      result: string; // enum: ['win', 'loss', 'draw', 'no_show', 'pending']
    }
  ];
  
  winner_id?: mongoose.Types.ObjectId; // user_id or team_id
  
  schedule: {
    scheduled_time: Date;
    started_at?: Date;
    completed_at?: Date;
  };
  
  status: string; // enum: ['pending', 'scheduled', 'ongoing', 'completed', 'disputed', 'cancelled']
  
  game_details: {
    map?: string;
    game_mode?: string;
    duration_minutes?: number;
  };
  
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
    resolved: boolean;
    resolution?: string;
    resolved_at?: Date;
    resolved_by?: mongoose.Types.ObjectId; // admin who resolved
  };
  
  created_at: Date;
  updated_at: Date;
}

/**
 * Indexes:
 * - tournament_id
 * - status
 * - participants.user_id
 * - participants.team_id
 * - schedule.scheduled_time
 * - next_match_id
 * - Compound: tournament_id + round + match_number (unique)
 */