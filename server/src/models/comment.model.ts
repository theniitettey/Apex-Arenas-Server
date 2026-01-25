import mongoose, {Document, Schema} from "mongoose";

export interface IApexComment extends Document {
  _id: mongoose.Types.ObjectId;
  
  // What this comment is attached to
  parent_type: string; // enum: ['community_post', 'tournament', 'user_profile']
  parent_id: mongoose.Types.ObjectId; // ID of the parent entity
  
  // Comment content
  author_id: mongoose.Types.ObjectId;
  content: string;
  
  // Nested comments (replies)
  parent_comment_id?: mongoose.Types.ObjectId; // If this is a reply
  depth: number; // 0 for top-level, 1 for reply, etc. (max depth: 3 recommended)
  reply_count: number; // number of direct replies
  
  // Engagement
  upvotes: number;
  upvoted_by: mongoose.Types.ObjectId[];
  
  // Moderation
  status: string; // enum: ['active', 'hidden', 'removed']
  reported_count: number;
  reported_by: mongoose.Types.ObjectId[];
  
  // Metadata
  edited: boolean;
  edited_at?: Date;
  
  created_at: Date;
  updated_at: Date;
}


const ApexCommentSchema = new Schema<IApexComment>({
  parent_type: { 
    type: String, 
    enum: ['community_post', 'tournament', 'user_profile'],
    required: true 
  },
  parent_id: { type: Schema.Types.ObjectId, required: true },
  
  author_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, maxlength: 2000 },
  
  parent_comment_id: { type: Schema.Types.ObjectId, ref: 'Comment' },
  depth: { type: Number, default: 0, max: 3 },
  reply_count: { type: Number, default: 0 },
  
  upvotes: { type: Number, default: 0 },
  upvoted_by: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  
  status: { 
    type: String, 
    enum: ['active', 'hidden', 'removed'],
    default: 'active' 
  },
  reported_count: { type: Number, default: 0 },
  reported_by: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  
  edited: { type: Boolean, default: false },
  edited_at: { type: Date }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexCommentSchema.index({ parent_type: 1, parent_id: 1 });
ApexCommentSchema.index({ author_id: 1 });
ApexCommentSchema.index({ parent_comment_id: 1 }, { sparse: true });
ApexCommentSchema.index({ status: 1 });
ApexCommentSchema.index({ created_at: -1 });
ApexCommentSchema.index({ parent_type: 1, parent_id: 1, status: 1, created_at: -1 });
ApexCommentSchema.index({ parent_type: 1, parent_id: 1, depth: 1 });

export const Comment = mongoose.model<IApexComment>('ApexComment', ApexCommentSchema);