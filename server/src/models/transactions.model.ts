import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexTransaction extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  
  idempotency_key: string; // unique key to prevent duplicate transactions
  
  type: string; // enum: ['deposit', 'entry_fee', 'prize_won', 'payout_approved', 'payout_completed', 'refund', 'platform_fee']
  direction: string; // enum: ['credit', 'debit'] - money in or out
  
  amount: number; // store as pesewas (integers) to avoid floating-point issues
  currency: string;
  
  // Balance snapshot for audit trail
  balance_before: number;
  balance_after: number;
  
  status: string; // enum: ['pending', 'processing', 'completed', 'failed', 'cancelled']
  
  related_to: {
    entity_type: string; // enum: ['tournament', 'match', 'payout_request', 'escrow']
    entity_id: mongoose.Types.ObjectId;
  };
  
  payment_details: {
    payment_method: string; // enum: ['wallet', 'momo', 'card', 'paypal', 'bank_transfer']
    payment_gateway: string; // e.g., 'paystack', 'flutterwave', 'stripe'
    gateway_transaction_id: string;
    gateway_response?: string; // raw response from gateway for debugging
    gateway_fee: number;
    momo_network?: string; // enum: ['MTN', 'Vodafone', 'AirtelTigo']
    momo_number?: string;
  };
  
  escrow: {
    is_escrowed: boolean;
    released_at: Date;
    released_to: mongoose.Types.ObjectId;
  };
  
  // Retry handling for failed transactions
  retry: {
    attempts: number;
    max_attempts: number; // default: 3
    last_attempt_at?: Date;
    next_retry_at?: Date;
    retry_reason?: string;
  };
  
  metadata: {
    description: string;
    notes: string;
    admin_notes: string;
    ip_address?: string; // for fraud detection
    user_agent?: string;
  };
  
  version: number; // for optimistic locking / audit trail
  
  created_at: Date;
  updated_at: Date;
  completed_at: Date;
  failed_at?: Date;
  failure_reason?: string;
}


const ApexTransactionSchema = new Schema<IApexTransaction>({
  user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
  
  idempotency_key: { type: String, required: true, unique: true },
  
  type: { 
    type: String, 
    enum: ['deposit', 'entry_fee', 'prize_won', 'payout_approved', 'payout_completed', 'refund', 'platform_fee'],
    required: true 
  },
  direction: { type: String, enum: ['credit', 'debit'], required: true },
  
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GHS' },
  
  balance_before: { type: Number, required: true },
  balance_after: { type: Number, required: true },
  
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending' 
  },
  
  related_to: {
    entity_type: { type: String, enum: ['tournament', 'match', 'payout_request', 'escrow'] },
    entity_id: { type: Schema.Types.ObjectId, refPath: 'related_to.entity_type' }
  },
  
  payment_details: {
    payment_method: { type: String, enum: ['wallet', 'momo', 'card', 'paypal', 'bank_transfer'] },
    payment_gateway: { type: String },
    gateway_transaction_id: { type: String },
    gateway_response: { type: String },
    gateway_fee: { type: Number, default: 0 },
    momo_network: { type: String, enum: ['MTN', 'Vodafone', 'AirtelTigo'] },
    momo_number: { type: String }
  },
  
  escrow: {
    is_escrowed: { type: Boolean, default: false },
    released_at: { type: Date },
    released_to: { type: Schema.Types.ObjectId, ref: 'ApexUser' }
  },
  
  retry: {
    attempts: { type: Number, default: 0 },
    max_attempts: { type: Number, default: 3 },
    last_attempt_at: { type: Date },
    next_retry_at: { type: Date },
    retry_reason: { type: String }
  },
  
  metadata: {
    description: { type: String },
    notes: { type: String },
    admin_notes: { type: String },
    ip_address: { type: String },
    user_agent: { type: String }
  },
  
  version: { type: Number, default: 1 },
  
  completed_at: { type: Date },
  failed_at: { type: Date },
  failure_reason: { type: String }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexTransactionSchema.index({ user_id: 1 });
ApexTransactionSchema.index({ type: 1 });
ApexTransactionSchema.index({ direction: 1 });
ApexTransactionSchema.index({ status: 1 });
ApexTransactionSchema.index({ created_at: -1 });
ApexTransactionSchema.index({ 'related_to.entity_id': 1 });
ApexTransactionSchema.index({ user_id: 1, type: 1, status: 1 });
ApexTransactionSchema.index({ user_id: 1, created_at: -1 });

export const Transaction = mongoose.model<IApexTransaction>('ApexTransaction', ApexTransactionSchema);