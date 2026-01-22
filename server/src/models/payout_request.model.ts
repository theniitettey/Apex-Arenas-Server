import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexPayoutRequest extends Document {
  _id: mongoose.Types.ObjectId,
  user_id: mongoose.Types.ObjectId,
  
  request_type: String, // enum: ['tournament_winnings', 'wallet_withdrawal']
  
  amount: Number, // amount user wants to withdraw
  currency: String, // 'GHS'
  
  // Source of funds
  source: {
    type: String, // 'tournament_winnings'
    tournament_id: mongoose.Types.ObjectId, // if from specific tournament
    position: Number // 1st, 2nd, 3rd place
  },
  
  // Mobile Money payout details
  payout_details: {
    momo_number: String, // recipient mobile money number
    network: String, // enum: ['MTN', 'Vodafone', 'AirtelTigo']
    account_name: String // name on MoMo account
  },
  
  // Approval workflow
  status: String, // enum: ['pending', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'cancelled']
  
  admin_review: {
    reviewed_by: mongoose.Types.ObjectId, // admin user_id
    reviewed_at: Date,
    review_notes: String,
    approved: Boolean,
    rejection_reason: String
  },
  
  // Dispute check
  dispute_check: {
    has_active_disputes: Boolean,
    dispute_ids: [mongoose.Types.ObjectId], // references to match disputes
    checked_at: Date
  },
  
  // Transaction tracking
  transaction_id: mongoose.Types.ObjectId, // reference to transactions (created after approval)
  
  // Processing details
  processing: {
    initiated_at: Date,
    momo_transaction_ref: String, // MoMo API transaction reference
    momo_status: String, // enum: ['pending', 'successful', 'failed']
    failure_reason: String,
    completed_at: Date
  },
  
  // Platform fees (if applicable)
  fees: {
    platform_fee: Number,
    processing_fee: Number,
    total_fees: Number,
    net_amount: Number // amount - total_fees
  },
  
  notes: String, // user notes/reason for withdrawal
  admin_notes: String, // internal admin notes
  
  created_at: Date,
  updated_at: Date,
  approved_at: Date,
  completed_at: Date
}


/**
 * user_id
status
source.tournament_id
created_at
Compound: user_id + status
 */