import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexPayoutRequest extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  
  idempotency_key: string; // unique key to prevent duplicate payout requests
  
  request_type: string; // enum: ['tournament_winnings', 'wallet_withdrawal']
  
  amount: number; // store as pesewas
  currency: string; // 'GHS'
  
  // Source of funds
  source: {
    type: string; // 'tournament_winnings'
    tournament_id?: mongoose.Types.ObjectId; // if from specific tournament
    position?: number; // 1st, 2nd, 3rd place
  };
  
  // Mobile Money payout details
  payout_details: {
    momo_number: string; // recipient mobile money number
    network: string; // enum: ['MTN', 'Vodafone', 'AirtelTigo']
    account_name: string; // name on MoMo account
  };
  
  // Approval workflow
  status: string; // enum: ['pending', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'cancelled']
  
  admin_review: {
    reviewed_by?: mongoose.Types.ObjectId; // admin user_id
    reviewed_at?: Date;
    review_notes?: string;
    approved?: boolean;
    rejection_reason?: string;
  };
  
  // Dispute check
  dispute_check: {
    has_active_disputes: boolean;
    dispute_ids: mongoose.Types.ObjectId[]; // references to match disputes
    checked_at?: Date;
  };
  
  // Transaction tracking
  transaction_id?: mongoose.Types.ObjectId; // reference to transactions (created after approval)
  
  // Processing details
  processing: {
    initiated_at?: Date;
    momo_transaction_ref?: string; // MoMo API transaction reference
    momo_status?: string; // enum: ['pending', 'successful', 'failed']
    failure_reason?: string;
    completed_at?: Date;
  };
  
  // Platform fees (if applicable)
  fees: {
    platform_fee: number;
    processing_fee: number;
    total_fees: number;
    net_amount: number; // amount - total_fees
  };
  
  notes?: string; // user notes/reason for withdrawal
  admin_notes?: string; // internal admin notes
  
  version: number; // for optimistic locking / audit trail
  
  created_at: Date;
  updated_at: Date;
  approved_at?: Date;
  completed_at?: Date;
}

/**
 * Indexes:
 * - idempotency_key (unique)
 * - user_id
 * - status
 * - source.tournament_id
 * - created_at
 * - Compound: user_id + status
 */