import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexEscrowAccount extends Document {
  _id: mongoose.Types.ObjectId,
  tournament_id: mongoose.Types.ObjectId, // unique
  
  total_pool: Number,
  
  sources: {
    organizer_deposit: Number,
    entry_fees: Number,
    sponsorships: Number
  },
  
  allocations: {
    prize_pool: Number,
    platform_fee: Number,
    refund_reserve: Number
  },
  
  disbursements: [
    {
      user_id: mongoose.Types.ObjectId,
      position: Number,
      amount: Number,
      status: String, // enum: ['locked', 'pending_approval', 'approved', 'paid_out']
      moved_to_pending_at: Date, // when moved to user's pending_balance
      payout_request_id: mongoose.Types.ObjectId, // when user requests payout
      approved_at: Date,
      paid_out_at: Date
    }
  ],
  
  status: String, // enum: ['open', 'locked', 'distributing', 'distributed', 'refunding', 'closed']
  
  created_at: Date,
  updated_at: Date,
  locked_at: Date,
  distributed_at: Date
} 

/**
 * tournament_id (unique)
status
 */

