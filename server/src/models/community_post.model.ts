
import mongoose, {Document, Schema} from "mongoose";

export interface IApexCommunityPost extends Document {
  _id: mongoose.Types.ObjectId,
  
  // Core post info
  author_id: mongoose.Types.ObjectId,
  post_type: string, // enum: ['game_request', 'team_recruitment', 'tournament_feedback', 'strategy_guide', 'general_discussion']
  title: string,
  content: string,
  
  // Categorization
  game_id?: mongoose.Types.ObjectId, // Optional: if post is game-specific
  tournament_id?: mongoose.Types.ObjectId, // Optional: if post is about a tournament
  
  // Community engagement
  upvotes: number,
  upvoted_by: mongoose.Types.ObjectId[],
  comments: number, // Count of comments
  views: number,
  
  // Status & moderation
  status: string, // enum: ['active', 'locked', 'archived', 'removed']
  is_pinned: boolean,
  tags: string[],
  
  // Admin/moderation
  moderated_by?: mongoose.Types.ObjectId,
  moderation_reason?: string,
  moderated_at?: Date,
  
  created_at: Date,
  updated_at: Date
}