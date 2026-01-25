import mongoose, {Document, Model, Schema} from "mongoose";

export interface IApexNotification extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  
  type: string; // enum: ['tournament_reminder', 'match_scheduled', 'payment_received', 'tournament_cancelled', 'payout_completed', 'game_request_pending', 'game_request_approved', 'game_request_rejected', 'game_request_upvoted']
  
  title: string;
  message: string;
  
  related_to: {
    entity_type: string; // enum: ['tournament', 'match', 'transaction', 'game_request', 'payout_request']
    entity_id: mongoose.Types.ObjectId;
  };
  
  action_url?: string; // deep link for navigation (e.g., '/tournaments/123')
  
  is_read: boolean;
  read_at?: Date;
  
  delivery_channels: {
    in_app: boolean;
    email: boolean;
    sms: boolean;
    push: boolean;
  };
  
  delivery_status: {
    in_app_sent: boolean;
    email_sent: boolean;
    sms_sent: boolean;
    push_sent: boolean;
  };
  
  created_at: Date;
}

/**
 * Indexes:
 * - user_id
 * - is_read
 * - created_at
 * - Compound: user_id + is_read + created_at (for unread notifications query)
 */