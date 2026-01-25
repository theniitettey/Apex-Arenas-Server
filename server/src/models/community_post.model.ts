import mongoose, {Document, Schema} from "mongoose";

export interface IApexCommunityPost extends Document {
  _id: mongoose.Types.ObjectId;
  
  // Core post info
  author_id: mongoose.Types.ObjectId;
  post_type: string; // enum: ['game_request', 'team_recruitment', 'tournament_feedback', 'strategy_guide', 'general_discussion', 'announcement']
  title: string;
  content: string;
  
  // Media attachments
  attachments?: {
    images: string[];
    videos: string[];
  };
  
  // Categorization
  game_id?: mongoose.Types.ObjectId; // Optional: if post is game-specific
  tournament_id?: mongoose.Types.ObjectId; // Optional: if post is about a tournament
  
  // Community engagement
  upvotes: number;
  upvoted_by: mongoose.Types.ObjectId[];
  downvotes: number;
  downvoted_by: mongoose.Types.ObjectId[];
  comment_count: number; // Count of comments
  views: number;
  
  // Status & moderation
  status: string; // enum: ['active', 'locked', 'archived', 'removed', 'pending_review']
  is_pinned: boolean;
  is_featured: boolean;
  tags: string[];
  
  // Admin/moderation
  moderated_by?: mongoose.Types.ObjectId;
  moderation_reason?: string;
  moderated_at?: Date;
  
  created_at: Date;
  updated_at: Date;
  last_activity_at: Date; // updated when new comments are added
}

const ApexCommunityPostSchema = new Schema<IApexCommunityPost>({
  author_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  post_type: { 
    type: String, 
    enum: ['game_request', 'team_recruitment', 'tournament_feedback', 'strategy_guide', 'general_discussion', 'announcement'],
    required: true 
  },
  title: { type: String, required: true, maxlength: 200 },
  content: { type: String, required: true, maxlength: 10000 },
  
  attachments: {
    images: [{ type: String }],
    videos: [{ type: String }]
  },
  
  game_id: { type: Schema.Types.ObjectId, ref: 'Game' },
  tournament_id: { type: Schema.Types.ObjectId, ref: 'Tournament' },
  
  upvotes: { type: Number, default: 0 },
  upvoted_by: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  downvotes: { type: Number, default: 0 },
  downvoted_by: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  comment_count: { type: Number, default: 0 },
  views: { type: Number, default: 0 },
  
  status: { 
    type: String, 
    enum: ['active', 'locked', 'archived', 'removed', 'pending_review'],
    default: 'active' 
  },
  is_pinned: { type: Boolean, default: false },
  is_featured: { type: Boolean, default: false },
  tags: [{ type: String, maxlength: 30 }],
  
  moderated_by: { type: Schema.Types.ObjectId, ref: 'User' },
  moderation_reason: { type: String, maxlength: 500 },
  moderated_at: { type: Date },
  
  last_activity_at: { type: Date, default: Date.now }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexCommunityPostSchema.index({ author_id: 1 });
ApexCommunityPostSchema.index({ post_type: 1 });
ApexCommunityPostSchema.index({ status: 1 });
ApexCommunityPostSchema.index({ game_id: 1 }, { sparse: true });
ApexCommunityPostSchema.index({ created_at: -1 });
ApexCommunityPostSchema.index({ upvotes: -1 });
ApexCommunityPostSchema.index({ last_activity_at: -1 });
ApexCommunityPostSchema.index({ is_pinned: -1, created_at: -1 });
ApexCommunityPostSchema.index({ status: 1, post_type: 1, created_at: -1 });
ApexCommunityPostSchema.index({ game_id: 1, status: 1, created_at: -1 });
ApexCommunityPostSchema.index({ tags: 1 });

export const CommunityPost = mongoose.model<IApexCommunityPost>('ApexCommunityPost', ApexCommunityPostSchema);