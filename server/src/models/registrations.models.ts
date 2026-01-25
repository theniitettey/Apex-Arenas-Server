import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexRegistration extends Document {
  _id: mongoose.Types.ObjectId;
  tournament_id: mongoose.Types.ObjectId; // reference to tournaments
  user_id: mongoose.Types.ObjectId; // reference to users
  team_id?: mongoose.Types.ObjectId; // reference to teams (optional - only for team tournaments)
  
  registration_type: string; // enum: ['solo', 'team']
  
  // Player's in-game identifier - CRITICAL for winner verification
  in_game_id: string; // must match user's game_profiles entry for tournament's game
  
  // For team registrations - track all members
  team_members?: [
    {
      user_id: mongoose.Types.ObjectId;
      in_game_id: string;
      role: string; // captain, player, substitute
      confirmed: boolean;
      confirmed_at?: Date;
    }
  ];
  
  payment: {
    entry_fee_paid: number; // store as pesewas
    payment_method: string; // enum: ['wallet', 'momo', 'card']
    transaction_id: mongoose.Types.ObjectId; // reference to transactions
    paid_at: Date;
  };
  
  // Refund tracking
  refund?: {
    requested: boolean;
    requested_at?: Date;
    reason?: string;
    status: string; // enum: ['pending', 'approved', 'processed', 'denied']
    amount: number;
    transaction_id?: mongoose.Types.ObjectId;
    processed_at?: Date;
    processed_by?: mongoose.Types.ObjectId;
    denial_reason?: string;
  };
  
  status: string; // enum: ['pending_payment', 'registered', 'checked_in', 'disqualified', 'withdrawn', 'cancelled']
  
  check_in: {
    checked_in: boolean;
    checked_in_at: Date;
    checked_in_by?: mongoose.Types.ObjectId; // self or team captain
  };
  
  seed_number: number; // tournament bracket position
  
  // Placement after tournament
  final_placement?: number; // 1st, 2nd, 3rd, etc.
  prize_won?: number; // amount won (if any)
  
  // Notes
  notes?: string; // admin notes
  disqualification_reason?: string;
  
  created_at: Date; // standardized from registered_at
  updated_at: Date;
  withdrawn_at?: Date;
  withdrawal_reason?: string;
}

/**
 * Indexes:
 * - tournament_id
 * - user_id
 * - team_id
 * - in_game_id
 * - status
 * - Compound: tournament_id + user_id (unique)
 * - Compound: tournament_id + in_game_id (unique per tournament)
 * - Compound: tournament_id + team_id (unique per tournament for team registrations)
 * - payment.transaction_id
 * - refund.status
 */