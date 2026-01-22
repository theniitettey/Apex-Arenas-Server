import mongoose, {Document, Schema, Model} from 'mongoose';

export interface IApexTournament extends Document{
  _id: mongoose.Types.ObjectId,
  organizer_id: mongoose.Types.ObjectId, // reference to users
  title: String, // required
  description: String,
  game_id: mongoose.Types.ObjectId, // reference to games collection
  
  tournament_type: String, // enum: ['single_elimination', 'double_elimination', 'round_robin', 'battle_royale']
  format: String, // enum: ['1v1', '2v2', '5v5', 'squad', 'solo']
  
  schedule: {
    registration_start: Date,
    registration_end: Date,
    tournament_start: Date,
    tournament_end: Date,
    check_in_start: Date,
    check_in_end: Date
  },
  
  capacity: {
    min_participants: Number,
    max_participants: Number,
    current_participants: Number
  },
  
  entry_fee: Number, // required
  currency: String, // default: 'USD'
  
  prize_pool: {
    total_amount: Number,
    source: String, // enum: ['entry_fees', 'sponsored', 'mixed']
    distribution: [
      {
        position: Number, // 1st, 2nd, 3rd place
        percentage: Number, // % of total prize pool
        amount: Number // calculated amount
      }
    ]
  },
  
  platform_fee: {
    percentage: Number, // e.g., 10%
    amount: Number // calculated from entry fees
  },
  
  escrow: {
    total_locked: Number,
    organizer_contribution: Number,
    entry_fees_collected: Number,
    status: String // enum: ['pending', 'funded', 'distributed', 'refunded']
  },
  
  rules: {
    description: String,
    map_pool: [String],
    game_mode: String,
    scoring_system: String,
    anti_cheat_required: Boolean
  },
  
  status: String, // enum: ['draft', 'open', 'registration_closed', 'ongoing', 'completed', 'cancelled']
  
  visibility: String, // enum: ['public', 'private', 'invite_only']
  region: String, // e.g., 'NA', 'EU', 'ASIA'
  
  thumbnail_url: String,
  banner_url: String,
  
  metadata: {
    views: Number,
    registrations_count: Number,
    check_ins_count: Number
  },
  
  created_at: Date,
  updated_at: Date,
  published_at: Date,
  cancelled_at: Date,
  cancellation_reason: String
}

/**
  Indexes
  organizer_id
  game_id
  status
  schedule.tournament_start
  schedule.registration_end
  created_at
 */