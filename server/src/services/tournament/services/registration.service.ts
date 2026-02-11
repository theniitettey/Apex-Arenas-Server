/**
 * register(tournamentId, userId, paymentData) - Full registration flow
unregister(tournamentId, userId) - Withdrawal + refund
processPayment(registration, paymentData) - Coordinate with Finance
addToWaitlist(tournamentId, userId) - Waitlist logic
promoteFromWaitlist(tournamentId) - Auto-promote when slot opens
verifyInGameId(userId, gameId, inGameId) - Check against user profile
listByTournament(tournamentId, filters) - Get registrations
listByUser(userId, filters) - Get user's registrations
 */