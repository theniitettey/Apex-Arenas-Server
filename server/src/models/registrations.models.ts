import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexRegistration extends Document {
  _id: mongoose.Types.ObjectId;
  tournament_id: mongoose.Types.ObjectId; // reference to tournaments
  user_id: mongoose.Types.ObjectId; // reference to users
  team_id?: mongoose.Types.ObjectId; // reference to teams (optional - only for team tournaments)
  
  registration_type: string; // enum: ['solo', 'team']
  
  // Player's in-game identifier - CRITICAL for winner verification
  in_game_id: string; // must match user's game_profiles entry for tournament's game
  
  payment: {
    entry_fee_paid: number; // store as pesewas
    payment_method: string; // enum: ['wallet', 'momo', 'card']
    transaction_id: mongoose.Types.ObjectId; // reference to transactions
    paid_at: Date;
  };
  
  status: string; // enum: ['pending_payment', 'registered', 'checked_in', 'disqualified', 'withdrawn', 'cancelled']
  
  check_in: {
    checked_in: boolean;
    checked_in_at: Date;
  };
  
  seed_number: number; // tournament bracket position
  
  created_at: Date; // standardized from registered_at
  updated_at: Date;
  withdrawn_at: Date;
  withdrawal_reason: string;
}

/**
 * Indexes:
 * - tournament_id
 * - user_id
 * - in_game_id
 * - status
 * - Compound: tournament_id + user_id (unique)
 * - Compound: tournament_id + in_game_id (unique per tournament)
 * - payment.transaction_id
 */