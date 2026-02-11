/**
 * getById(matchId, includeParticipants?) - Fetch match
submitResult(matchId, winnerId, proof) - Player reports result
confirmResult(matchId, userId) - Opponent confirms
disputeResult(matchId, userId, reason) - Start dispute
resolveDispute(matchId, winnerId, resolution) - Organizer resolves
adminOverride(matchId, winnerId, reason) - Admin overrides
advanceWinner(matchId) - Move winner to next match
updateMatchStatus(matchId, newStatus) - Status transitions
autoForfeit(matchId) - No-show handling
listByTournament(tournamentId, round?) - Get matches
 */