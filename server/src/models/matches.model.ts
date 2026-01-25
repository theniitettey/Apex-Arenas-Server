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
  
  participants: [
    {
      user_id?: mongoose.Types.ObjectId; // or team_id for team tournaments
      team_id?: mongoose.Types.ObjectId;
      in_game_id: string; // for result verification
      seed_number: number;
      score: number; // games won in best-of series
      result: string; // enum: ['win', 'loss', 'draw', 'no_show', 'pending']
      is_ready: boolean; // player confirmed ready
      ready_at?: Date;
    }
  ];
  
  // Individual games in a best-of series
  games?: [
    {
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
    }
  ];
  
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
 * - winner_id
 * - Compound: tournament_id + round + match_number (unique)
 * - Compound: tournament_id + status (for finding active matches)
 */