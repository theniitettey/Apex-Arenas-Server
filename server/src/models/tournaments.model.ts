import mongoose, { Document, Schema } from 'mongoose';

export interface IApexTournament extends Document {
  _id: mongoose.Types.ObjectId;
  organizer_id: mongoose.Types.ObjectId;
  escrow_account_id?: mongoose.Types.ObjectId; // optional - null for free tournaments
  

  title: string;
  description: string;
  game_id: mongoose.Types.ObjectId;
  
  tournament_type: string;
  format: string;
  
  // Free vs Paid tournament
  is_free: boolean; // true = no entry fee, no prize pool
  

  schedule: {
    registration_start: Date;
    registration_end: Date;
    tournament_start: Date;
    tournament_end: Date;
    check_in_start: Date;
    check_in_end: Date;
    cancellation_cutoff: Date;
    fee_deduction_time: Date;
  };
  
  timezone: string;
  
 
  communication: {
    discord_link?: string;
    whatsapp_link?: string;
    contact_email?: string;
    contact_phone?: string;
    stream_url?: string; // if tournament is streamed
  };

  capacity: {
    min_participants: number;
    max_participants: number;
    current_participants: number;
    checked_in_count: number;
    waitlist_count: number; // players on waitlist
    waitlist_enabled: boolean;
  };
  
  entry_fee: number;
  currency: string;

  prize_structure: {
    organizer_gross_deposit: number; // What organizer pays upfront (e.g., GHS 5,050)
    platform_fee_percentage: number; // 1% from organizer
    platform_fee_amount: number; // GHS 50
    net_prize_pool: number; // GHS 5,000 (what winners share)
    
    total_winning_positions: number; // e.g., 3 (1st, 2nd, 3rd)
    distribution: [
      {
        position: number; // 1, 2, 3, etc.
        percentage: number; // % of net_prize_pool (must total 100%)
        amount: number; // Auto-calculated (e.g., 50% of GHS 5,000 = GHS 2,500)
      }
    ];
  };
  

  player_platform_fee: {
    percentage: number; // 10%
    per_player_amount: number; // GHS 2 (10% of GHS 20)
    total_expected: number; // per_player_amount × current_participants
  };
  
 
  organizer_revenue: {
    per_player_share: number; // GHS 18 (90% of GHS 20 entry fee)
    total_expected: number; // per_player_share × current_participants
    release_timing: string; // 'after_tournament_completion' (fixed)
  };
  

  bracket: {
    generated: boolean;
    generated_at?: Date;
    total_rounds: number;
    current_round: number;
    bracket_url?: string; // link to visual bracket if external
  };
  

  rules: {
    description: string;
    map_pool: string[];
    game_mode: string;
    scoring_system: string;
    anti_cheat_required: boolean;
    stream_required: boolean;
    in_game_id_required: boolean; // Players must provide their in-game ID
  };
  
  status: string; 
  /* enum:
    'draft',                    // Organizer creating, not published
    'awaiting_deposit',         // Published but organizer hasn't deposited prize pool
    'open',                     // Accepting registrations, >24hrs before start
    'locked',                   // <24hrs before start, no cancellations
    'ready_to_start',           // Fees deducted, waiting for tournament_start time
    'ongoing',                  // Tournament in progress
    'awaiting_results',         // Tournament ended, waiting for organizer to submit winners
    'verifying_results',        // System matching winners
    'completed',                // All payouts distributed
    'cancelled'                 // Cancelled by organizer (>24hrs before start only)
  */
  
 
  results: {
    submitted_by: mongoose.Types.ObjectId; // Organizer who submitted
    submitted_at: Date;
    
    winners: [
      {
        position: number; // 1, 2, 3, etc.
        in_game_id: string; // Organizer provides this
        user_id: mongoose.Types.ObjectId; // System matches to registered player
        verified: boolean; // True if in_game_id matches a registered player
      }
    ];
    
    verification_status: string; // enum: ['pending', 'verified', 'disputed']
    verified_at: Date;
  };
  

  visibility: string; // enum: ['public', 'private', 'invite_only']
  region: string; // e.g., 'GH', 'NA', 'EU', 'ASIA'
  
 
  thumbnail_url: string;
  banner_url: string;
  
 
  metadata: {
    views: number;
    registrations_count: number; // Total who registered
    paid_registrations_count: number; // Total who paid
    check_ins_count: number;
    completion_rate: number; // % of registered players who showed up
  };
  
 
  cancellation: {
    cancelled: boolean;
    cancelled_by: mongoose.Types.ObjectId; // Who cancelled (organizer or admin)
    cancelled_at: Date;
    reason: string;
    refunds_processed: boolean;
    refund_summary: {
      players_refunded: number;
      total_refunded_to_players: number;
      organizer_refunded: number;
      platform_fees_retained: number;
    };
  };
  
  requirements: {
    min_age?: number;
    max_age?: number;
    allowed_regions: string[]; // empty = all regions allowed
    required_skill_levels: string[]; // empty = all skill levels
    team_size?: number; // for team formats
    min_team_size?: number;
    max_team_size?: number;
  };
  
  created_at: Date;
  updated_at: Date;
  published_at: Date;
  started_at: Date;
  completed_at: Date;
}

const ApexTournamentSchema = new Schema<IApexTournament>({
  organizer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  escrow_account_id: { type: Schema.Types.ObjectId, ref: 'EscrowAccount' },
  
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, maxlength: 2000 },
  game_id: { type: Schema.Types.ObjectId, ref: 'Game', required: true },
  
  tournament_type: { 
    type: String, 
    enum: ['single_elimination', 'double_elimination', 'round_robin', 'swiss', 'battle_royale'],
    required: true 
  },
  format: { 
    type: String, 
    enum: ['1v1', '2v2', '3v3', '4v4', '5v5', 'squad', 'solo'],
    required: true 
  },
  
  is_free: { type: Boolean, default: false },
  
  schedule: {
    registration_start: { type: Date, required: true },
    registration_end: { type: Date, required: true },
    tournament_start: { type: Date, required: true },
    tournament_end: { type: Date },
    check_in_start: { type: Date },
    check_in_end: { type: Date },
    cancellation_cutoff: { type: Date },
    fee_deduction_time: { type: Date }
  },
  
  timezone: { type: String, default: 'Africa/Accra' },
  
  communication: {
    discord_link: { type: String },
    whatsapp_link: { type: String },
    contact_email: { type: String },
    contact_phone: { type: String },
    stream_url: { type: String }
  },
  
  capacity: {
    min_participants: { type: Number, default: 2 },
    max_participants: { type: Number, required: true },
    current_participants: { type: Number, default: 0 },
    checked_in_count: { type: Number, default: 0 },
    waitlist_count: { type: Number, default: 0 },
    waitlist_enabled: { type: Boolean, default: false }
  },
  
  entry_fee: { type: Number, default: 0 },
  currency: { type: String, default: 'GHS' },
  
  prize_structure: {
    organizer_gross_deposit: { type: Number, default: 0 },
    platform_fee_percentage: { type: Number, default: 1 },
    platform_fee_amount: { type: Number, default: 0 },
    net_prize_pool: { type: Number, default: 0 },
    total_winning_positions: { type: Number, default: 1 },
    distribution: [{
      position: { type: Number, required: true },
      percentage: { type: Number, required: true },
      amount: { type: Number, default: 0 }
    }]
  },
  
  player_platform_fee: {
    percentage: { type: Number, default: 10 },
    per_player_amount: { type: Number, default: 0 },
    total_expected: { type: Number, default: 0 }
  },
  
  organizer_revenue: {
    per_player_share: { type: Number, default: 0 },
    total_expected: { type: Number, default: 0 },
    release_timing: { type: String, default: 'after_tournament_completion' }
  },
  
  bracket: {
    generated: { type: Boolean, default: false },
    generated_at: { type: Date },
    total_rounds: { type: Number, default: 0 },
    current_round: { type: Number, default: 0 },
    bracket_url: { type: String }
  },
  
  rules: {
    description: { type: String, maxlength: 5000 },
    map_pool: [{ type: String }],
    game_mode: { type: String },
    scoring_system: { type: String },
    anti_cheat_required: { type: Boolean, default: false },
    stream_required: { type: Boolean, default: false },
    in_game_id_required: { type: Boolean, default: true }
  },
  
  status: { 
    type: String, 
    enum: ['draft', 'awaiting_deposit', 'open', 'locked', 'ready_to_start', 'ongoing', 'awaiting_results', 'verifying_results', 'completed', 'cancelled'],
    default: 'draft' 
  },
  
  results: {
    submitted_by: { type: Schema.Types.ObjectId, ref: 'User' },
    submitted_at: { type: Date },
    winners: [{
      position: { type: Number },
      in_game_id: { type: String },
      user_id: { type: Schema.Types.ObjectId, ref: 'User' },
      verified: { type: Boolean, default: false }
    }],
    verification_status: { type: String, enum: ['pending', 'verified', 'disputed'], default: 'pending' },
    verified_at: { type: Date }
  },
  
  visibility: { type: String, enum: ['public', 'private', 'invite_only'], default: 'public' },
  region: { type: String, default: 'GH' },
  
  thumbnail_url: { type: String },
  banner_url: { type: String },
  
  metadata: {
    views: { type: Number, default: 0 },
    registrations_count: { type: Number, default: 0 },
    paid_registrations_count: { type: Number, default: 0 },
    check_ins_count: { type: Number, default: 0 },
    completion_rate: { type: Number, default: 0 }
  },
  
  cancellation: {
    cancelled: { type: Boolean, default: false },
    cancelled_by: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelled_at: { type: Date },
    reason: { type: String },
    refunds_processed: { type: Boolean, default: false },
    refund_summary: {
      players_refunded: { type: Number, default: 0 },
      total_refunded_to_players: { type: Number, default: 0 },
      organizer_refunded: { type: Number, default: 0 },
      platform_fees_retained: { type: Number, default: 0 }
    }
  },
  
  requirements: {
    min_age: { type: Number },
    max_age: { type: Number },
    allowed_regions: [{ type: String }],
    required_skill_levels: [{ type: String }],
    team_size: { type: Number },
    min_team_size: { type: Number },
    max_team_size: { type: Number }
  },
  
  published_at: { type: Date },
  started_at: { type: Date },
  completed_at: { type: Date }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexTournamentSchema.index({ organizer_id: 1 });
ApexTournamentSchema.index({ game_id: 1 });
ApexTournamentSchema.index({ escrow_account_id: 1 }, { sparse: true });
ApexTournamentSchema.index({ status: 1 });
ApexTournamentSchema.index({ 'schedule.tournament_start': 1 });
ApexTournamentSchema.index({ 'schedule.registration_end': 1 });
ApexTournamentSchema.index({ 'schedule.cancellation_cutoff': 1 });
ApexTournamentSchema.index({ created_at: -1 });
ApexTournamentSchema.index({ region: 1 });
ApexTournamentSchema.index({ visibility: 1 });
ApexTournamentSchema.index({ is_free: 1 });
ApexTournamentSchema.index({ status: 1, 'schedule.tournament_start': 1 });
ApexTournamentSchema.index({ game_id: 1, status: 1, visibility: 1 });


export const Tournament = mongoose.model<IApexTournament>('ApexTournament', ApexTournamentSchema);