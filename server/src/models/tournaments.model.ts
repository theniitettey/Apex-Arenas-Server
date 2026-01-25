// ============================================================================
// TOURNAMENTS.MODEL.TS - UPDATED VERSION
// ============================================================================
import mongoose, { Document, Schema } from 'mongoose';

export interface IApexTournament extends Document {
  _id: mongoose.Types.ObjectId;
  organizer_id: mongoose.Types.ObjectId;
  escrow_account_id?: mongoose.Types.ObjectId; // optional - null for free tournaments
  
  // -------------------------------------------------------------------------
  // BASIC INFORMATION
  // -------------------------------------------------------------------------
  title: string;
  description: string;
  game_id: mongoose.Types.ObjectId;
  
  tournament_type: string;
  format: string;
  
  // Free vs Paid tournament
  is_free: boolean; // true = no entry fee, no prize pool
  
  // -------------------------------------------------------------------------
  // SCHEDULE
  // -------------------------------------------------------------------------
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
  
  // -------------------------------------------------------------------------
  // COMMUNICATION
  // -------------------------------------------------------------------------
  communication: {
    discord_link?: string;
    whatsapp_link?: string;
    contact_email?: string;
    contact_phone?: string;
    stream_url?: string; // if tournament is streamed
  };
  
  // -------------------------------------------------------------------------
  // CAPACITY
  // -------------------------------------------------------------------------
  capacity: {
    min_participants: number;
    max_participants: number;
    current_participants: number;
    checked_in_count: number;
    waitlist_count: number; // players on waitlist
    waitlist_enabled: boolean;
  };
  
  // -------------------------------------------------------------------------
  // ENTRY FEE & CURRENCY (null/0 for free tournaments)
  // -------------------------------------------------------------------------
  entry_fee: number;
  currency: string;
  
  // -------------------------------------------------------------------------
  // PRIZE STRUCTURE (Organizer Defines This at Creation)
  // -------------------------------------------------------------------------
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
  
  // -------------------------------------------------------------------------
  // PLATFORM FEE FROM PLAYERS
  // -------------------------------------------------------------------------
  player_platform_fee: {
    percentage: number; // 10%
    per_player_amount: number; // GHS 2 (10% of GHS 20)
    total_expected: number; // per_player_amount × current_participants
  };
  
  // -------------------------------------------------------------------------
  // ORGANIZER EARNINGS (From Player Entry Fees)
  // -------------------------------------------------------------------------
  organizer_revenue: {
    per_player_share: number; // GHS 18 (90% of GHS 20 entry fee)
    total_expected: number; // per_player_share × current_participants
    release_timing: string; // 'after_tournament_completion' (fixed)
  };
  
  // -------------------------------------------------------------------------
  // BRACKET INFORMATION
  // -------------------------------------------------------------------------
  bracket: {
    generated: boolean;
    generated_at?: Date;
    total_rounds: number;
    current_round: number;
    bracket_url?: string; // link to visual bracket if external
  };
  
  // -------------------------------------------------------------------------
  // RULES & SETTINGS
  // -------------------------------------------------------------------------
  rules: {
    description: string;
    map_pool: string[];
    game_mode: string;
    scoring_system: string;
    anti_cheat_required: boolean;
    stream_required: boolean;
    in_game_id_required: boolean; // Players must provide their in-game ID
  };
  
  // -------------------------------------------------------------------------
  // TOURNAMENT STATUS
  // -------------------------------------------------------------------------
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
  
  // -------------------------------------------------------------------------
  // RESULTS & WINNERS (Submitted by Organizer)
  // -------------------------------------------------------------------------
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
  
  // -------------------------------------------------------------------------
  // VISIBILITY & REGION
  // -------------------------------------------------------------------------
  visibility: string; // enum: ['public', 'private', 'invite_only']
  region: string; // e.g., 'GH', 'NA', 'EU', 'ASIA'
  
  // -------------------------------------------------------------------------
  // MEDIA
  // -------------------------------------------------------------------------
  thumbnail_url: string;
  banner_url: string;
  
  // -------------------------------------------------------------------------
  // ANALYTICS & METADATA
  // -------------------------------------------------------------------------
  metadata: {
    views: number;
    registrations_count: number; // Total who registered
    paid_registrations_count: number; // Total who paid
    check_ins_count: number;
    completion_rate: number; // % of registered players who showed up
  };
  
  // -------------------------------------------------------------------------
  // CANCELLATION TRACKING
  // -------------------------------------------------------------------------
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
  
  // -------------------------------------------------------------------------
  // REQUIREMENTS
  // -------------------------------------------------------------------------
  requirements: {
    min_age?: number;
    max_age?: number;
    allowed_regions: string[]; // empty = all regions allowed
    required_skill_levels: string[]; // empty = all skill levels
    team_size?: number; // for team formats
    min_team_size?: number;
    max_team_size?: number;
  };
  
  // -------------------------------------------------------------------------
  // TIMESTAMPS
  // -------------------------------------------------------------------------
  created_at: Date;
  updated_at: Date;
  published_at: Date;
  started_at: Date;
  completed_at: Date;
}

/**
 * Indexes:
 * - organizer_id
 * - game_id
 * - escrow_account_id (unique)
 * - status
 * - schedule.tournament_start
 * - schedule.registration_end
 * - schedule.cancellation_cutoff
 * - created_at
 * - region
 * - visibility
 */