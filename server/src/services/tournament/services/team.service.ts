import mongoose from 'mongoose';
import {
  Team,
  User,
  Game,
  Tournament,
  type IApexTeam
} from '../../../models';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { notificationHelper } from './notification.helper';

const logger = createLogger('team-service');


export class TeamService {
  // ============================================
  // CREATE TEAM
  // ============================================
  async create(userId: string, data: any): Promise<IApexTeam> {
    try {
      logger.info('Creating team', { userId, name: data.name });

      // 1. Validate required fields
      if (!data.name || !data.tag || !data.game_id) {
        throw new AppError(
          'TEAM_INVALID_NAME',
          'Name, tag, and game_id are required'
        );
      }

      // 2. Check if team name already exists for this game
      const existing = await Team.findOne({
        name: data.name,
        game_id: data.game_id,
        is_active: true
      });
      if (existing) {
        throw new AppError(
          'TEAM_ALREADY_EXISTS',
          'A team with this name already exists for this game'
        );
      }

      // 3. Get user's in-game ID for this game
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError('USER_NOT_FOUND', 'User not found');
      }

      const gameProfile = user.game_profiles?.find(
        gp => gp.game_id.toString() === data.game_id
      );
      if (!gameProfile) {
        throw new AppError(
          'INVALID_GAME_PROFILE',
          'You must have a game profile for this game to create a team'
        );
      }

      // 4. Create team with captain as first member
      const team = await Team.create({
        name: data.name,
        tag: data.tag.toUpperCase(),
        captain_id: new mongoose.Types.ObjectId(userId),
        game_id: new mongoose.Types.ObjectId(data.game_id),
        description: data.description,
        logo_url: data.logo_url || '',
        banner_url: data.banner_url,
        social_links: data.social_links,
        max_size: data.max_size || 10,
        min_size: data.min_size || 1,
        settings: {
          is_recruiting: data.is_recruiting ?? false,
          auto_accept_invites: data.auto_accept_invites ?? false,
          visibility: data.visibility || 'public'
        },
        region: data.region,
        members: [{
          user_id: new mongoose.Types.ObjectId(userId),
          in_game_id: gameProfile.in_game_id,
          role: 'captain',
          position: data.position,
          joined_at: new Date(),
          status: 'active'
        }],
        is_active: true
      });

      logger.info('Team created', { teamId: team._id });
      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Team creation failed', { error: error.message });
      throw new AppError(
        'TEAM_CREATE_FAILED',
        error.message || 'Failed to create team'
      );
    }
  }

  // ============================================
  // UPDATE TEAM (captain only)
  // ============================================
  async update(teamId: string, updates: any, userId: string): Promise<IApexTeam> {
    try {
      logger.info('Updating team', { teamId, userId });

      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      // Verify captain
      if (team.captain_id.toString() !== userId) {
        throw new AppError(
          'TEAM_MEMBER_UNAUTHORIZED',
          'Only the team captain can update the team'
        );
      }

      // If name is being updated, check uniqueness
      if (updates.name && updates.name !== team.name) {
        const existing = await Team.findOne({
          name: updates.name,
          game_id: team.game_id,
          _id: { $ne: teamId },
          is_active: true
        });
        if (existing) {
          throw new AppError(
            'TEAM_NAME_ALREADY_EXISTS',
            'A team with this name already exists for this game'
          );
        }
        team.name = updates.name;
      }

      if (updates.tag) {
        team.tag = updates.tag.toUpperCase();
      }
      if (updates.description !== undefined) team.description = updates.description;
      if (updates.logo_url !== undefined) team.logo_url = updates.logo_url;
      if (updates.banner_url !== undefined) team.banner_url = updates.banner_url;
      if (updates.social_links) team.social_links = { ...team.social_links, ...updates.social_links };
      if (updates.max_size) team.max_size = updates.max_size;
      if (updates.min_size) team.min_size = updates.min_size;
      if (updates.settings) team.settings = { ...team.settings, ...updates.settings };
      if (updates.region) team.region = updates.region;

      await team.save();
      logger.info('Team updated', { teamId });
      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Team update failed', { teamId, error: error.message });
      throw new AppError(
        'TEAM_UPDATE_FAILED',
        error.message || 'Failed to update team'
      );
    }
  }

  // ============================================
  // DELETE TEAM (disband)
  // ============================================
  async delete(teamId: string, userId: string): Promise<void> {
    try {
      logger.info('Deleting team', { teamId, userId });

      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      // Verify captain
      if (team.captain_id.toString() !== userId) {
        throw new AppError(
          'TEAM_MEMBER_UNAUTHORIZED',
          'Only the team captain can disband the team'
        );
      }

      // Optional: check if team has active tournament registrations
      // This would require checking Registrations collection
      // For now, we just soft delete
      team.is_active = false;
      team.disbanded_at = new Date();
      await team.save();

      logger.info('Team disbanded', { teamId });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Team deletion failed', { teamId, error: error.message });
      throw new AppError(
        'TEAM_DELETE_FAILED',
        error.message || 'Failed to disband team'
      );
    }
  }

  // ============================================
  // GET TEAM BY ID
  // ============================================
  async getById(teamId: string): Promise<IApexTeam> {
    try {
      const team = await Team.findById(teamId)
        .populate('captain_id', 'username profile.first_name profile.last_name profile.avatar_url')
        .populate('members.user_id', 'username profile.first_name profile.last_name profile.avatar_url')
        .populate('game_id', 'name slug logo_url');

      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Get team failed', { teamId, error: error.message });
      throw new AppError(
        'TEAM_FETCH_FAILED',
        error.message || 'Failed to fetch team'
      );
    }
  }

  // ============================================
  // LIST TEAMS
  // ============================================
  async list(filters: any = {}): Promise<IApexTeam[]> {
    try {
      const query: any = { is_active: true };

      if (filters.game_id) query.game_id = filters.game_id;
      if (filters.captain_id) query.captain_id = filters.captain_id;
      if (filters.region) query.region = filters.region;
      if (filters.is_recruiting !== undefined) {
        query['settings.is_recruiting'] = filters.is_recruiting;
      }
      if (filters.visibility) query['settings.visibility'] = filters.visibility;
      if (filters.search) {
        query.$or = [
          { name: { $regex: filters.search, $options: 'i' } },
          { tag: { $regex: filters.search, $options: 'i' } },
          { description: { $regex: filters.search, $options: 'i' } }
        ];
      }
      if (filters.member_user_id) {
        query['members.user_id'] = new mongoose.Types.ObjectId(filters.member_user_id);
      }

      const sort = filters.sort || { created_at: -1 };

      const teams = await Team.find(query)
        .sort(sort)
        .populate('game_id', 'name slug logo_url')
        .populate('captain_id', 'username profile.avatar_url');

      return teams;
    } catch (error: any) {
      logger.error('List teams failed', { error: error.message });
      throw new AppError(
        'TEAM_LIST_FAILED',
        error.message || 'Failed to list teams'
      );
    }
  }

  // ============================================
  // INVITE MEMBER
  // ============================================
  async inviteMember(teamId: string, captainId: string, userId: string): Promise<IApexTeam> {
    try {
      logger.info('Inviting member to team', { teamId, captainId, userId });

      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      // Verify captain
      if (team.captain_id.toString() !== captainId) {
        throw new AppError(
          'TEAM_MEMBER_UNAUTHORIZED',
          'Only the team captain can send invitations'
        );
      }

      // Check if user is already a member
      const isMember = team.members.some(m => m.user_id.toString() === userId && m.status === 'active');
      if (isMember) {
        throw new AppError(
          'USER_ALREADY_MEMBER',
          'User is already a member of this team'
        );
      }

      // Check if invitation already pending
      const hasPendingInvite = team.invitations.some(
        inv => inv.user_id.toString() === userId && inv.status === 'pending'
      );
      if (hasPendingInvite) {
        throw new AppError(
          'TEAM_INVITATION_ALREADY_INVITED',
          'User already has a pending invitation'
        );
      }

      // Check team capacity
      if (team.members.length >= team.max_size) {
        throw new AppError(
          'TEAM_CAPACITY_FULL',
          'Team has reached maximum member capacity'
        );
      }

      // Create invitation
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      team.invitations.push({
        user_id: new mongoose.Types.ObjectId(userId),
        invited_by: new mongoose.Types.ObjectId(captainId),
        invited_at: new Date(),
        expires_at: expiresAt,
        status: 'pending'
      });

      await team.save();

      // Send notification
      // await notificationHelper.notifyTeamInvite?.(userId, team).catch(err: any => {
      //   logger.error('Failed to send team invite notification', { userId, teamId, error: err.message });
      // });

      logger.info('Invitation sent', { teamId, userId });
      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Invite member failed', { teamId, userId, error: error.message });
      throw new AppError(
        'TEAM_MEMBER_INVITE_FAILED',
        error.message || 'Failed to invite member'
      );
    }
  }

  // ============================================
  // RESPOND TO INVITE
  // ============================================
  async respondToInvite(
    teamId: string,
    userId: string,
    accept: boolean
  ): Promise<IApexTeam> {
    try {
      logger.info('Responding to team invite', { teamId, userId, accept });

      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      // Find pending invitation
      const invitation = team.invitations.find(
        inv => inv.user_id.toString() === userId && inv.status === 'pending'
      );
      if (!invitation) {
        throw new AppError(
          'TEAM_PENDING_INVITE_NOT_FOUND',
          'No pending invitation found for this user'
        );
      }

      // Check if expired
      if (invitation.expires_at < new Date()) {
        invitation.status = 'expired';
        await team.save();
        throw new AppError(
          'TEAM_INVITATION_EXPIRED',
          'Invitation has expired'
        );
      }

      if (accept) {
        // Check if team still has capacity
        if (team.members.length >= team.max_size) {
          invitation.status = 'expired'; // or keep as pending? Mark expired.
          await team.save();
          throw new AppError(
            'TEAM_CAPACITY_FULL',
            'Team is now full, invitation cannot be accepted'
          );
        }

        // Add as member
        await this.addMember(teamId, userId, 'player');
        invitation.status = 'accepted';
      } else {
        invitation.status = 'declined';
      }

      await team.save();
      logger.info('Invite response processed', { teamId, userId, accept });
      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Respond to invite failed', { teamId, userId, error: error.message });
      throw new AppError(
        'TEAM_RESPOND_INVITE_FAILED',
        error.message || 'Failed to respond to invitation'
      );
    }
  }

  // ============================================
  // REQUEST TO JOIN
  // ============================================
  async requestJoin(teamId: string, userId: string, message?: string): Promise<IApexTeam> {
    try {
      logger.info('Requesting to join team', { teamId, userId });

      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      if (!team.settings.is_recruiting) {
        throw new AppError(
          'TEAM_JOIN_REQUEST_FAILED',
          'This team is not currently recruiting'
        );
      }

      // Check if already member
      const isMember = team.members.some(m => m.user_id.toString() === userId && m.status === 'active');
      if (isMember) {
        throw new AppError(
          'USER_ALREADY_MEMBER',
          'You are already a member of this team'
        );
      }

      // Check if already has pending request
      const hasPendingRequest = team.join_requests.some(
        req => req.user_id.toString() === userId && req.status === 'pending'
      );
      if (hasPendingRequest) {
        throw new AppError(
          'TEAM_MEMBERSHIP_ALREADY_REQUESTED',
          'You already have a pending join request'
        );
      }

      // Check capacity
      if (team.members.length >= team.max_size) {
        throw new AppError(
          'TEAM_CAPACITY_FULL',
          'Team has reached maximum member capacity'
        );
      }

      // Create join request
      team.join_requests.push({
        user_id: new mongoose.Types.ObjectId(userId),
        message: message || '',
        requested_at: new Date(),
        status: 'pending'
      });

      await team.save();

      // Notify captain
      // await notificationHelper.notifyTeamJoinRequest?.(team.captain_id.toString(), team, userId).catch(err => {
      //   logger.error('Failed to notify captain of join request', { teamId, captainId: team.captain_id, error: err.message });
      // });

      logger.info('Join request submitted', { teamId, userId });
      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Request join failed', { teamId, userId, error: error.message });
      throw new AppError(
        'TEAM_JOIN_REQUEST_FAILED',
        error.message || 'Failed to request join'
      );
    }
  }

  // ============================================
  // RESPOND TO JOIN REQUEST (captain)
  // ============================================
  async respondToJoinRequest(
    teamId: string,
    captainId: string,
    userId: string,
    approve: boolean
  ): Promise<IApexTeam> {
    try {
      logger.info('Responding to join request', { teamId, captainId, userId, approve });

      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      // Verify captain
      if (team.captain_id.toString() !== captainId) {
        throw new AppError(
          'TEAM_MEMBER_UNAUTHORIZED',
          'Only the team captain can respond to join requests'
        );
      }

      // Find pending request
      const request = team.join_requests.find(
        req => req.user_id.toString() === userId && req.status === 'pending'
      );
      if (!request) {
        throw new AppError(
          'TEAM_JOIN_REQUEST_NOT_FOUND',
          'No pending join request found for this user'
        );
      }

      if (approve) {
        // Check capacity
        if (team.members.length >= team.max_size) {
          request.status = 'declined'; // Can't accept because full
          await team.save();
          throw new AppError(
            'TEAM_CAPACITY_FULL',
            'Team is full, cannot accept request'
          );
        }

        // Add as member
        await this.addMember(teamId, userId, 'player');
        request.status = 'accepted';
        request.reviewed_by = new mongoose.Types.ObjectId(captainId);
        request.reviewed_at = new Date();
      } else {
        request.status = 'declined';
        request.reviewed_by = new mongoose.Types.ObjectId(captainId);
        request.reviewed_at = new Date();
      }

      await team.save();
      logger.info('Join request response processed', { teamId, userId, approve });
      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Respond to join request failed', { teamId, userId, error: error.message });
      throw new AppError(
        'TEAM_JOIN_REQUEST_FAILED',
        error.message || 'Failed to respond to join request'
      );
    }
  }

  // ============================================
  // ADD MEMBER (internal helper)
  // ============================================
  async addMember(
    teamId: string,
    userId: string,
    role: 'captain' | 'player' | 'substitute' = 'player'
  ): Promise<IApexTeam> {
    try {
      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      // Check if already member
      const existingMember = team.members.find(m => m.user_id.toString() === userId);
      if (existingMember) {
        if (existingMember.status === 'active') {
          throw new AppError(
            'USER_ALREADY_MEMBER',
            'User is already a member of this team'
          );
        } else {
          // Reactivate
          existingMember.status = 'active';
          existingMember.joined_at = new Date();
          existingMember.role = role;
          await team.save();
          return team;
        }
      }

      // Check capacity
      if (team.members.length >= team.max_size) {
        throw new AppError(
          'TEAM_CAPACITY_TEAM_FULL',
          'Team has reached maximum member capacity'
        );
      }

      // Get user's in-game ID for this team's game
      const user = await User.findById(userId);
      const gameProfile = user?.game_profiles?.find(
        gp => gp.game_id.toString() === team.game_id.toString()
      );
      if (!gameProfile) {
        throw new AppError(
          'TEAM_ADD_MEMBER_FAILED',
          'User does not have a game profile for this game'
        );
      }

      team.members.push({
        user_id: new mongoose.Types.ObjectId(userId),
        in_game_id: gameProfile.in_game_id,
        role,
        joined_at: new Date(),
        status: 'active'
      });

      await team.save();
      logger.info('Member added to team', { teamId, userId, role });
      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Add member failed', { teamId, userId, error: error.message });
      throw new AppError(
        'TEAM_ADD_MEMBER_FAILED',
        error.message || 'Failed to add member to team'
      );
    }
  }

  // ============================================
  // REMOVE MEMBER (kick or leave)
  // ============================================
  async removeMember(teamId: string, userId: string, removedBy: string): Promise<IApexTeam> {
    try {
      logger.info('Removing member from team', { teamId, userId, removedBy });

      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      const memberIndex = team.members.findIndex(m => m.user_id.toString() === userId);
      if (memberIndex === -1) {
        throw new AppError(
          'TEAM_MEMBER_NOT_FOUND',
          'User is not a member of this team'
        );
      }

      const member = team.members[memberIndex];

      // Authorization: captain can kick anyone, or user can leave themselves
      const isCaptain = team.captain_id.toString() === removedBy;
      const isSelf = userId === removedBy;

      if (!isCaptain && !isSelf) {
        throw new AppError(
          'TEAM_MEMBER_UNAUTHORIZED',
          'You are not authorized to remove this member'
        );
      }

      // Captain cannot leave without transferring ownership (or disbanding)
      if (member.role === 'captain' && !isCaptain) {
        throw new AppError(
          'TEAM_CAPTAIN_CANNOT_LEAVE',
          'Captain cannot leave; disband the team or transfer ownership first'
        );
      }

      // Soft remove: set status to kicked/inactive
      if (isSelf) {
        team.members[memberIndex].status = 'inactive'; // left
      } else {
        team.members[memberIndex].status = 'kicked'; // kicked
      }

      await team.save();
      logger.info('Member removed from team', { teamId, userId, removedBy });
      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Remove member failed', { teamId, userId, error: error.message });
      throw new AppError(
        'TEAM_REMOVE_MEMBER_FAILED',
        error.message || 'Failed to remove member'
      );
    }
  }

  // ============================================
  // UPDATE STATISTICS
  // ============================================
  async updateStats(teamId: string, matchResult: {
    won: boolean;
    tournaments_played?: boolean;
    prize_earned?: number;
  }): Promise<IApexTeam> {
    try {
      logger.info('Updating team statistics', { teamId, matchResult });

      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      if (matchResult.tournaments_played) {
        team.stats.tournaments_played += 1;
      }

      if (matchResult.won) {
        team.stats.tournaments_won += 1;
        team.stats.matches_won += 1;
      }

      team.stats.matches_played += 1;
      team.stats.total_earnings += matchResult.prize_earned || 0;
      
      // Recalculate win rate
      if (team.stats.matches_played > 0) {
        team.stats.win_rate = (team.stats.matches_won / team.stats.matches_played) * 100;
      }

      await team.save();
      logger.info('Team stats updated', { teamId });
      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Update stats failed', { teamId, error: error.message });
      throw new AppError(
        'TEAM_STATS_UPDATE_FAILED',
        error.message || 'Failed to update team statistics'
      );
    }
  }

  // ============================================
  // VERIFY TEAM SIZE FOR TOURNAMENT
  // ============================================
  async verifyTeamSize(teamId: string, tournamentFormat: string): Promise<{
    valid: boolean;
    currentSize: number;
    requiredMin?: number;
    requiredMax?: number;
    message?: string;
  }> {
    try {
      logger.info('Verifying team size', { teamId, tournamentFormat });

      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      // Parse format (e.g., '2v2', '3v3', '5v5')
      const match = tournamentFormat.match(/(\d+)v(\d+)/);
      if (!match) {
        // Assume solo or custom format
        return { valid: true, currentSize: team.members.length };
      }

      const requiredTeamSize = parseInt(match[1], 10);
      const activeMembers = team.members.filter(m => m.status === 'active').length;

      if (activeMembers < requiredTeamSize) {
        return {
          valid: false,
          currentSize: activeMembers,
          requiredMin: requiredTeamSize,
          requiredMax: requiredTeamSize,
          message: `Team needs at least ${requiredTeamSize} active members (currently ${activeMembers})`
        };
      }

      // Also check min/max from tournament requirements
      return {
        valid: true,
        currentSize: activeMembers,
        requiredMin: requiredTeamSize,
        requiredMax: requiredTeamSize
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Verify team size failed', { teamId, tournamentFormat, error: error.message });
      throw new AppError(
        'TEAM_VERIFY_SIZE_FAILED',
        error.message || 'Failed to verify team size'
      );
    }
  }

  // ============================================
  // TRANSFER OWNERSHIP (helper)
  // ============================================
  async transferOwnership(teamId: string, currentCaptainId: string, newCaptainId: string): Promise<IApexTeam> {
    try {
      logger.info('Transferring team ownership', { teamId, currentCaptainId, newCaptainId });

      const team = await Team.findById(teamId);
      if (!team) {
        throw new AppError('TEAM_NOT_FOUND', 'Team not found');
      }

      if (team.captain_id.toString() !== currentCaptainId) {
        throw new AppError(
          'TEAM_MEMBER_UNAUTHORIZED',
          'Only the current captain can transfer ownership'
        );
      }

      // Find new captain in members
      const newCaptainMember = team.members.find(m => m.user_id.toString() === newCaptainId && m.status === 'active');
      if (!newCaptainMember) {
        throw new AppError(
          'TEAM_ACTIVE_MEMBER_NOT_FOUND',
          'New captain must be an active member of the team'
        );
      }

      // Update roles
      const oldCaptainMember = team.members.find(m => m.user_id.toString() === currentCaptainId);
      if (oldCaptainMember) {
        oldCaptainMember.role = 'player';
      }
      newCaptainMember.role = 'captain';
      team.captain_id = new mongoose.Types.ObjectId(newCaptainId);

      await team.save();
      logger.info('Team ownership transferred', { teamId, newCaptainId });
      return team;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Transfer ownership failed', { teamId, error: error.message });
      throw new AppError(
        'TEAM_OWNERSHIP_TRANSFER_FAILED',
        error.message || 'Failed to transfer ownership'
      );
    }
  }
}

export const teamService = new TeamService();