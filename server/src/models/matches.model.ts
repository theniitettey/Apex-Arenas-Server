import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexMatch extends Document{
  _id: mongoose.Types.ObjectId,
  tournament_id: mongoose.Types.ObjectId,
  round: Number, // 1, 2, 3... (or 'quarter_final', 'semi_final', 'final')
  match_number: Number,
  
  participants: [
    {
      user_id: mongoose.Types.ObjectId, // or team_id
      seed_number: Number,
      score: Number,
      result: String // enum: ['win', 'loss', 'draw', 'no_show']
    }
  ],
  
  winner_id: mongoose.Types.ObjectId,
  
  schedule: {
    scheduled_time: Date,
    started_at: Date,
    completed_at: Date
  },
  
  status: String, // enum: ['scheduled', 'ongoing', 'completed', 'disputed', 'cancelled']
  
  game_details: {
    map: String,
    game_mode: String,
    duration_minutes: Number
  },
  
  proof: {
    screenshots: [String], // URLs
    video_url: String,
    submitted_by: mongoose.Types.ObjectId,
    submitted_at: Date
  },
  
  dispute: {
    is_disputed: Boolean,
    disputed_by: mongoose.Types.ObjectId,
    dispute_reason: String,
    disputed_at: Date,
    resolved: Boolean,
    resolution: String,
    resolved_at: Date,
    resolved_by: mongoose.Types.ObjectId // admin who resolved
  },
  
  created_at: Date,
  updated_at: Date
}




/**
 * tournament_id
status
participants.user_id
schedule.scheduled_time
 */