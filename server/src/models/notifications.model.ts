import mongoose, {Document, Model, Schema} from "mongoose";

export interface IApexNotification extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  
  type: string; // enum: ['tournament_reminder', 'match_scheduled', 'payment_received', 'tournament_cancelled', 'payout_completed', 'game_request_pending', 'game_request_approved', 'game_request_rejected', 'game_request_upvoted']
  priority: string; // enum: ['low', 'normal', 'high', 'urgent']
  
  title: string;
  message: string;
  
  // Rich content
  image_url?: string; // optional image/icon
  
  related_to: {
    entity_type: string; // enum: ['tournament', 'match', 'transaction', 'game_request', 'payout_request']
    entity_id: mongoose.Types.ObjectId;
  };
  
  action_url?: string; // deep link for navigation (e.g., '/tournaments/123')
  
  // Grouping for notification batching
  group_key?: string; // e.g., 'tournament_123_updates' - group similar notifications
  
  is_read: boolean;
  read_at?: Date;
  
  // Expiry for time-sensitive notifications
  expires_at?: Date; // e.g., check-in reminder expires after check-in window
  is_expired: boolean;
  
  delivery_channels: {
    in_app: boolean;
    email: boolean;
    sms: boolean;
    push: boolean;
  };
  
  delivery_status: {
    in_app_sent: boolean;
    in_app_sent_at?: Date;
    email_sent: boolean;
    email_sent_at?: Date;
    email_error?: string;
    sms_sent: boolean;
    sms_sent_at?: Date;
    sms_error?: string;
    push_sent: boolean;
    push_sent_at?: Date;
    push_error?: string;
  };
  
  // For scheduled notifications
  scheduled_for?: Date;
  is_scheduled: boolean;
  
  created_at: Date;
}

/**
 * Indexes:
 * - user_id
 * - is_read
 * - created_at
 * - expires_at
 * - priority
 * - type
 * - is_scheduled + scheduled_for (for scheduled notification jobs)
 * - Compound: user_id + is_read + created_at (for unread notifications query)
 * - Compound: user_id + type + created_at
 */