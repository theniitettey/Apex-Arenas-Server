import mongoose, {Document, Schema} from "mongoose";

export interface IApexTeamRecruitment extends Document {
  _id: mongoose.Types.ObjectId,
  
  // Who's posting
  posted_by: mongoose.Types.ObjectId, // User ID
  posting_as: string, // enum: ['player_looking_for_team', 'team_looking_for_player']
  
  // If team is looking for player
  team_id?: mongoose.Types.ObjectId,
  
  // Game & role specifics
  game_id: mongoose.Types.ObjectId,
  looking_for_roles: string[], // ['captain', 'support', 'fragger', 'flex']
  looking_for_skill_level: string, // enum: ['beginner', 'intermediate', 'advanced', 'pro']
  
  // Availability
  availability: {
    days: string[], // ['mon', 'tue', 'wed', ...]
    timezone: string,
    hours_per_week: number
  },
  
  // Requirements
  minimum_age?: number,
  microphone_required: boolean,
  language_requirements: string[],
  region?: string, // e.g., 'GH', 'NG', 'KE'
  
  // Post details
  title: string,
  description: string,
  contact_method: string, // enum: ['platform_message', 'discord', 'whatsapp']
  contact_info: string,
  
  // Status
  status: string, // enum: ['open', 'filled', 'closed', 'expired']
  applicants: mongoose.Types.ObjectId[], // Users who applied
  applicant_count: number,
  
  // Views for analytics
  views: number,
  
  created_at: Date,
  updated_at: Date,
  expires_at: Date // Auto-close after 30 days
}

const ApexTeamRecruitmentSchema = new Schema<IApexTeamRecruitment>({
  posted_by: { type: Schema.Types.ObjectId, ref: 'ApexUser', required: true },
  posting_as: { 
    type: String, 
    enum: ['player_looking_for_team', 'team_looking_for_player'],
    required: true 
  },
  
  team_id: { type: Schema.Types.ObjectId, ref: 'Team' },
  
  game_id: { type: Schema.Types.ObjectId, ref: 'Game', required: true },
  looking_for_roles: [{ type: String }],
  looking_for_skill_level: { 
    type: String, 
    enum: ['beginner', 'intermediate', 'advanced', 'pro', 'any'],
    default: 'any' 
  },
  
  availability: {
    days: [{ 
      type: String, 
      enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] 
    }],
    timezone: { type: String, default: 'Africa/Accra' },
    hours_per_week: { type: Number, min: 0, max: 168 }
  },
  
  minimum_age: { type: Number, min: 13 },
  microphone_required: { type: Boolean, default: false },
  language_requirements: [{ type: String }],
  region: { type: String },
  
  title: { type: String, required: true, maxlength: 100 },
  description: { type: String, required: true, maxlength: 2000 },
  contact_method: { 
    type: String, 
    enum: ['platform_message', 'discord', 'whatsapp'],
    default: 'platform_message' 
  },
  contact_info: { type: String, maxlength: 100 },
  
  status: { 
    type: String, 
    enum: ['open', 'filled', 'closed', 'expired'],
    default: 'open' 
  },
  applicants: [{ type: Schema.Types.ObjectId, ref: 'ApexUser' }],
  applicant_count: { type: Number, default: 0 },
  
  views: { type: Number, default: 0 },
  
  expires_at: { type: Date, required: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
ApexTeamRecruitmentSchema.index({ posted_by: 1 });
ApexTeamRecruitmentSchema.index({ game_id: 1 });
ApexTeamRecruitmentSchema.index({ status: 1 });
ApexTeamRecruitmentSchema.index({ posting_as: 1 });
ApexTeamRecruitmentSchema.index({ expires_at: 1 });
ApexTeamRecruitmentSchema.index({ region: 1 });
ApexTeamRecruitmentSchema.index({ game_id: 1, status: 1, posting_as: 1 });
ApexTeamRecruitmentSchema.index({ game_id: 1, status: 1, region: 1, created_at: -1 });


export const TeamRecruitment = mongoose.model<IApexTeamRecruitment>('ApexTeamRecruitment', ApexTeamRecruitmentSchema);