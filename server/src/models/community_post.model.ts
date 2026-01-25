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

/**
 * Indexes:
 * - author_id
 * - post_type
 * - status
 * - game_id
 * - created_at
 * - upvotes (for trending/popular sorting)
 * - Compound: status + post_type + created_at
 * - Compound: game_id + status + created_at
 */