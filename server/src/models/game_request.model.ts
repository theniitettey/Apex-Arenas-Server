import mongoose, {Document, Schema} from "mongoose";

export interface IApexGameRequest extends Document {
  _id: mongoose.Types.ObjectId,
  
  // Who requested it
  requester_id: mongoose.Types.ObjectId, // reference to users
  
  // Game details
  game_name: string, // e.g., "Apex Legends"
  slug: string, // auto-generated: "apex-legends"
  category: string, // enum: ['fps', 'moba', 'sports', 'fighting', 'battle_royale', 'other']
  platform: string[], // e.g., ['pc', 'ps5', 'xbox']
  
  // Why they want it
  reason: string, // "This game is very popular in Ghana"
  estimated_players: number, // Optional: How many players they think will join
  
  // Community support
  upvotes: number, // Other users can upvote this request
  upvoted_by: mongoose.Types.ObjectId[], // Track who upvoted (prevent duplicate votes)
  
  // Admin review
  status: string, // enum: ['pending', 'under_review', 'approved', 'rejected']
  
  admin_review: {
    reviewed_by: mongoose.Types.ObjectId, // admin user_id
    reviewed_at: Date,
    review_notes: string, // Internal admin notes
    rejection_reason: string, // Shown to user if rejected
  },
  
  // If approved, link to created game
  approved_game_id: mongoose.Types.ObjectId, // reference to games collection (null if not approved)
  
  // Optional: User can provide references
  references: {
    website_url: string, // Official game website
    popularity_proof: string, // Link to stats/articles showing popularity
  },
  
  // Metadata
  priority: string, // enum: ['low', 'medium', 'high'] - Admin can set priority
  
  created_at: Date,
  updated_at: Date,
  reviewed_at: Date,
}

/**
 * Indexes:
 * requester_id
 * status
 * upvotes (descending - show most requested first)
 * created_at
 * Compound: status + upvotes (for admin dashboard sorting)
 */