import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexRegistration extends Document {
  _id: mongoose.Types.ObjectId;
  tournament_id: mongoose.Types.ObjectId; // reference to tournaments
  user_id: mongoose.Types.ObjectId; // reference to users
  team_id?: mongoose.Types.ObjectId; // reference to teams (optional - only for team tournaments)
  
  registration_type: string; // enum: ['solo', 'team']
  
  // Player's in-game identifier - CRITICAL for winner verification
  in_game_id: string; // must match user's game_profiles entry for tournament's game
  waitlist_position?: number;
  promoted_from_waitlist?: boolean;
  promoted_at?: Date

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


const ApexRegistrationSchema = new Schema<IApexRegistration>({
  tournament_id: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
  team_id: { type: Schema.Types.ObjectId, ref: 'Team' },
  
  registration_type: { type: String, enum: ['solo', 'team'], required: true },
  
  in_game_id: { type: String, required: true },
  waitlist_position: {type: Number},
  promoted_from_waitlist: {Type:Boolean},
  promoted_at: {Type: Date},

  team_members: [{
    user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
    in_game_id: { type: String, required: true },
    role: { type: String, enum: ['captain', 'player', 'substitute'], default: 'player' },
    confirmed: { type: Boolean, default: false },
    confirmed_at: { type: Date }
  }],
  
  payment: {
    entry_fee_paid: { type: Number, default: 0 },
    payment_method: { type: String, enum: ['wallet', 'momo', 'card', 'free'] },
    transaction_id: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    paid_at: { type: Date }
  },
  
  refund: {
    requested: { type: Boolean, default: false },
    requested_at: { type: Date },
    reason: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'processed', 'denied'] },
    amount: { type: Number, default: 0 },
    transaction_id: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    processed_at: { type: Date },
    processed_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' },
    denial_reason: { type: String }
  },
  
  status: { 
    type: String, 
    enum: ['pending_payment', 'registered', 'checked_in', 'disqualified', 'withdrawn', 'cancelled'],
    default: 'pending_payment' 
  },
  
  check_in: {
    checked_in: { type: Boolean, default: false },
    checked_in_at: { type: Date },
    checked_in_by: { type: Schema.Types.ObjectId, ref: 'ApexUser' }
  },
  
  seed_number: { type: Number },
  
  final_placement: { type: Number },
  prize_won: { type: Number, default: 0 },
  
  notes: { type: String },
  disqualification_reason: { type: String },
  
  withdrawn_at: { type: Date },
  withdrawal_reason: { type: String }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexRegistrationSchema.index({ tournament_id: 1 });
ApexRegistrationSchema.index({ user_id: 1 });
ApexRegistrationSchema.index({ team_id: 1 }, { sparse: true });
ApexRegistrationSchema.index({ in_game_id: 1 });
ApexRegistrationSchema.index({ status: 1 });
ApexRegistrationSchema.index({ tournament_id: 1, user_id: 1 }, { unique: true });
ApexRegistrationSchema.index({ tournament_id: 1, in_game_id: 1 }, { unique: true });
ApexRegistrationSchema.index({ tournament_id: 1, team_id: 1 }, { unique: true, sparse: true });
ApexRegistrationSchema.index({ 'payment.transaction_id': 1 }, { sparse: true });
ApexRegistrationSchema.index({ 'refund.status': 1 }, { sparse: true });



export const Registration = mongoose.model<IApexRegistration>('ApexRegistration', ApexRegistrationSchema);