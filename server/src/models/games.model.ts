import mongoose, {Document, Schema, Model} from "mongoose";

export interface IApexGame extends Document {
  _id: mongoose.Types.ObjectId,
  name: String, // e.g., "Valorant", "FIFA 24"
  slug: String, // unique, e.g., "valorant"
  
  category: String, // enum: ['fps', 'moba', 'sports', 'fighting', 'battle_royale']
  platform: [String], // e.g., ['pc', 'ps5', 'xbox', 'mobile']
  
  logo_url: String,
  banner_url: String,
  
  is_active: Boolean,
  
  created_at: Date,
  updated_at: Date
}

/**
 * slug (unique)
is_active
 */