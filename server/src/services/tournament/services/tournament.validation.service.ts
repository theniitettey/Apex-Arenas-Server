/**
 * validateCanRegister(tournamentId, userId) - All registration checks
validateCanCancel(tournamentId) - Check cancellation rules
validateCanUpdate(tournament, updates) - Check what's updatable
validateCanStartCheckIn(tournament) - Check-in window rules
validateCanGenerateBracket(tournament) - Bracket generation rules
validatePrizeDistribution(distribution) - Sum to 100%, valid positions
validateSchedule(schedule) - Dates are logical
 */

// file: tournament.validation.service.ts

import {
  Tournament,
  Registration,
  User,
  Game,
  type IApexTournament,
} from '../../../models';
import { createLogger } from '../../../shared/utils/logger.utils';
import { AppError } from '../../../shared/utils/error.utils';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

const logger = createLogger('tournament-validation-service');

// Define valid tournament types and formats
const VALID_TOURNAMENT_TYPES = ['single_elimination', 'double_elimination', 'round_robin', 'swiss', 'battle_royale'];
const VALID_FORMATS = ['1v1', '2v2', '3v3', '4v4', '5v5', 'squad', 'solo'];
const VALID_VISIBILITIES = ['public', 'private', 'invite_only'];

export class TournamentValidationService {
  // ============================================
  // CREATE VALIDATION (Input validation for new tournaments)
  // ============================================
  async validateCreate(data: any): Promise<any> {
    try {
      logger.info('Validating tournament create data');

      const errors: string[] = [];

      // 1. Required fields
      if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
        errors.push('Title is required');
      } else if (data.title.length > 100) {
        errors.push('Title must be 100 characters or less');
      }

      if (!data.game_id) {
        errors.push('Game ID is required');
      } else {
        // Verify game exists and is active
        const game = await Game.findById(data.game_id);
        if (!game) {
          errors.push('Game not found');
        } else if (!game.is_active) {
          errors.push('Selected game is not currently active');
        }
      }

      // 2. Tournament type validation
      if (!data.tournament_type) {
        errors.push('Tournament type is required');
      } else if (!VALID_TOURNAMENT_TYPES.includes(data.tournament_type)) {
        errors.push(`Invalid tournament type. Valid options: ${VALID_TOURNAMENT_TYPES.join(', ')}`);
      }

      // 3. Format validation
      if (!data.format) {
        errors.push('Format is required');
      } else if (!VALID_FORMATS.includes(data.format)) {
        errors.push(`Invalid format. Valid options: ${VALID_FORMATS.join(', ')}`);
      }

      // 4. Schedule validation
      if (!data.schedule) {
        errors.push('Schedule is required');
      } else {
        if (!data.schedule.registration_start) {
          errors.push('Registration start date is required');
        }
        if (!data.schedule.registration_end) {
          errors.push('Registration end date is required');
        }
        if (!data.schedule.tournament_start) {
          errors.push('Tournament start date is required');
        }

        // Validate schedule logic if all dates provided
        if (data.schedule.registration_start && data.schedule.registration_end && data.schedule.tournament_start) {
          try {
            this.validateSchedule(data.schedule);
          } catch (scheduleError: any) {
            errors.push(scheduleError.message);
          }
        }
      }

      // 5. Capacity validation
      if (!data.capacity) {
        errors.push('Capacity configuration is required');
      } else {
        if (!data.capacity.max_participants || data.capacity.max_participants < 2) {
          errors.push('Maximum participants must be at least 2');
        }
        if (data.capacity.min_participants !== undefined && data.capacity.min_participants < 2) {
          errors.push('Minimum participants must be at least 2');
        }
        if (data.capacity.min_participants > data.capacity.max_participants) {
          errors.push('Minimum participants cannot exceed maximum participants');
        }
      }

      // 6. Entry fee validation
      if (data.entry_fee !== undefined) {
        if (typeof data.entry_fee !== 'number' || data.entry_fee < 0) {
          errors.push('Entry fee must be a non-negative number');
        }
      }

      // 7. Prize structure validation (required for paid tournaments)
      if (data.entry_fee > 0 || (data.prize_structure?.organizer_gross_deposit > 0)) {
        if (!data.prize_structure) {
          errors.push('Prize structure is required for paid tournaments');
        } else {
          if (!data.prize_structure.organizer_gross_deposit || data.prize_structure.organizer_gross_deposit <= 0) {
            errors.push('Organizer gross deposit is required for paid tournaments');
          }
          if (!data.prize_structure.distribution || data.prize_structure.distribution.length === 0) {
            errors.push('Prize distribution is required for paid tournaments');
          } else {
            try {
              this.validatePrizeDistribution(data.prize_structure.distribution);
            } catch (prizeError: any) {
              errors.push(prizeError.message);
            }
          }
        }
      }

      // 8. Visibility validation
      if (data.visibility && !VALID_VISIBILITIES.includes(data.visibility)) {
        errors.push(`Invalid visibility. Valid options: ${VALID_VISIBILITIES.join(', ')}`);
      }

      // 9. Description length validation
      if (data.description && data.description.length > 2000) {
        errors.push('Description must be 2000 characters or less');
      }

      // 10. Rules validation
      if (data.rules) {
        if (data.rules.description && data.rules.description.length > 5000) {
          errors.push('Rules description must be 5000 characters or less');
        }
      }

      // 11. Requirements validation
      if (data.requirements) {
        if (data.requirements.min_age !== undefined && (data.requirements.min_age < 0 || data.requirements.min_age > 100)) {
          errors.push('Minimum age must be between 0 and 100');
        }
        if (data.requirements.max_age !== undefined && (data.requirements.max_age < 0 || data.requirements.max_age > 100)) {
          errors.push('Maximum age must be between 0 and 100');
        }
        if (data.requirements.min_age && data.requirements.max_age && data.requirements.min_age > data.requirements.max_age) {
          errors.push('Minimum age cannot exceed maximum age');
        }
        if (data.requirements.team_size !== undefined) {
          if (data.requirements.team_size < 1 || data.requirements.team_size > 100) {
            errors.push('Team size must be between 1 and 100');
          }
        }
      }

      // Throw if errors exist
      if (errors.length > 0) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, errors.join('; '));
      }

      // Return sanitized/validated data
      const validated = {
        title: data.title.trim(),
        description: data.description?.trim() || '',
        game_id: data.game_id,
        tournament_type: data.tournament_type,
        format: data.format,
        schedule: {
          registration_start: new Date(data.schedule.registration_start),
          registration_end: new Date(data.schedule.registration_end),
          tournament_start: new Date(data.schedule.tournament_start),
          tournament_end: data.schedule.tournament_end ? new Date(data.schedule.tournament_end) : undefined,
          check_in_start: data.schedule.check_in_start ? new Date(data.schedule.check_in_start) : undefined,
          check_in_end: data.schedule.check_in_end ? new Date(data.schedule.check_in_end) : undefined,
        },
        capacity: {
          min_participants: data.capacity.min_participants || 2,
          max_participants: data.capacity.max_participants,
          waitlist_enabled: data.capacity.waitlist_enabled || false,
        },
        entry_fee: data.entry_fee || 0,
        currency: data.currency || 'GHS',
        prize_structure: data.prize_structure || undefined,
        rules: data.rules || {},
        visibility: data.visibility || 'public',
        region: data.region || 'GH',
        thumbnail_url: data.thumbnail_url || '',
        banner_url: data.banner_url || '',
        communication: data.communication || {},
        requirements: data.requirements || {},
        timezone: data.timezone || 'Africa/Accra',
      };

      logger.info('Tournament create validation passed');
      return validated;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Tournament create validation failed', { error: error.message });
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message || 'Create validation failed');
    }
  }

  // ============================================
  // UPDATE VALIDATION (Input validation for updates)
  // ============================================
  async validateUpdate(updates: any): Promise<any> {
    try {
      logger.info('Validating tournament update data');

      const errors: string[] = [];
      const validated: any = {};

      // Validate each field if provided
      if (updates.title !== undefined) {
        if (typeof updates.title !== 'string' || updates.title.trim().length === 0) {
          errors.push('Title cannot be empty');
        } else if (updates.title.length > 100) {
          errors.push('Title must be 100 characters or less');
        } else {
          validated.title = updates.title.trim();
        }
      }

      if (updates.description !== undefined) {
        if (updates.description.length > 2000) {
          errors.push('Description must be 2000 characters or less');
        } else {
          validated.description = updates.description.trim();
        }
      }

      if (updates.game_id !== undefined) {
        const game = await Game.findById(updates.game_id);
        if (!game) {
          errors.push('Game not found');
        } else if (!game.is_active) {
          errors.push('Selected game is not currently active');
        } else {
          validated.game_id = updates.game_id;
        }
      }

      if (updates.tournament_type !== undefined) {
        if (!VALID_TOURNAMENT_TYPES.includes(updates.tournament_type)) {
          errors.push(`Invalid tournament type. Valid options: ${VALID_TOURNAMENT_TYPES.join(', ')}`);
        } else {
          validated.tournament_type = updates.tournament_type;
        }
      }

      if (updates.format !== undefined) {
        if (!VALID_FORMATS.includes(updates.format)) {
          errors.push(`Invalid format. Valid options: ${VALID_FORMATS.join(', ')}`);
        } else {
          validated.format = updates.format;
        }
      }

      if (updates.schedule !== undefined) {
        validated.schedule = {};
        if (updates.schedule.registration_start) {
          validated.schedule.registration_start = new Date(updates.schedule.registration_start);
        }
        if (updates.schedule.registration_end) {
          validated.schedule.registration_end = new Date(updates.schedule.registration_end);
        }
        if (updates.schedule.tournament_start) {
          validated.schedule.tournament_start = new Date(updates.schedule.tournament_start);
        }
        if (updates.schedule.tournament_end) {
          validated.schedule.tournament_end = new Date(updates.schedule.tournament_end);
        }
        if (updates.schedule.check_in_start) {
          validated.schedule.check_in_start = new Date(updates.schedule.check_in_start);
        }
        if (updates.schedule.check_in_end) {
          validated.schedule.check_in_end = new Date(updates.schedule.check_in_end);
        }
      }

      if (updates.capacity !== undefined) {
        validated.capacity = {};
        if (updates.capacity.max_participants !== undefined) {
          if (updates.capacity.max_participants < 2) {
            errors.push('Maximum participants must be at least 2');
          } else {
            validated.capacity.max_participants = updates.capacity.max_participants;
          }
        }
        if (updates.capacity.min_participants !== undefined) {
          if (updates.capacity.min_participants < 2) {
            errors.push('Minimum participants must be at least 2');
          } else {
            validated.capacity.min_participants = updates.capacity.min_participants;
          }
        }
        if (updates.capacity.waitlist_enabled !== undefined) {
          validated.capacity.waitlist_enabled = updates.capacity.waitlist_enabled;
        }
      }

      if (updates.entry_fee !== undefined) {
        if (typeof updates.entry_fee !== 'number' || updates.entry_fee < 0) {
          errors.push('Entry fee must be a non-negative number');
        } else {
          validated.entry_fee = updates.entry_fee;
        }
      }

      if (updates.prize_structure !== undefined) {
        validated.prize_structure = updates.prize_structure;
        if (updates.prize_structure.distribution) {
          try {
            this.validatePrizeDistribution(updates.prize_structure.distribution);
          } catch (prizeError: any) {
            errors.push(prizeError.message);
          }
        }
      }

      if (updates.visibility !== undefined) {
        if (!VALID_VISIBILITIES.includes(updates.visibility)) {
          errors.push(`Invalid visibility. Valid options: ${VALID_VISIBILITIES.join(', ')}`);
        } else {
          validated.visibility = updates.visibility;
        }
      }

      if (updates.rules !== undefined) {
        validated.rules = updates.rules;
      }

      if (updates.communication !== undefined) {
        validated.communication = updates.communication;
      }

      if (updates.requirements !== undefined) {
        validated.requirements = updates.requirements;
      }

      if (updates.thumbnail_url !== undefined) {
        validated.thumbnail_url = updates.thumbnail_url;
      }

      if (updates.banner_url !== undefined) {
        validated.banner_url = updates.banner_url;
      }

      if (updates.region !== undefined) {
        validated.region = updates.region;
      }

      if (updates.timezone !== undefined) {
        validated.timezone = updates.timezone;
      }

      // Throw if errors exist
      if (errors.length > 0) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, errors.join('; '));
      }

      logger.info('Tournament update validation passed');
      return validated;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Tournament update validation failed', { error: error.message });
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message || 'Update validation failed');
    }
  }

  // ============================================
  // PUBLISH VALIDATION (Enhanced)
  // ============================================
  async validatePublish(tournament: IApexTournament): Promise<void> {
    try {
      logger.info('Validating tournament for publish', { tournamentId: tournament._id });

      const errors: string[] = [];

      // 1. Status check
      if (tournament.status !== 'draft') {
        throw new AppError(
          ERROR_CODES.INVALID_STATUS,
          `Only draft tournaments can be published, current: ${tournament.status}`
        );
      }

      // 2. Required fields check
      if (!tournament.title || tournament.title.trim().length === 0) {
        errors.push('Title is required');
      }

      if (!tournament.game_id) {
        errors.push('Game must be selected');
      }

      if (!tournament.tournament_type) {
        errors.push('Tournament type is required');
      }

      if (!tournament.format) {
        errors.push('Format is required');
      }

      // 3. Schedule validation
      const now = new Date();
      if (!tournament.schedule.registration_start) {
        errors.push('Registration start date is required');
      } else if (tournament.schedule.registration_start <= now) {
        errors.push('Registration start must be in the future');
      }

      if (!tournament.schedule.registration_end) {
        errors.push('Registration end date is required');
      }

      if (!tournament.schedule.tournament_start) {
        errors.push('Tournament start date is required');
      }

      // Validate full schedule if all dates present
      if (tournament.schedule.registration_start && tournament.schedule.registration_end && tournament.schedule.tournament_start) {
        try {
          this.validateSchedule(tournament.schedule);
        } catch (scheduleError: any) {
          errors.push(scheduleError.message);
        }
      }

      // 4. Capacity validation
      if (!tournament.capacity.max_participants || tournament.capacity.max_participants < 2) {
        errors.push('Maximum participants must be at least 2');
      }

      if (tournament.capacity.min_participants <= 0) {
        errors.push('Minimum participants must be greater than 0');
      }

      // 5. Prize structure validation for paid tournaments
      if (!tournament.is_free && tournament.entry_fee > 0) {
        if (!tournament.prize_structure?.distribution?.length) {
          errors.push('Prize distribution must be defined for paid tournaments');
        } else {
          try {
            this.validatePrizeDistribution(tournament.prize_structure.distribution);
          } catch (prizeError: any) {
            errors.push(prizeError.message);
          }
        }

        if (!tournament.prize_structure?.organizer_gross_deposit || tournament.prize_structure.organizer_gross_deposit <= 0) {
          errors.push('Organizer deposit amount is required for paid tournaments');
        }
      }

      // 6. Game validation
      const game = await Game.findById(tournament.game_id);
      if (!game) {
        errors.push('Selected game not found');
      } else if (!game.is_active) {
        errors.push('Selected game is not currently active');
      }

      // 7. Team tournament validation
      if (tournament.format !== '1v1' && tournament.format !== 'solo') {
        if (!tournament.requirements?.team_size) {
          errors.push('Team size must be specified for team tournaments');
        }
      }

      // Throw if errors exist
      if (errors.length > 0) {
        throw new AppError(ERROR_CODES.PUBLISH_VALIDATION_FAILED, errors.join('; '));
      }

      logger.info('Publish validation passed', { tournamentId: tournament._id });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Publish validation failed', { tournamentId: tournament._id, error: error.message });
      throw new AppError(
        ERROR_CODES.PUBLISH_VALIDATION_FAILED,
        error.message || 'Publish validation failed'
      );
    }
  }

  // ============================================
  // REGISTRATION VALIDATION
  // ============================================
  async validateCanRegister(tournamentId: string, userId: string): Promise<void> {
    try {
      logger.info('Validating tournament registration', { tournamentId, userId });

      // 1. Fetch tournament
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Tournament not found');
      }

      // 2. Status check – only 'open' allows registration
      if (tournament.status !== 'open') {
        throw new AppError(
          ERROR_CODES.REGISTRATION_CLOSED,
          `Registration is only allowed when tournament is open, current status: ${tournament.status}`
        );
      }

      // 3. Date check – within registration window
      const now = new Date();
      if (now < tournament.schedule.registration_start) {
        throw new AppError(
          ERROR_CODES.REGISTRATION_NOT_STARTED,
          'Registration has not started yet'
        );
      }
      if (now > tournament.schedule.registration_end) {
        throw new AppError(
          ERROR_CODES.REGISTRATION_ENDED,
          'Registration window has ended'
        );
      }

      // 4. Capacity check (including waitlist)
      const currentParticipants = tournament.capacity.current_participants || 0;
      const maxParticipants = tournament.capacity.max_participants;
      const waitlistEnabled = tournament.capacity.waitlist_enabled;

      if (currentParticipants >= maxParticipants) {
        if (!waitlistEnabled) {
          throw new AppError(
            ERROR_CODES.TOURNAMENT_FULL,
            'Tournament is full and waitlist is disabled'
          );
        }
        // If waitlist enabled, we still allow registration – it will go to waitlist
        // But we might want to check waitlist capacity? Usually unlimited.
        logger.info('Tournament full, registration will be added to waitlist', { tournamentId });
      }

      // 5. Duplicate registration check
      const existingRegistration = await Registration.findOne({
        tournament_id: tournamentId,
        user_id: userId,
        status: { $in: ['pending_payment', 'registered', 'checked_in'] },
      });

      if (existingRegistration) {
        throw new AppError(
          ERROR_CODES.ALREADY_REGISTERED,
          'User is already registered for this tournament'
        );
      }

      // 6. User eligibility checks (age, region, skill level)
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError(ERROR_CODES.USER_NOT_FOUND, 'User not found');
      }

      // Age verification
      if (tournament.requirements?.min_age || tournament.requirements?.max_age) {
        if (!user.profile?.date_of_birth) {
          throw new AppError(
            ERROR_CODES.USER_PROFILE_INCOMPLETE,
            'Date of birth is required for age verification'
          );
        }
        const age = this.calculateAge(user.profile.date_of_birth);
        if (tournament.requirements.min_age && age < tournament.requirements.min_age) {
          throw new AppError(
            ERROR_CODES.AGE_RESTRICTION,
            `Minimum age requirement: ${tournament.requirements.min_age}`
          );
        }
        if (tournament.requirements.max_age && age > tournament.requirements.max_age) {
          throw new AppError(
            ERROR_CODES.AGE_RESTRICTION,
            `Maximum age requirement: ${tournament.requirements.max_age}`
          );
        }
      }

      // Region restriction
      if (
        tournament.requirements?.allowed_regions &&
        tournament.requirements.allowed_regions.length > 0
      ) {
        const userCountry = user.profile?.country;
        if (!userCountry || !tournament.requirements.allowed_regions.includes(userCountry)) {
          throw new AppError(
            ERROR_CODES.REGION_RESTRICTION,
            `Your region (${userCountry}) is not allowed for this tournament`
          );
        }
      }

      // Skill level restriction
      if (
        tournament.requirements?.required_skill_levels &&
        tournament.requirements.required_skill_levels.length > 0
      ) {
        // Find user's game profile for this tournament's game
        const gameProfile = user.game_profiles?.find(
          (gp) => gp.game_id.toString() === tournament.game_id.toString()
        );
        if (!gameProfile) {
          throw new AppError(
            ERROR_CODES.GAME_PROFILE_REQUIRED,
            'You must create a game profile for this game before registering'
          );
        }
        if (
          !tournament.requirements.required_skill_levels.includes(gameProfile.skill_level || '')
        ) {
          throw new AppError(
            ERROR_CODES.SKILL_LEVEL_RESTRICTION,
            `Your skill level (${gameProfile.skill_level}) does not meet tournament requirements`
          );
        }
      }

      // 7. In-game ID verification (if required)
      if (tournament.rules?.in_game_id_required) {
        const gameProfile = user.game_profiles?.find(
          (gp) => gp.game_id.toString() === tournament.game_id.toString()
        );
        if (!gameProfile) {
          throw new AppError(
            ERROR_CODES.GAME_PROFILE_REQUIRED,
            'In-game ID is required for this tournament'
          );
        }
        if (!gameProfile.in_game_id) {
          throw new AppError(
            ERROR_CODES.IN_GAME_ID_MISSING,
            'In-game ID is not set in your profile for this game'
          );
        }
        // Optional: verify format using game config
        const game = await Game.findById(tournament.game_id);
        if (game?.in_game_id_config?.format) {
          const regex = new RegExp(game.in_game_id_config.format);
          if (!regex.test(gameProfile.in_game_id)) {
            throw new AppError(
              ERROR_CODES.IN_GAME_ID_INVALID,
              `In-game ID format should match: ${game.in_game_id_config.format_description || game.in_game_id_config.format}`
            );
          }
        }
      }

      // 8. Team size validation (for team tournaments)
      if (tournament.format?.includes('v') && tournament.format !== '1v1') {
        // This is a team tournament – check team registration logic
        // Since registration service handles team flow, we just check if user is in a valid team
        // This part is better placed in registration service, but we can do a basic check:
        if (!tournament.requirements?.team_size) {
          throw new AppError(
            ERROR_CODES.TEAM_SIZE_NOT_DEFINED,
            'Tournament organizer did not specify team size'
          );
        }
        // User must be a member of a team for this game, with enough members
        // This is more complex – we'll assume it's handled in registration service
        // For validation service we skip detailed team checks
      }

      logger.info('Registration validation passed', { tournamentId, userId });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Registration validation failed', { tournamentId, userId, error: error.message });
      throw new AppError(
        ERROR_CODES.REGISTRATION_VALIDATION_FAILED,
        error.message || 'Registration validation failed'
      );
    }
  }

  // ============================================
  // CANCELLATION VALIDATION
  // ============================================
  async validateCanCancel(tournament: IApexTournament): Promise<void> {
    try {
      logger.info('Validating tournament cancellation', { tournamentId: tournament._id });

      // 1. Status check – cannot cancel if already completed or cancelled
      const nonCancellableStatuses = ['completed', 'cancelled', 'verifying_results', 'distributing_prizes'];
      if (nonCancellableStatuses.includes(tournament.status)) {
        throw new AppError(
          ERROR_CODES.INVALID_STATUS,
          `Cannot cancel tournament with status: ${tournament.status}`
        );
      }

      // 2. Cancellation cutoff check – if past cutoff, cancellation is not allowed
      const now = new Date();
      if (tournament.schedule.cancellation_cutoff && now > tournament.schedule.cancellation_cutoff) {
        throw new AppError(
          ERROR_CODES.CANCELLATION_WINDOW_CLOSED,
          'Cancellation window has closed (24 hours before tournament start)'
        );
      }

      // 3. Additional rule: if tournament is free, cancellation always allowed (no financial impact)
      if (tournament.is_free) {
        logger.info('Free tournament – cancellation allowed', { tournamentId: tournament._id });
        return;
      }

      // 4. For paid tournaments, check if any payments have been processed to escrow?
      // Usually cancellation is allowed as long as we can issue refunds.
      // If tournament status is 'awaiting_deposit', organizer hasn't paid yet – no problem.
      // If status is 'open' or 'locked', we can still cancel and refund.
      // We don't block based on payments; refunds will be handled.

      logger.info('Cancellation validation passed', { tournamentId: tournament._id });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Cancellation validation failed', { tournamentId: tournament._id, error: error.message });
      throw new AppError(
        ERROR_CODES.CANCELLATION_VALIDATION_FAILED,
        error.message || 'Cancellation validation failed'
      );
    }
  }

  // ============================================
  // UPDATE VALIDATION
  // ============================================
  async validateCanUpdate(tournament: IApexTournament, updates: any): Promise<void> {
    try {
      logger.info('Validating tournament update', { tournamentId: tournament._id, updates: Object.keys(updates) });

      // Define which fields are updatable in each status
      const updatableFields: Record<string, string[]> = {
        draft: [
          'title', 'description', 'game_id', 'tournament_type', 'format', 'schedule',
          'capacity', 'entry_fee', 'prize_structure', 'rules', 'visibility', 'region',
          'thumbnail_url', 'banner_url', 'communication', 'requirements', 'timezone'
        ],
        awaiting_deposit: [
          'description', 'communication', 'thumbnail_url', 'banner_url',
          'rules.description', 'rules.map_pool', 'rules.game_mode',
          'prize_structure.distribution' // can adjust prize breakdown as long as deposit not made?
        ],
        open: [
          'description', 'communication', 'thumbnail_url', 'banner_url',
          'rules.description', 'rules.map_pool', 'rules.game_mode'
        ],
        locked: [
          'description', 'communication' // only minor info
        ],
        ready_to_start: [], // no updates allowed
        ongoing: [],        // no updates allowed
        awaiting_results: [], // no updates allowed
        verifying_results: [], // no updates allowed
        completed: [],      // no updates allowed
        cancelled: [],      // no updates allowed
      };

      const allowed = updatableFields[tournament.status] || [];
      const forbiddenUpdates = Object.keys(updates).filter(
        (field) => !allowed.includes(field) && !field.startsWith('prize_structure.distribution')
      );

      if (forbiddenUpdates.length > 0) {
        throw new AppError(
          ERROR_CODES.UPDATE_NOT_ALLOWED,
          `Fields cannot be updated in status ${tournament.status}: ${forbiddenUpdates.join(', ')}`
        );
      }

      // Special validations for specific fields
      if (updates.schedule) {
        // If schedule changes, re-validate date logic
        this.validateSchedule({ ...tournament.schedule, ...updates.schedule });
      }

      if (updates.capacity?.max_participants) {
        // Cannot reduce max participants below current registrations
        if (updates.capacity.max_participants < tournament.capacity.current_participants) {
          throw new AppError(
            ERROR_CODES.CAPACITY_TOO_LOW,
            `Cannot reduce max participants below current registrations (${tournament.capacity.current_participants})`
          );
        }
      }

      if (updates.entry_fee !== undefined) {
        // Cannot change entry fee from 0 to >0 or vice versa after payments started
        if (tournament.status !== 'draft' && tournament.status !== 'awaiting_deposit') {
          if (tournament.entry_fee !== updates.entry_fee) {
            throw new AppError(
              ERROR_CODES.ENTRY_FEE_CHANGE_NOT_ALLOWED,
              'Entry fee cannot be changed after tournament is open'
            );
          }
        }
      }

      logger.info('Update validation passed', { tournamentId: tournament._id });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Update validation failed', { tournamentId: tournament._id, error: error.message });
      throw new AppError(
        ERROR_CODES.UPDATE_VALIDATION_FAILED,
        error.message || 'Update validation failed'
      );
    }
  }

  // ============================================
  // CHECK-IN VALIDATION
  // ============================================
  async validateCanStartCheckIn(tournament: IApexTournament): Promise<void> {
    try {
      logger.info('Validating check-in start', { tournamentId: tournament._id });

      // 1. Status must be 'open' or 'locked'
      if (!['open', 'locked'].includes(tournament.status)) {
        throw new AppError(
          ERROR_CODES.INVALID_STATUS,
          `Check-in can only be started when tournament is open or locked, current: ${tournament.status}`
        );
      }

      // 2. Check-in window must be defined
      if (!tournament.schedule.check_in_start || !tournament.schedule.check_in_end) {
        throw new AppError(
          ERROR_CODES.CHECK_IN_WINDOW_NOT_DEFINED,
          'Check-in start and end times must be defined'
        );
      }

      // 3. Current time must be within check-in window
      const now = new Date();
      if (now < tournament.schedule.check_in_start) {
        throw new AppError(
          ERROR_CODES.CHECK_IN_NOT_STARTED,
          'Check-in has not started yet'
        );
      }
      if (now > tournament.schedule.check_in_end) {
        throw new AppError(
          ERROR_CODES.CHECK_IN_ENDED,
          'Check-in window has ended'
        );
      }

      // 4. Minimum participants check (optional, but good practice)
      if (tournament.capacity.current_participants < tournament.capacity.min_participants) {
        throw new AppError(
          ERROR_CODES.INSUFFICIENT_PARTICIPANTS,
          `Cannot start check-in: minimum participants required: ${tournament.capacity.min_participants}, current: ${tournament.capacity.current_participants}`
        );
      }

      logger.info('Check-in validation passed', { tournamentId: tournament._id });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Check-in validation failed', { tournamentId: tournament._id, error: error.message });
      throw new AppError(
        ERROR_CODES.CHECK_IN_VALIDATION_FAILED,
        error.message || 'Check-in validation failed'
      );
    }
  }

  // ============================================
  // BRACKET GENERATION VALIDATION
  // ============================================
  async validateCanGenerateBracket(tournament: IApexTournament): Promise<void> {
    try {
      logger.info('Validating bracket generation', { tournamentId: tournament._id });

      // 1. Status must be 'ready_to_start' or 'ongoing' (if regenerating)
      if (!['ready_to_start', 'ongoing'].includes(tournament.status)) {
        throw new AppError(
          ERROR_CODES.INVALID_STATUS,
          `Bracket can only be generated when tournament is ready_to_start or ongoing, current: ${tournament.status}`
        );
      }

      // 2. Bracket not already generated (unless regeneration is explicitly allowed)
      if (tournament.bracket?.generated && tournament.status === 'ready_to_start') {
        throw new AppError(
          ERROR_CODES.BRACKET_ALREADY_GENERATED,
          'Bracket has already been generated for this tournament'
        );
      }

      // 3. Sufficient participants
      if (tournament.capacity.current_participants < tournament.capacity.min_participants) {
        throw new AppError(
          ERROR_CODES.INSUFFICIENT_PARTICIPANTS,
          `Cannot generate bracket: minimum participants required: ${tournament.capacity.min_participants}, current: ${tournament.capacity.current_participants}`
        );
      }

      // 4. Check-in completed? Usually bracket generation happens after check-in closes.
      // We can check if at least minimum checked-in, but we'll leave that to the caller.

      // 5. Tournament type compatibility – all tournament types are valid

      logger.info('Bracket generation validation passed', { tournamentId: tournament._id });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Bracket generation validation failed', { tournamentId: tournament._id, error: error.message });
      throw new AppError(
        ERROR_CODES.BRACKET_GENERATION_VALIDATION_FAILED,
        error.message || 'Bracket generation validation failed'
      );
    }
  }

  // ============================================
  // PRIZE DISTRIBUTION VALIDATION (pure)
  // ============================================
  validatePrizeDistribution(
    distribution: Array<{ position: number; percentage: number; amount?: number }>
  ): void {
    try {
      logger.info('Validating prize distribution');

      if (!distribution || distribution.length === 0) {
        throw new AppError(
          ERROR_CODES.PRIZE_DISTRIBUTION_EMPTY,
          'Prize distribution cannot be empty'
        );
      }

      // 1. Positions must be unique positive integers
      const positions = distribution.map((d) => d.position);
      if (new Set(positions).size !== distribution.length) {
        throw new AppError(
          ERROR_CODES.PRIZE_POSITIONS_DUPLICATE,
          'Prize positions must be unique'
        );
      }
      if (positions.some((p) => !Number.isInteger(p) || p <= 0)) {
        throw new AppError(
          ERROR_CODES.PRIZE_POSITIONS_INVALID,
          'Prize positions must be positive integers'
        );
      }

      // 2. Percentages must sum to 100
      const totalPercentage = distribution.reduce((sum, d) => sum + d.percentage, 0);
      if (Math.abs(totalPercentage - 100) > 0.01) {
        throw new AppError(
          ERROR_CODES.PRIZE_PERCENTAGE_SUM,
          `Prize percentages must sum to 100%, current sum: ${totalPercentage}%`
        );
      }

      // 3. Percentages must be positive numbers
      if (distribution.some((d) => d.percentage <= 0 || d.percentage > 100)) {
        throw new AppError(
          ERROR_CODES.PRIZE_PERCENTAGE_INVALID,
          'Prize percentages must be between 0 and 100'
        );
      }

      logger.info('Prize distribution validation passed');
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Prize distribution validation failed', { error: error.message });
      throw new AppError(
        ERROR_CODES.PRIZE_DISTRIBUTION_VALIDATION_FAILED,
        error.message || 'Prize distribution validation failed'
      );
    }
  }

  // ============================================
  // SCHEDULE VALIDATION (pure)
  // ============================================
  validateSchedule(schedule: any): void {
    try {
      logger.info('Validating tournament schedule');

      const now = new Date();

      // 1. Required dates
      if (!schedule.registration_start || !schedule.registration_end || !schedule.tournament_start) {
        throw new AppError(
          ERROR_CODES.SCHEDULE_INCOMPLETE,
          'Registration start, registration end, and tournament start are required'
        );
      }

      const regStart = new Date(schedule.registration_start);
      const regEnd = new Date(schedule.registration_end);
      const tournamentStart = new Date(schedule.tournament_start);
      const tournamentEnd = schedule.tournament_end ? new Date(schedule.tournament_end) : null;

      // 2. Chronological order
      if (regStart >= regEnd) {
        throw new AppError(
          ERROR_CODES.SCHEDULE_INVALID_ORDER,
          'Registration start must be before registration end'
        );
      }
      if (regEnd >= tournamentStart) {
        throw new AppError(
          ERROR_CODES.SCHEDULE_INVALID_ORDER,
          'Registration end must be before tournament start'
        );
      }
      if (tournamentEnd && tournamentStart >= tournamentEnd) {
        throw new AppError(
          ERROR_CODES.SCHEDULE_INVALID_ORDER,
          'Tournament start must be before tournament end'
        );
      }

      // 3. Registration start cannot be in the past (unless in draft)
      // We'll not enforce this here because draft allows past dates; caller should handle context.

      // 4. Tournament start must be at least 24 hours after registration end? Not mandatory.
      // But we can suggest a minimum gap, but not enforce.

      // 5. Check-in window validation (if provided)
      if (schedule.check_in_start && schedule.check_in_end) {
        const checkInStart = new Date(schedule.check_in_start);
        const checkInEnd = new Date(schedule.check_in_end);
        if (checkInStart >= checkInEnd) {
          throw new AppError(
            ERROR_CODES.SCHEDULE_INVALID_ORDER,
            'Check-in start must be before check-in end'
          );
        }
        if (checkInStart >= tournamentStart) {
          throw new AppError(
            ERROR_CODES.SCHEDULE_INVALID_ORDER,
            'Check-in start must be before tournament start'
          );
        }
        if (checkInEnd > tournamentStart) {
          // Check-in can end exactly at tournament start or before
          if (checkInEnd.getTime() !== tournamentStart.getTime()) {
            throw new AppError(
              ERROR_CODES.SCHEDULE_INVALID_ORDER,
              'Check-in end must be on or before tournament start'
            );
          }
        }
      }

      // 6. Cancellation cutoff (if provided) must be before tournament start
      if (schedule.cancellation_cutoff) {
        const cutoff = new Date(schedule.cancellation_cutoff);
        if (cutoff >= tournamentStart) {
          throw new AppError(
            ERROR_CODES.SCHEDULE_INVALID_ORDER,
            'Cancellation cutoff must be before tournament start'
          );
        }
      }

      // 7. Fee deduction time (if provided) must be before tournament start
      if (schedule.fee_deduction_time) {
        const feeTime = new Date(schedule.fee_deduction_time);
        if (feeTime >= tournamentStart) {
          throw new AppError(
            ERROR_CODES.SCHEDULE_INVALID_ORDER,
            'Fee deduction time must be before tournament start'
          );
        }
      }

      logger.info('Schedule validation passed');
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Schedule validation failed', { error: error.message });
      throw new AppError(
        ERROR_CODES.SCHEDULE_VALIDATION_FAILED,
        error.message || 'Schedule validation failed'
      );
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================
  private calculateAge(dateOfBirth: Date): number {
    const today = new Date();
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    const monthDiff = today.getMonth() - dateOfBirth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) {
      age--;
    }
    return age;
  }

  // Additional validation methods used by tournament.service
  async validateCanPublish(tournament: IApexTournament): Promise<void> {
    // Called before publishing
    try {
      if (tournament.status !== 'draft') {
        throw new AppError(
          ERROR_CODES.INVALID_STATUS,
          `Only draft tournaments can be published, current: ${tournament.status}`
        );
      }

      // Validate schedule (dates must be in future)
      const now = new Date();
      if (tournament.schedule.registration_start <= now) {
        throw new AppError(
          ERROR_CODES.SCHEDULE_PAST,
          'Registration start must be in the future'
        );
      }

      // Validate prize distribution if paid tournament
      if (!tournament.is_free && tournament.entry_fee > 0) {
        if (!tournament.prize_structure?.distribution?.length) {
          throw new AppError(
            ERROR_CODES.PRIZE_DISTRIBUTION_REQUIRED,
            'Prize distribution must be defined for paid tournaments'
          );
        }
        this.validatePrizeDistribution(tournament.prize_structure.distribution);
      }

      // Ensure at least minimum participants > 0
      if (tournament.capacity.min_participants <= 0) {
        throw new AppError(
          ERROR_CODES.INVALID_MIN_PARTICIPANTS,
          'Minimum participants must be greater than 0'
        );
      }

      logger.info('Publish validation passed', { tournamentId: tournament._id });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        ERROR_CODES.PUBLISH_VALIDATION_FAILED,
        error.message || 'Publish validation failed'
      );
    }
  }

  async validateCanOpen(tournament: IApexTournament): Promise<void> {
    // Called when transitioning from awaiting_deposit to open
    try {
      if (tournament.status !== 'awaiting_deposit') {
        throw new AppError(
          ERROR_CODES.INVALID_STATUS,
          `Cannot open tournament from status: ${tournament.status}`
        );
      }

      // For paid tournaments, ensure escrow deposit is confirmed
      if (!tournament.is_free && tournament.entry_fee > 0) {
        // This would check the escrow account status
        // We'll assume the caller checks this; we just note it's required
        // Could be implemented with a DB lookup of EscrowAccount
        // For now, we skip because it requires cross-service dependency
        logger.info('Paid tournament: organizer deposit must be confirmed before opening', {
          tournamentId: tournament._id,
        });
        // In real implementation: check if escrow account exists and status is 'open'
      }

      // Registration window must be in the future
      if (tournament.schedule.registration_start <= new Date()) {
        // It's okay if registration start is in the past when opening? Usually we open exactly at start.
        // We'll allow but warn.
        logger.warn('Tournament opening with registration start in the past', {
          tournamentId: tournament._id,
        });
      }

      logger.info('Open validation passed', { tournamentId: tournament._id });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        ERROR_CODES.OPEN_VALIDATION_FAILED,
        error.message || 'Open validation failed'
      );
    }
  }
}

export const tournamentValidationService = new TournamentValidationService();