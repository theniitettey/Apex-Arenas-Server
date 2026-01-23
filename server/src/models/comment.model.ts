
import mongoose, {Document, Schema} from "mongoose";

export interface IApexComment extends Document {
  _id: mongoose.Types.ObjectId,
  
  // What this comment is attached to
  parent_type: string, // enum: ['community_post', 'tournament', 'user_profile']
  parent_id: mongoose.Types.ObjectId, // ID of the parent entity
  
  // Comment content
  author_id: mongoose.Types.ObjectId,
  content: string,
  
  // Nested comments (replies)
  parent_comment_id?: mongoose.Types.ObjectId, // If this is a reply
  depth: number, // 0 for top-level, 1 for reply, etc.
  
  // Engagement
  upvotes: number,
  upvoted_by: mongoose.Types.ObjectId[],
  
  // Moderation
  status: string, // enum: ['active', 'hidden', 'removed']
  reported_count: number,
  
  // Metadata
  edited: boolean,
  edited_at?: Date,
  
  created_at: Date,
  updated_at: Date
}