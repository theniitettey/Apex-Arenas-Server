/**
 * create(organizerId, data) - Create tournament with all calculations
update(tournamentId, updates) - Update with validations
delete(tournamentId) - Delete tournament
publish(tournamentId) - Publish tournament
cancel(tournamentId, reason) - Cancel with refunds
getById(tournamentId, includeDetails?) - Fetch tournament
list(filters, pagination) - List/search tournaments
calculatePrizeStructure(tournament) - Calculate all prize math
calculateScheduleDependencies(tournament) - Auto-set deadlines
validateCapacity(tournament) - Check participant limits
transitionStatus(tournamentId, newStatus) - Status machine
 */