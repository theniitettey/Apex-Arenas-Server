
import mongoose, {Document, Schema} from "mongoose";

export interface IApexReportFeedback extends Document {
  _id: mongoose.Types.ObjectId,
  
  // Who submitted it
  reporter_id: mongoose.Types.ObjectId,
  
  // What type of report/feedback
  type: string, // enum: ['bug_report', 'feature_request', 'general_feedback', 'user_report', 'tournament_report', 'payment_issue']
  
  // Core content
  title: string,
  description: string,
  suggestion: string, // Optional: their suggested fix/improvement
  
  // Context (optional - what this is about)
  context: {
    entity_type?: string, // enum: ['tournament', 'match', 'user', 'payment', 'game', 'platform']
    entity_id?: mongoose.Types.ObjectId // ID of the related entity
  },
  
  // Categorization for organization
  category?: string, // enum: ['registration', 'tournament_flow', 'payment', 'ui_ux', 'performance', 'security', 'other']
  priority: string, // enum: ['low', 'medium', 'high', 'critical'] - can be auto-set or admin-set
  
  // Status tracking
  status: string, // enum: ['new', 'acknowledged', 'in_progress', 'resolved', 'closed', 'duplicate', 'wont_fix']
  
  // Attachments (screenshots, logs, etc.)
  attachments: {
    screenshots: string[], // URLs
    logs: string[], // Log file URLs
    other_files: string[]
  },
  
  // Admin handling
  assigned_to?: mongoose.Types.ObjectId, // Admin assigned to handle
  admin_notes: string, // Internal notes
  
  // Resolution info
  resolution: {
    resolved_by?: mongoose.Types.ObjectId,
    resolved_at?: Date,
    resolution_notes?: string,
    fix_version?: string, // e.g., "v1.2.3" - which release fixed it
    is_public: boolean // Whether to show resolution to reporter
  },
  
  // Follow-up communication
  follow_up_required: boolean,
  follow_up_notes?: string,
  
  // Metadata
  platform_info: {
    browser: string,
    browser_version: string,
    os: string,
    device: string,
    screen_resolution: string,
    app_version: string // Your platform's version
  },
  
  // For bug reports specifically
  bug_details: {
    steps_to_reproduce: string[],
    expected_result: string,
    actual_result: string,
    frequency: string, // enum: ['always', 'sometimes', 'once']
    environment: string // enum: ['production', 'staging', 'development']
  },
  
  // Privacy & visibility
  visibility: string, // enum: ['private', 'public_anonymous', 'public_with_name']
  allow_contact: boolean, // Can we contact reporter for more info?
  
  // Community voting (if made public)
  upvotes: number,
  upvoted_by: mongoose.Types.ObjectId[], // Users who think this is important
  
  created_at: Date,
  updated_at: Date,
  resolved_at?: Date,
  closed_at?: Date
}

/**
 * Indexes to consider:
 * - reporter_id
 * - type
 * - status
 * - priority
 * - created_at (for sorting by newest)
 * - Compound: type + status (for admin filtering)
 * - Compound: status + priority (for triage dashboards)
 */