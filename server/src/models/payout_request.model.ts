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
  
  // Request can expire if not processed in time
  expires_at?: Date;
  is_expired: boolean;
  
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
    retry_count: number;
    last_retry_at?: Date;
  };
  
  // Platform fees (if applicable)
  fees: {
    platform_fee: number;
    processing_fee: number;
    total_fees: number;
    net_amount: number; // amount - total_fees
  };
  
  // Cancellation
  cancellation?: {
    cancelled: boolean;
    cancelled_by?: mongoose.Types.ObjectId; // user or admin
    cancelled_at?: Date;
    reason?: string;
  };
  
  notes?: string; // user notes/reason for withdrawal
  admin_notes?: string; // internal admin notes
  
  version: number; // for optimistic locking / audit trail
  
  created_at: Date;
  updated_at: Date;
  approved_at?: Date;
  completed_at?: Date;
}

const ApexPayoutRequestSchema = new Schema<IApexPayoutRequest>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  
  idempotency_key: { type: String, required: true, unique: true },
  
  request_type: { 
    type: String, 
    enum: ['tournament_winnings', 'wallet_withdrawal'],
    required: true 
  },
  
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'GHS' },
  
  source: {
    type: { type: String, enum: ['tournament_winnings', 'wallet_balance', 'refund'] },
    tournament_id: { type: Schema.Types.ObjectId, ref: 'Tournament' },
    position: { type: Number, min: 1 }
  },
  
  payout_details: {
    momo_number: { type: String, required: true },
    network: { type: String, enum: ['MTN', 'Vodafone', 'AirtelTigo'], required: true },
    account_name: { type: String, required: true }
  },
  
  status: { 
    type: String, 
    enum: ['pending', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'cancelled'],
    default: 'pending' 
  },
  
  expires_at: { type: Date },
  is_expired: { type: Boolean, default: false },
  
  admin_review: {
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewed_at: { type: Date },
    review_notes: { type: String },
    approved: { type: Boolean },
    rejection_reason: { type: String }
  },
  
  dispute_check: {
    has_active_disputes: { type: Boolean, default: false },
    dispute_ids: [{ type: Schema.Types.ObjectId, ref: 'Match' }],
    checked_at: { type: Date }
  },
  
  transaction_id: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  
  processing: {
    initiated_at: { type: Date },
    momo_transaction_ref: { type: String },
    momo_status: { type: String, enum: ['pending', 'successful', 'failed'] },
    failure_reason: { type: String },
    completed_at: { type: Date },
    retry_count: { type: Number, default: 0 },
    last_retry_at: { type: Date }
  },
  
  fees: {
    platform_fee: { type: Number, default: 0 },
    processing_fee: { type: Number, default: 0 },
    total_fees: { type: Number, default: 0 },
    net_amount: { type: Number, default: 0 }
  },
  
  cancellation: {
    cancelled: { type: Boolean, default: false },
    cancelled_by: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelled_at: { type: Date },
    reason: { type: String }
  },
  
  notes: { type: String, maxlength: 500 },
  admin_notes: { type: String, maxlength: 1000 },
  
  version: { type: Number, default: 1 },
  
  approved_at: { type: Date },
  completed_at: { type: Date }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexPayoutRequestSchema.index({ idempotency_key: 1 }, { unique: true });
ApexPayoutRequestSchema.index({ user_id: 1 });
ApexPayoutRequestSchema.index({ status: 1 });
ApexPayoutRequestSchema.index({ 'source.tournament_id': 1 }, { sparse: true });
ApexPayoutRequestSchema.index({ created_at: -1 });
ApexPayoutRequestSchema.index({ user_id: 1, status: 1 });
ApexPayoutRequestSchema.index({ status: 1, created_at: -1 });
ApexPayoutRequestSchema.index({ 'admin_review.reviewed_by': 1 }, { sparse: true });

export const PayoutRequest = mongoose.model<IApexPayoutRequest>('ApexPayoutRequest', ApexPayoutRequestSchema);