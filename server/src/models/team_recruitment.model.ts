
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
  
  // Post details
  title: string,
  description: string,
  contact_method: string, // enum: ['platform_message', 'discord', 'whatsapp']
  contact_info: string,
  
  // Status
  status: string, // enum: ['open', 'filled', 'closed', 'expired']
  applicants: mongoose.Types.ObjectId[], // Users who applied
  
  created_at: Date,
  updated_at: Date,
  expires_at: Date // Auto-close after 30 days
}