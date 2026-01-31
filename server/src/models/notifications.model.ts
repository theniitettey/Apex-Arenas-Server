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

const ApexNotificationSchema = new Schema<IApexNotification>({
  user_id: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
  
  type: { 
    type: String, 
    enum: [
      'tournament_reminder', 'match_scheduled', 'match_starting', 'match_result',
      'payment_received', 'payment_failed', 'tournament_cancelled', 'payout_completed',
      'registration_confirmed', 'check_in_reminder', 'bracket_updated',
      'team_invite', 'team_join_request', 'team_member_joined', 'team_member_left',
      'game_request_pending', 'game_request_approved', 'game_request_rejected', 'game_request_upvoted',
      'security_alert', 'account_update', 'system_announcement'
    ],
    required: true 
  },
  priority: { 
    type: String, 
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal' 
  },
  
  title: { type: String, required: true, maxlength: 100 },
  message: { type: String, required: true, maxlength: 500 },
  
  image_url: { type: String },
  
  related_to: {
    entity_type: { 
      type: String, 
      enum: ['tournament', 'match', 'transaction', 'game_request', 'payout_request', 'team', 'user'] 
    },
    entity_id: { type: Schema.Types.ObjectId }
  },
  
  action_url: { type: String },
  
  group_key: { type: String },
  
  is_read: { type: Boolean, default: false },
  read_at: { type: Date },
  
  expires_at: { type: Date },
  is_expired: { type: Boolean, default: false },
  
  delivery_channels: {
    in_app: { type: Boolean, default: true },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
    push: { type: Boolean, default: false }
  },
  
  delivery_status: {
    in_app_sent: { type: Boolean, default: false },
    in_app_sent_at: { type: Date },
    email_sent: { type: Boolean, default: false },
    email_sent_at: { type: Date },
    email_error: { type: String },
    sms_sent: { type: Boolean, default: false },
    sms_sent_at: { type: Date },
    sms_error: { type: String },
    push_sent: { type: Boolean, default: false },
    push_sent_at: { type: Date },
    push_error: { type: String }
  },
  
  scheduled_for: { type: Date },
  is_scheduled: { type: Boolean, default: false }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Indexes
ApexNotificationSchema.index({ user_id: 1 });
ApexNotificationSchema.index({ is_read: 1 });
ApexNotificationSchema.index({ created_at: -1 });
ApexNotificationSchema.index({ expires_at: 1 }, { sparse: true });
ApexNotificationSchema.index({ priority: 1 });
ApexNotificationSchema.index({ type: 1 });
ApexNotificationSchema.index({ is_scheduled: 1, scheduled_for: 1 });
ApexNotificationSchema.index({ user_id: 1, is_read: 1, created_at: -1 });
ApexNotificationSchema.index({ user_id: 1, type: 1, created_at: -1 });
ApexNotificationSchema.index({ group_key: 1 }, { sparse: true });

export const Notification = mongoose.model<IApexNotification>('ApexNotification', ApexNotificationSchema);