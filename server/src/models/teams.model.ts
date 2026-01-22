import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexTeam extends Document {
  _id: mongoose.Types.ObjectId,
  name: String, // unique
  tag: String, // team abbreviation
  captain_id: mongoose.Types.ObjectId, // reference to users
  
  members: [
    {
      user_id: mongoose.Types.ObjectId,
      role: String, // enum: ['captain', 'player', 'substitute']
      joined_at: Date,
      status: String // enum: ['active', 'inactive', 'kicked']
    }
  ],
  
  max_size: Number,
  
  logo_url: String,
  
  stats: {
    tournaments_played: Number,
    tournaments_won: Number,
    win_rate: Number
  },
  
  created_at: Date,
  updated_at: Date,
  is_active: Boolean
} 



/**
 * name (unique)
captain_id
members.user_id
 */