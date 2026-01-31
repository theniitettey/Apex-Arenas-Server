import mongoose, {Document, Schema} from "mongoose";

export interface IApexTournamentFeedback extends Document {
  _id: mongoose.Types.ObjectId;
  
  // Context
  tournament_id: mongoose.Types.ObjectId;
  author_id: mongoose.Types.ObjectId; // Player who participated
  
  // Ratings (1-5 stars)
  overall_rating: number;
  organizer_rating: number;
  structure_rating: number;
  communication_rating: number;
  fairness_rating: number;
  
  // Written feedback
  pros: string[];
  cons: string[];
  suggestions: string;
  
  // Would they play again?
  would_recommend: boolean;
  
  // Verification (ensure they actually participated)
  verified_participant: boolean;
  registration_id?: mongoose.Types.ObjectId; // Link to their registration
  
  // Community response
  helpful_count: number;
  reported_count: number;
  
  // Organizer response
  organizer_reply?: string;
  organizer_replied_at?: Date;
  
  status: string; // enum: ['pending', 'published', 'hidden', 'flagged']
  
  created_at: Date;
  updated_at: Date;
}

const ApexTournamentFeedbackSchema = new Schema<IApexTournamentFeedback>({
  tournament_id: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true },
  author_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
  
  overall_rating: { type: Number, required: true, min: 1, max: 5 },
  organizer_rating: { type: Number, required: true, min: 1, max: 5 },
  structure_rating: { type: Number, required: true, min: 1, max: 5 },
  communication_rating: { type: Number, required: true, min: 1, max: 5 },
  fairness_rating: { type: Number, required: true, min: 1, max: 5 },
  
  pros: [{ type: String, maxlength: 200 }],
  cons: [{ type: String, maxlength: 200 }],
  suggestions: { type: String, maxlength: 1000 },
  
  would_recommend: { type: Boolean, required: true },
  
  verified_participant: { type: Boolean, default: false },
  registration_id: { type: Schema.Types.ObjectId, ref: 'Registration' },
  
  helpful_count: { type: Number, default: 0 },
  reported_count: { type: Number, default: 0 },
  
  organizer_reply: { type: String, maxlength: 1000 },
  organizer_replied_at: { type: Date },
  
  status: { 
    type: String, 
    enum: ['pending', 'published', 'hidden', 'flagged'],
    default: 'pending' 
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexTournamentFeedbackSchema.index({ tournament_id: 1 });
ApexTournamentFeedbackSchema.index({ author_id: 1 });
ApexTournamentFeedbackSchema.index({ status: 1 });
ApexTournamentFeedbackSchema.index({ overall_rating: -1 });
ApexTournamentFeedbackSchema.index({ tournament_id: 1, author_id: 1 }, { unique: true });
ApexTournamentFeedbackSchema.index({ tournament_id: 1, status: 1, created_at: -1 });

export const TournamentFeedback = mongoose.model<IApexTournamentFeedback>('ApexTournamentFeedback', ApexTournamentFeedbackSchema);