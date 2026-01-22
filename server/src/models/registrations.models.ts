import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexRegistration extends Document {
  _id: mongoose.Types.ObjectId,
  tournament_id: mongoose.Types.ObjectId, // reference to tournaments
  user_id: mongoose.Types.ObjectId, // reference to users
  team_id: mongoose.Types.ObjectId, // reference to teams (if team tournament, otherwise null)
  
  registration_type: String, // enum: ['solo', 'team']
  
  payment: {
    entry_fee_paid: Number,
    payment_method: String, // enum: ['wallet', 'card', 'paypal']
    transaction_id: mongoose.Types.ObjectId, // reference to transactions
    paid_at: Date
  },
  
  status: String, // enum: ['pending_payment', 'registered', 'checked_in', 'disqualified', 'withdrawn', 'cancelled']
  
  check_in: {
    checked_in: Boolean,
    checked_in_at: Date
  },
  
  seed_number: Number, // tournament bracket position
  
  registered_at: Date,
  updated_at: Date,
  withdrawn_at: Date,
  withdrawal_reason: String
}


/**
 * tournament_id
user_id
status
Compound: tournament_id + user_id (unique)
 */