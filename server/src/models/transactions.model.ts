import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexTransaction extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  
  idempotency_key: string; // unique key to prevent duplicate transactions
  
  type: string; // enum: ['deposit', 'entry_fee', 'prize_won', 'payout_approved', 'payout_completed', 'refund', 'platform_fee']
  
  amount: number; // store as pesewas (integers) to avoid floating-point issues
  currency: string;
  
  status: string; // enum: ['pending', 'processing', 'completed', 'failed', 'cancelled']
  
  related_to: {
    entity_type: string; // enum: ['tournament', 'match', 'payout_request', 'escrow']
    entity_id: mongoose.Types.ObjectId;
  };
  
  payment_details: {
    payment_method: string; // enum: ['wallet', 'momo', 'card', 'paypal', 'bank_transfer']
    payment_gateway: string; // e.g., 'paystack', 'flutterwave', 'stripe'
    gateway_transaction_id: string;
    gateway_fee: number;
    momo_network?: string; // enum: ['MTN', 'Vodafone', 'AirtelTigo']
    momo_number?: string;
  };
  
  escrow: {
    is_escrowed: boolean;
    released_at: Date;
    released_to: mongoose.Types.ObjectId;
  };
  
  metadata: {
    description: string;
    notes: string;
    admin_notes: string;
  };
  
  version: number; // for optimistic locking / audit trail
  
  created_at: Date;
  updated_at: Date;
  completed_at: Date;
}

/**
 * Indexes:
 * - idempotency_key (unique)
 * - user_id
 * - type
 * - status
 * - created_at
 * - related_to.entity_id
 * - Compound: user_id + type + status
 */