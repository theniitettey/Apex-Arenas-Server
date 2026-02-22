import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IApexMessage{
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  username?: string; // denormalized for quick display
  message: string;
  type: 'text' | 'system' | 'evidence';
  attachments?: string[];
  created_at: Date;
  edited: boolean;
  edited_at?: Date;
}

const ApexMessageSchema = new Schema<IApexMessage>({
  user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
  username: { type: String },
  message: { type: String, required: true, maxlength: 1000 },
  type: { type: String, enum: ['text', 'system', 'evidence'], default: 'text' },
  attachments: [{ type: String }],
  created_at: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  edited_at: { type: Date }
});

// -------------------------------------------------------------------------
// Evidence Subdocument Interface
// -------------------------------------------------------------------------
export interface IApexEvidence {
  _id?: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  username?: string;
  file_url: string;
  file_type: 'image' | 'video' | 'other';
  uploaded_at: Date;
  description?: string;
}

// -------------------------------------------------------------------------
// Match Session Model Interface
// -------------------------------------------------------------------------
export interface IApexMatchSession extends Document {
  _id: mongoose.Types.ObjectId;
  match_id: mongoose.Types.ObjectId;
  tournament_id: mongoose.Types.ObjectId;
  
  // Participants (denormalized for quick auth checks)
  participant_ids: mongoose.Types.ObjectId[];
  organizer_id: mongoose.Types.ObjectId;
  
  // Session data
  status: 'active' | 'archived' | 'locked';
  started_at: Date;
  ended_at?: Date;
  
  // Messages
  messages: IApexMessage[];
  message_count: number;
  
  // Evidence (embedded subdocuments)
  evidence: IApexEvidence[];
  
  // Settings
  is_read_only: boolean;
  allow_evidence_upload: boolean;
  
  created_at: Date;
  updated_at: Date;
}

const ApexMatchSessionSchema = new Schema<IApexMatchSession>({
  match_id: { type: Schema.Types.ObjectId, ref: 'ApexMatch', required: true, unique: true },
  tournament_id: { type: Schema.Types.ObjectId, ref: 'ApexTournament', required: true },
  
  participant_ids: [{ type: Schema.Types.ObjectId, ref: 'ApexUser', required: true }],
  organizer_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
  
  status: { type: String, enum: ['active', 'archived', 'locked'], default: 'active' },
  started_at: { type: Date, default: Date.now },
  ended_at: { type: Date },
  
  messages: [ApexMessageSchema],
  message_count: { type: Number, default: 0 },
  
  evidence: [{
    user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
    username: { type: String },
    file_url: { type: String, required: true },
    file_type: { type: String, enum: ['image', 'video', 'other'], required: true },
    uploaded_at: { type: Date, default: Date.now },
    description: { type: String, maxlength: 500 }
  }],
  
  is_read_only: { type: Boolean, default: false },
  allow_evidence_upload: { type: Boolean, default: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexMatchSessionSchema.index({ match_id: 1 }, { unique: true });
ApexMatchSessionSchema.index({ tournament_id: 1 });
ApexMatchSessionSchema.index({ participant_ids: 1 });
ApexMatchSessionSchema.index({ status: 1 });
ApexMatchSessionSchema.index({ started_at: -1 });

export const MatchSession = mongoose.model<IApexMatchSession>('ApexMatchSession', ApexMatchSessionSchema);
