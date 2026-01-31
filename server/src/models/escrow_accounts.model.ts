import mongoose, { Document, Schema, Model } from "mongoose";

export interface IApexEscrowAccount extends Document {
  _id: mongoose.Types.ObjectId;
  tournament_id: mongoose.Types.ObjectId; // unique reference

  // -------------------------------------------------------------------------
  // ORGANIZER'S PRIZE DEPOSIT (Pool for Winners Only)
  // -------------------------------------------------------------------------
  organizer_deposit: {
    deposited_by: mongoose.Types.ObjectId; // organizer's user_id
    gross_amount: number; // Full deposit (e.g., GHS 5,050)
    platform_fee: number; // GHS 50 (1%)
    net_prize_pool: number; // GHS 5,000 (locked for winners)
    
    deposit_transaction_id: mongoose.Types.ObjectId;
    deposited_at: Date;
    
    // Fee processing
    platform_fee_status: string; // enum: ['pending', 'deducted', 'waived']
    platform_fee_deducted_at: Date;
    
    // Cancellation handling
    cancelled: boolean;
    cancelled_at: Date;
    refund_amount: number; // GHS 5,000 (you keep GHS 50)
    refund_transaction_id: mongoose.Types.ObjectId;
    refunded_at: Date;
  };

  // -------------------------------------------------------------------------
  // PLAYER ENTRY FEES (Pool for Organizer After Tournament)
  // -------------------------------------------------------------------------
  player_entries: {
    total_collected: number; // Sum of all entry fees
    total_players: number; // Count of paid players
    
    payments: [
      {
        user_id: mongoose.Types.ObjectId;
        in_game_id: string; // Player's in-game identifier
        
        // Payment breakdown
        gross_amount: number; // Full entry (e.g., GHS 20)
        platform_fee: number; // GHS 2 (10%)
        organizer_share: number; // GHS 18 (90%)
        
        // Transaction tracking
        payment_transaction_id: mongoose.Types.ObjectId;
        paid_at: Date;
        
        // Fee lifecycle
        platform_fee_status: string; // enum: ['pending', 'deducted', 'waived']
        platform_fee_deducted_at: Date;
        
        // Organizer share lifecycle
        organizer_share_status: string; // enum: ['pending', 'released', 'held']
        
        // Cancellation handling
        cancelled: boolean;
        cancelled_at: Date;
        cancellation_type: string; // enum: ['player_early', 'organizer_cancelled', 'tournament_cancelled']
        refund_amount: number; // GHS 20 (full) if >24hrs
        refund_transaction_id: mongoose.Types.ObjectId;
        refunded_at: Date;
      }
    ];
  };

  // -------------------------------------------------------------------------
  // PLATFORM FEES COLLECTED
  // -------------------------------------------------------------------------
  platform_revenue: {
    total_collected: number;
    from_organizer: number; // 1% of organizer deposit
    from_players: number; // 10% of all player entries
    
    fees_deducted: boolean;
    collected_at: Date; // 1 hour before tournament
    withdrawal_transaction_id: mongoose.Types.ObjectId;
  };

  // -------------------------------------------------------------------------
  // WINNER SUBMISSIONS & PRIZE DISTRIBUTION
  // -------------------------------------------------------------------------
  winner_submissions: {
    submitted_by: mongoose.Types.ObjectId; // Organizer who submitted
    submitted_at: Date;
    
    winners: [
      {
        position: number; // 1, 2, 3, etc.
        in_game_id: string; // Submitted by organizer
        matched_user_id: mongoose.Types.ObjectId; // System matched to registered player
        match_status: string; // enum: ['matched', 'not_found', 'not_registered']
        
        // Prize calculation (from tournament prize_structure)
        prize_percentage: number; // e.g., 50% for 1st place
        prize_amount: number; // Calculated from net_prize_pool
        
        // Payout tracking
        payout_status: string; // enum: ['allocated', 'processing', 'paid', 'failed']
        payout_transaction_id: mongoose.Types.ObjectId;
        paid_at: Date;
        
        // Failure handling
        failure_reason: string;
        retry_count: number;
      }
    ];
    
    all_winners_verified: boolean;
    total_prize_distributed: number; // Should equal net_prize_pool (GHS 5,000)
  };

  // -------------------------------------------------------------------------
  // ORGANIZER PAYOUT (Released After Tournament Completes)
  // -------------------------------------------------------------------------
  organizer_payout: {
    total_earnings: number; // Sum of all organizer_share (GHS 18 × player_count)
    platform_fees_deducted: number; // Already taken from each player
    net_amount: number; // Same as total_earnings
    
    status: string; // enum: ['pending', 'ready', 'processing', 'paid', 'held']
    released_at: Date; // When tournament completes and winners are paid
    
    payout_transaction_id: mongoose.Types.ObjectId;
    paid_at: Date;
    
    // Failure handling
    failure_reason: string;
    retry_count: number;
  };

  // -------------------------------------------------------------------------
  // REFUND TRANSACTION LOG
  // -------------------------------------------------------------------------
  refund_log: [
    {
      user_id: mongoose.Types.ObjectId;
      user_type: string; // enum: ['player', 'organizer']
      reason: string; // enum: ['player_cancelled_early', 'organizer_cancelled_early', 'tournament_cancelled', 'system_refund']
      
      original_amount: number; // What they paid
      refund_amount: number; // What they got back
      platform_fee_kept: number; // What platform retained (GHS 50 for organizer, GHS 0 for player early cancel)
      
      refund_transaction_id: mongoose.Types.ObjectId;
      refunded_at: Date;
    }
  ];

  // -------------------------------------------------------------------------
  // TIME-BASED PROCESSING SCHEDULE
  // -------------------------------------------------------------------------
  processing_schedule: {
    // Critical timestamps
    cancellation_cutoff: Date; // 24 hours before tournament
    fee_deduction_time: Date; // 1 hour before tournament
    tournament_start: Date; // When tournament begins
    tournament_end: Date; // Scheduled end time
    
    // Processing flags
    past_cancellation_cutoff: boolean; // True when <24hrs to start
    fees_deducted: boolean; // Platform fees taken
    tournament_started: boolean; // Tournament in progress
    winners_submitted: boolean; // Organizer submitted results
    prizes_distributed: boolean; // Winners paid
    organizer_paid: boolean; // Organizer received their share
  };

  // -------------------------------------------------------------------------
  // FINANCIAL VERIFICATION & AUDIT
  // -------------------------------------------------------------------------
  accounting: {
    total_inflow: number; // organizer_deposit.gross_amount + sum(player_entries.payments.gross_amount)
    total_outflow: number; // sum(refunds) + sum(prize_distributions) + organizer_payout
    platform_revenue: number; // Total fees collected
    
    balance: number; // Should be 0 when status = 'completed'
    
    verified: boolean;
    verified_at: Date;
    verified_by: mongoose.Types.ObjectId;
    
    discrepancy_notes: string; // For manual review if balance ≠ 0
  };

  // -------------------------------------------------------------------------
  // ESCROW LIFECYCLE STATUS
  // -------------------------------------------------------------------------
  status: string; 
  /* enum: 
    'awaiting_organizer_deposit',  // Initial state
    'open',                         // Accepting player entries, cancellations allowed >24hrs
    'locked',                       // <24hrs before start, no cancellations allowed
    'processing_fees',              // 1 hour before, deducting platform fees
    'tournament_active',            // Tournament in progress
    'awaiting_results',             // Tournament ended, waiting for organizer to submit winners
    'verifying_winners',            // Matching in-game IDs to registered users
    'distributing_prizes',          // Paying winners
    'distributing_organizer',       // Paying organizer
    'completed',                    // All distributions complete, balance = 0
    'cancelled',                    // Tournament cancelled (>24hrs before start)
    'disputed'                      // Manual intervention required
  */

  // -------------------------------------------------------------------------
  // METADATA
  // -------------------------------------------------------------------------
  created_at: Date;
  updated_at: Date;
  closed_at: Date; // When status = 'completed' or 'cancelled'

  // -------------------------------------------------------------------------
  // AUDIT & VERSION CONTROL
  // -------------------------------------------------------------------------
  version: number; // incremented on every update for optimistic locking
  
  audit_log: [
    {
      action: string; // e.g., 'deposit_received', 'player_registered', 'refund_issued', 'prize_distributed'
      performed_by: mongoose.Types.ObjectId; // user who triggered the action
      performed_at: Date;
      details: string; // JSON string of relevant data
      previous_status: string;
      new_status: string;
    }
  ];
}

const EscrowAccountSchema = new Schema<IApexEscrowAccount>({
  tournament_id: { type: Schema.Types.ObjectId, ref: 'ApexTournament', required: true, unique: true },
  
  organizer_deposit: {
    deposited_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
    gross_amount: { type: Number, default: 0 },
    platform_fee: { type: Number, default: 0 },
    net_prize_pool: { type: Number, default: 0 },
    deposit_transaction_id: { type: Schema.Types.ObjectId, ref: 'ApexTransaction' },
    deposited_at: { type: Date },
    platform_fee_status: { type: String, enum: ['pending', 'deducted', 'waived'], default: 'pending' },
    platform_fee_deducted_at: { type: Date },
    cancelled: { type: Boolean, default: false },
    cancelled_at: { type: Date },
    refund_amount: { type: Number, default: 0 },
    refund_transaction_id: { type: Schema.Types.ObjectId, ref: 'ApexTransaction' },
    refunded_at: { type: Date }
  },
  
  player_entries: {
    total_collected: { type: Number, default: 0 },
    total_players: { type: Number, default: 0 },
    payments: [{
      user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
      in_game_id: { type: String, required: true },
      gross_amount: { type: Number, required: true },
      platform_fee: { type: Number, required: true },
      organizer_share: { type: Number, required: true },
      payment_transaction_id: { type: Schema.Types.ObjectId, ref: 'ApexTransaction', required: true },
      paid_at: { type: Date, required: true },
      platform_fee_status: { type: String, enum: ['pending', 'deducted', 'waived'], default: 'pending' },
      platform_fee_deducted_at: { type: Date },
      organizer_share_status: { type: String, enum: ['pending', 'released', 'held'], default: 'pending' },
      cancelled: { type: Boolean, default: false },
      cancelled_at: { type: Date },
      cancellation_type: { type: String, enum: ['player_early', 'organizer_cancelled', 'tournament_cancelled'] },
      refund_amount: { type: Number, default: 0 },
      refund_transaction_id: { type: Schema.Types.ObjectId, ref: 'ApexTransaction' },
      refunded_at: { type: Date }
    }]
  },
  
  platform_revenue: {
    total_collected: { type: Number, default: 0 },
    from_organizer: { type: Number, default: 0 },
    from_players: { type: Number, default: 0 },
    fees_deducted: { type: Boolean, default: false },
    collected_at: { type: Date },
    withdrawal_transaction_id: { type: Schema.Types.ObjectId, ref: 'ApexTransaction' }
  },
  
  winner_submissions: {
    submitted_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
    submitted_at: { type: Date },
    winners: [{
      position: { type: Number, required: true },
      in_game_id: { type: String, required: true },
      matched_user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
      match_status: { type: String, enum: ['matched', 'not_found', 'not_registered'], default: 'not_found' },
      prize_percentage: { type: Number, required: true },
      prize_amount: { type: Number, required: true },
      payout_status: { type: String, enum: ['allocated', 'processing', 'paid', 'failed'], default: 'allocated' },
      payout_transaction_id: { type: Schema.Types.ObjectId, ref: 'Transaction' },
      paid_at: { type: Date },
      failure_reason: { type: String },
      retry_count: { type: Number, default: 0 }
    }],
    all_winners_verified: { type: Boolean, default: false },
    total_prize_distributed: { type: Number, default: 0 }
  },
  
  organizer_payout: {
    total_earnings: { type: Number, default: 0 },
    platform_fees_deducted: { type: Number, default: 0 },
    net_amount: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'ready', 'processing', 'paid', 'held'], default: 'pending' },
    released_at: { type: Date },
    payout_transaction_id: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    paid_at: { type: Date },
    failure_reason: { type: String },
    retry_count: { type: Number, default: 0 }
  },
  
  refund_log: [{
    user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
    user_type: { type: String, enum: ['player', 'organizer'], required: true },
    reason: { type: String, enum: ['player_cancelled_early', 'organizer_cancelled_early', 'tournament_cancelled', 'system_refund'], required: true },
    original_amount: { type: Number, required: true },
    refund_amount: { type: Number, required: true },
    platform_fee_kept: { type: Number, default: 0 },
    refund_transaction_id: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
    refunded_at: { type: Date, required: true }
  }],
  
  processing_schedule: {
    cancellation_cutoff: { type: Date },
    fee_deduction_time: { type: Date },
    tournament_start: { type: Date },
    tournament_end: { type: Date },
    past_cancellation_cutoff: { type: Boolean, default: false },
    fees_deducted: { type: Boolean, default: false },
    tournament_started: { type: Boolean, default: false },
    winners_submitted: { type: Boolean, default: false },
    prizes_distributed: { type: Boolean, default: false },
    organizer_paid: { type: Boolean, default: false }
  },
  
  accounting: {
    total_inflow: { type: Number, default: 0 },
    total_outflow: { type: Number, default: 0 },
    platform_revenue: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
    verified_at: { type: Date },
    verified_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
    discrepancy_notes: { type: String }
  },
  
  status: { 
    type: String, 
    enum: [
      'awaiting_organizer_deposit', 'open', 'locked', 'processing_fees', 
      'tournament_active', 'awaiting_results', 'verifying_winners', 
      'distributing_prizes', 'distributing_organizer', 'completed', 
      'cancelled', 'disputed'
    ],
    default: 'awaiting_organizer_deposit' 
  },
  
  closed_at: { type: Date },
  
  version: { type: Number, default: 1 },
  
  audit_log: [{
    action: { type: String, required: true },
    performed_by: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
    performed_at: { type: Date, default: Date.now },
    details: { type: String },
    previous_status: { type: String },
    new_status: { type: String }
  }]
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
EscrowAccountSchema.index({ tournament_id: 1 }, { unique: true });
EscrowAccountSchema.index({ status: 1 });
EscrowAccountSchema.index({ 'processing_schedule.fee_deduction_time': 1 });
EscrowAccountSchema.index({ 'processing_schedule.cancellation_cutoff': 1 });
EscrowAccountSchema.index({ created_at: -1 });
EscrowAccountSchema.index({ status: 1, 'processing_schedule.fee_deduction_time': 1 });
EscrowAccountSchema.index({ 'player_entries.payments.user_id': 1 });


export const EscrowAccount = mongoose.model<IApexEscrowAccount>('EscrowAccount', EscrowAccountSchema);