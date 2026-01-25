import mongoose, {Document, Schema} from "mongoose";

export interface IApexReportFeedback extends Document {
  _id: mongoose.Types.ObjectId;
  
  // Who submitted it
  reporter_id: mongoose.Types.ObjectId;
  
  // What type of report/feedback
  type: string; // enum: ['bug_report', 'feature_request', 'general_feedback', 'user_report', 'tournament_report', 'payment_issue']
  
  // Core content
  title: string;
  description: string;
  suggestion?: string; // Optional: their suggested fix/improvement
  
  // Context (optional - what this is about)
  context: {
    entity_type?: string; // enum: ['tournament', 'match', 'user', 'payment', 'game', 'platform']
    entity_id?: mongoose.Types.ObjectId; // ID of the related entity
  };
  
  // Categorization for organization
  category?: string; // enum: ['registration', 'tournament_flow', 'payment', 'ui_ux', 'performance', 'security', 'other']
  priority: string; // enum: ['low', 'medium', 'high', 'critical'] - can be auto-set or admin-set
  
  // Status tracking
  status: string; // enum: ['new', 'acknowledged', 'in_progress', 'resolved', 'closed', 'duplicate', 'wont_fix']
  
  // Attachments (screenshots, logs, etc.)
  attachments: {
    screenshots: string[]; // URLs
    logs: string[]; // Log file URLs
    other_files: string[];
  };
  
  // Admin handling
  assigned_to?: mongoose.Types.ObjectId; // Admin assigned to handle
  admin_notes?: string; // Internal notes
  
  // Resolution info
  resolution: {
    resolved_by?: mongoose.Types.ObjectId;
    resolved_at?: Date;
    resolution_notes?: string;
    fix_version?: string; // e.g., "v1.2.3" - which release fixed it
    is_public: boolean; // Whether to show resolution to reporter
  };
  
  // Follow-up communication
  follow_up_required: boolean;
  follow_up_notes?: string;
  
  // Metadata
  platform_info: {
    browser?: string;
    browser_version?: string;
    os?: string;
    device?: string;
    screen_resolution?: string;
    app_version?: string; // Your platform's version
  };
  
  // For bug reports specifically
  bug_details?: {
    steps_to_reproduce: string[];
    expected_result: string;
    actual_result: string;
    frequency: string; // enum: ['always', 'sometimes', 'once']
    environment: string; // enum: ['production', 'staging', 'development']
  };
  
  // Privacy & visibility
  visibility: string; // enum: ['private', 'public_anonymous', 'public_with_name']
  allow_contact: boolean; // Can we contact reporter for more info?
  
  // Community voting (if made public)
  upvotes: number;
  upvoted_by: mongoose.Types.ObjectId[]; // Users who think this is important
  
  created_at: Date;
  updated_at: Date;
  resolved_at?: Date;
  closed_at?: Date;
}

const ApexReportFeedbackSchema = new Schema<IApexReportFeedback>({
  reporter_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  
  type: { 
    type: String, 
    enum: ['bug_report', 'feature_request', 'general_feedback', 'user_report', 'tournament_report', 'payment_issue'],
    required: true 
  },
  
  title: { type: String, required: true, maxlength: 200 },
  description: { type: String, required: true, maxlength: 5000 },
  suggestion: { type: String, maxlength: 2000 },
  
  context: {
    entity_type: { 
      type: String, 
      enum: ['tournament', 'match', 'user', 'payment', 'game', 'platform'] 
    },
    entity_id: { type: Schema.Types.ObjectId }
  },
  
  category: { 
    type: String, 
    enum: ['registration', 'tournament_flow', 'payment', 'ui_ux', 'performance', 'security', 'other'] 
  },
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium' 
  },
  
  status: { 
    type: String, 
    enum: ['new', 'acknowledged', 'in_progress', 'resolved', 'closed', 'duplicate', 'wont_fix'],
    default: 'new' 
  },
  
  attachments: {
    screenshots: [{ type: String }],
    logs: [{ type: String }],
    other_files: [{ type: String }]
  },
  
  assigned_to: { type: Schema.Types.ObjectId, ref: 'User' },
  admin_notes: { type: String, maxlength: 2000 },
  
  resolution: {
    resolved_by: { type: Schema.Types.ObjectId, ref: 'User' },
    resolved_at: { type: Date },
    resolution_notes: { type: String, maxlength: 2000 },
    fix_version: { type: String },
    is_public: { type: Boolean, default: false }
  },
  
  follow_up_required: { type: Boolean, default: false },
  follow_up_notes: { type: String, maxlength: 1000 },
  
  platform_info: {
    browser: { type: String },
    browser_version: { type: String },
    os: { type: String },
    device: { type: String },
    screen_resolution: { type: String },
    app_version: { type: String }
  },
  
  bug_details: {
    steps_to_reproduce: [{ type: String }],
    expected_result: { type: String },
    actual_result: { type: String },
    frequency: { type: String, enum: ['always', 'sometimes', 'once'] },
    environment: { type: String, enum: ['production', 'staging', 'development'] }
  },
  
  visibility: { 
    type: String, 
    enum: ['private', 'public_anonymous', 'public_with_name'],
    default: 'private' 
  },
  allow_contact: { type: Boolean, default: true },
  
  upvotes: { type: Number, default: 0 },
  upvoted_by: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  
  resolved_at: { type: Date },
  closed_at: { type: Date }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexReportFeedbackSchema.index({ reporter_id: 1 });
ApexReportFeedbackSchema.index({ type: 1 });
ApexReportFeedbackSchema.index({ status: 1 });
ApexReportFeedbackSchema.index({ priority: 1 });
ApexReportFeedbackSchema.index({ assigned_to: 1 }, { sparse: true });
ApexReportFeedbackSchema.index({ created_at: -1 });
ApexReportFeedbackSchema.index({ type: 1, status: 1 });
ApexReportFeedbackSchema.index({ status: 1, priority: -1 });
ApexReportFeedbackSchema.index({ assigned_to: 1, status: 1 });

export const ReportFeedback = mongoose.model<IApexReportFeedback>('ApexReportFeedback', ApexReportFeedbackSchema);