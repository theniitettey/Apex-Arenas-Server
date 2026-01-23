import mongoose, {Document, Schema} from "mongoose";

export interface IApexTournamentFeedback extends Document {
  _id: mongoose.Types.ObjectId,
  
  // Context
  tournament_id: mongoose.Types.ObjectId,
  author_id: mongoose.Types.ObjectId, // Player who participated
  
  // Ratings (1-5 stars)
  overall_rating: number,
  organizer_rating: number,
  structure_rating: number,
  communication_rating: number,
  fairness_rating: number,
  
  // Written feedback
  pros: string[],
  cons: string[],
  suggestions: string,
  
  // Would they play again?
  would_recommend: boolean,
  
  // Verification (ensure they actually participated)
  verified_participant: boolean,
  registration_id?: mongoose.Types.ObjectId, // Link to their registration
  
  // Community response
  helpful_count: number,
  reported_count: number,
  
  // Organizer response
  organizer_reply?: string,
  organizer_replied_at?: Date,
  
  status: string, // enum: ['pending', 'published', 'hidden', 'flagged']
  
  created_at: Date,
  updated_at: Date
}