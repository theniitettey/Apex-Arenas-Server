import mongoose, {Document, Schema, Model} from 'mongoose';

export interface IApexUser extends Document {
  _id: mongoose.Types.ObjectId,
  email: String, // unique, required
  username: String, // unique, required
  password_hash: String, // hashed password
  role: String, // enum: ['player', 'organizer', 'admin']
  profile: {
    first_name: String,
    last_name: String,
    avatar_url: String,
    country: String,
    date_of_birth: Date,
    phone: String
  },
  game_profiles: [
    {
      game_id: mongoose.Types.ObjectId, // reference to games collection
      game_username: String,
      game_id_number: String,
      skill_level: String, // enum: ['beginner', 'intermediate', 'advanced', 'pro']
      rank: String
    }
  ],
  wallet: {
    available_balance: Number, // funds available for withdrawal (decimal128 recommended)
    pending_balance: Number, // winnings pending admin approval
    total_balance: Number, // available + pending
    currency: String, // default: 'GHS' (Ghana Cedis)
    escrow_locked: Number // funds locked in active tournaments (entry fees)
  },
  momo_account: {
    phone_number: String, // Mobile Money number for payouts
    network: String, // enum: ['MTN', 'Vodafone', 'AirtelTigo']
    account_name: String, // Name registered on MoMo
    is_verified: Boolean,
    verified_at: Date
  },
  stats: {
    tournaments_played: Number,
    tournaments_won: Number,
    total_earnings: Number,
    win_rate: Number
  },
  verification_status: {
    email_verified: Boolean,
    phone_verified: Boolean,
    identity_verified: Boolean,
    verified_at: Date
  },
  created_at: Date,
  updated_at: Date,
  last_login: Date,
  is_active: Boolean,
  is_banned: Boolean,
  banned_reason: String,
  banned_until: Date
}

// Indexes
// email (unique)
// username (unique)
// role
// created_at