import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexTransaction extends Document {
  _id: mongoose.Types.ObjectId,
  user_id: mongoose.Types.ObjectId,
  
  type: String, // enum: ['deposit', 'entry_fee', 'prize_won', 'payout_approved', 'payout_completed', 'refund', 'platform_fee']
  
  amount: Number,
  currency: String,
  
  status: String, // enum: ['pending', 'processing', 'completed', 'failed', 'cancelled']
  
  related_to: {
    entity_type: String, // enum: ['tournament', 'match', 'payout_request']
    entity_id: mongoose.Types.ObjectId
  },
  
  payment_details: {
    payment_method: String, // enum: ['wallet', 'card', 'paypal', 'bank_transfer']
    payment_gateway: String, // e.g., 'stripe', 'paypal'
    gateway_transaction_id: String,
    gateway_fee: Number
  },
  
  escrow: {
    is_escrowed: Boolean,
    released_at: Date,
    released_to: mongoose.Types.ObjectId
  },
  
  metadata: {
    description: String,
    notes: String,
    admin_notes: String
  },
  
  created_at: Date,
  updated_at: Date,
  completed_at: Date
}

/**
 * user_id
type
status
created_at
related_to.entity_id
 */