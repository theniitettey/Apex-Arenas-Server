import mongoose, {Document, Model, Schema} from "mongoose";

export interface IApexNotification extends Document {
  _id: mongoose.Types.ObjectId,
  user_id: mongoose.Types.ObjectId,
  
  type: string, // enum: ['tournament_reminder', 'match_scheduled', 'payment_received', 'tournament_cancelled', 'game_request_pending', 'game_request_approved', 'game_request_rejected', 'game_request_upvoted']
  
  title: String,
  message: String,
  
  related_to: {
    entity_type: String, // enum: ['tournament', 'match', 'transaction', 'game_request']
    entity_id: mongoose.Types.ObjectId
  },
  
  is_read: Boolean,
  read_at: Date,
  
  delivery_channels: {
    in_app: Boolean,
    email: Boolean,
    sms: Boolean,
    push: Boolean
  },
  
  created_at: Date
}

/**
 * user_id
is_read
created_at
 */