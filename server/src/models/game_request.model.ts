import mongoose, {Document, Schema} from "mongoose";

export interface IApexGameRequest extends Document {
  _id: mongoose.Types.ObjectId;
  
  // Who requested it
  requester_id: mongoose.Types.ObjectId; // reference to users
  
  // Game details
  game_name: string; // e.g., "Apex Legends"
  slug: string; // auto-generated: "apex-legends" - used for duplicate detection
  category: string; // enum: ['fps', 'moba', 'sports', 'fighting', 'battle_royale', 'card', 'racing', 'other']
  platform: string[]; // e.g., ['pc', 'ps5', 'xbox']
  
  // Why they want it
  reason: string; // "This game is very popular in Ghana"
  estimated_players: number; // Optional: How many players they think will join
  
  // Community support
  upvotes: number; // Other users can upvote this request
  upvoted_by: mongoose.Types.ObjectId[]; // Track who upvoted (prevent duplicate votes)
  
  // Admin review
  status: string; // enum: ['pending', 'under_review', 'approved', 'rejected', 'duplicate']
  
  // If marked as duplicate
  duplicate_of?: mongoose.Types.ObjectId; // reference to another game_request or existing game
  
  admin_review: {
    reviewed_by?: mongoose.Types.ObjectId; // admin user_id
    reviewed_at?: Date;
    review_notes?: string; // Internal admin notes
    rejection_reason?: string; // Shown to user if rejected
  };
  
  // If approved, link to created game
  approved_game_id?: mongoose.Types.ObjectId; // reference to games collection
  
  // Optional: User can provide references
  references: {
    website_url?: string; // Official game website
    popularity_proof?: string; // Link to stats/articles showing popularity
  };
  
  // Metadata
  priority: string; // enum: ['low', 'medium', 'high'] - Admin can set priority
  
  created_at: Date;
  updated_at: Date;
  reviewed_at?: Date;
}

const ApexGameRequestSchema = new Schema<IApexGameRequest>({
  requester_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  
  game_name: { type: String, required: true, trim: true, maxlength: 100 },
  slug: { type: String, required: true, lowercase: true, trim: true },
  category: { 
    type: String, 
    enum: ['fps', 'moba', 'sports', 'fighting', 'battle_royale', 'card', 'racing', 'other'],
    required: true 
  },
  platform: [{ 
    type: String, 
    enum: ['pc', 'ps4', 'ps5', 'xbox', 'nintendo', 'mobile', 'cross_platform'] 
  }],
  
  reason: { type: String, required: true, maxlength: 1000 },
  estimated_players: { type: Number, min: 0 },
  
  upvotes: { type: Number, default: 0 },
  upvoted_by: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  
  status: { 
    type: String, 
    enum: ['pending', 'under_review', 'approved', 'rejected', 'duplicate'],
    default: 'pending' 
  },
  
  duplicate_of: { type: Schema.Types.ObjectId },
  
  admin_review: {
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewed_at: { type: Date },
    review_notes: { type: String, maxlength: 1000 },
    rejection_reason: { type: String, maxlength: 500 }
  },
  
  approved_game_id: { type: Schema.Types.ObjectId, ref: 'Game' },
  
  references: {
    website_url: { type: String },
    popularity_proof: { type: String }
  },
  
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high'],
    default: 'low' 
  },
  
  reviewed_at: { type: Date }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexGameRequestSchema.index({ requester_id: 1 });
ApexGameRequestSchema.index({ slug: 1 });
ApexGameRequestSchema.index({ status: 1 });
ApexGameRequestSchema.index({ upvotes: -1 });
ApexGameRequestSchema.index({ created_at: -1 });
ApexGameRequestSchema.index({ status: 1, upvotes: -1 });
ApexGameRequestSchema.index({ status: 1, priority: -1, upvotes: -1 });

export const GameRequest = mongoose.model<IApexGameRequest>('ApexGameRequest', ApexGameRequestSchema);