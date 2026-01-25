import mongoose, {Document, Schema, Model} from 'mongoose';

export interface IApexUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string; // unique, required
  username: string; // unique, required
  password_hash: string; // hashed password
  role: string; // enum: ['player', 'organizer', 'admin']
  profile: {
    first_name: string;
    last_name: string;
    avatar_url: string;
    country: string;
    date_of_birth: Date;
    phone_number: string;
  };
  game_profiles: [
    {
      game_id: mongoose.Types.ObjectId; // reference to games collection
      in_game_id: string; // standardized name for in-game identifier
      skill_level: string; // enum: ['beginner', 'intermediate', 'advanced', 'pro']
      rank: string;
    }
  ];
  wallet: {
    available_balance: number; // funds available for withdrawal (store as pesewas/integers)
    pending_balance: number; // winnings pending admin approval
    total_balance: number; // available + pending
    currency: string; // default: 'GHS' (Ghana Cedis)
    escrow_locked: number; // funds locked in active tournaments (entry fees)
  };
  momo_account: {
    phone_number: string; // Mobile Money number for payouts
    network: string; // enum: ['MTN', 'Vodafone', 'AirtelTigo']
    account_name: string; // Name registered on MoMo
    is_verified: boolean;
    verified_at: Date;
  };
  stats: {
    tournaments_played: number;
    tournaments_won: number;
    total_earnings: number;
    win_rate: number;
  };
  verification_status: {
    email_verified: boolean;
    phone_verified: boolean;
    identity_verified: boolean;
    organizer_verified: boolean; // verified organizers can create paid tournaments
    verified_at: Date;
  };
  created_at: Date;
  updated_at: Date;
  last_login: Date;
  is_active: boolean;
  is_banned: boolean;
  banned_reason: string;
  banned_until: Date;
}

// Indexes
// email (unique)
// username (unique)
// role
// created_at
// game_profiles.game_id
// game_profiles.in_game_id