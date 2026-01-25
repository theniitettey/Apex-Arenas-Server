# Apex Arenas Server

Tournament management platform with escrow-based prize distribution for competitive gaming.

---

## Project Structure

```
server/src/
├── app.ts                    # Express application setup
├── server.ts                 # Server entry point
├── configs/                  # Configuration files
├── gateway/                  # API Gateway (security, routing)
│   ├── middlewares/
│   │   ├── security.middleware.ts
│   │   ├── rateLimiter.middleware.ts
│   │   ├── requestLogger.middleware.ts
│   │   └── errorHandler.middleware.ts
│   ├── routes.ts
│   └── index.ts
├── models/                   # MongoDB schemas
├── services/                 # Business logic (4 services)
│   ├── auth/
│   ├── tournament/
│   ├── finance/
│   └── community/
└── shared/                   # Shared utilities
    ├── constants/
    ├── helpers/
    ├── types/
    └── utils/
```

---

## Services

### 1. Auth Service (`/services/auth/`)

Handles user authentication, sessions, and security.

| Responsibility | Models |
|----------------|--------|
| User registration and login | User |
| Password reset | OTP |
| Session management | RefreshToken |
| Two-factor authentication | UserSecurity |
| Security audit logs | AuthLog |
| User profiles | User |
| Game profiles | User.game_profiles |

**Endpoints**: `/api/v1/auth/*`, `/api/v1/users/*`

---

### 2. Tournament Service (`/services/tournament/`)

Handles tournament lifecycle, matches, teams, and games.

| Responsibility | Models |
|----------------|--------|
| Tournament CRUD | Tournament |
| Player registrations | Registration |
| Check-ins | Registration |
| Bracket generation | Match |
| Match management | Match |
| Teams | Team |
| Team recruitment | TeamRecruitment |
| Game catalog | Game |
| Game requests | GameRequest |

**Endpoints**: `/api/v1/tournaments/*`, `/api/v1/games/*`, `/api/v1/teams/*`, `/api/v1/matches/*`, `/api/v1/registrations/*`

---

### 3. Finance Service (`/services/finance/`)

Handles payments, escrow, and payouts.

| Responsibility | Models |
|----------------|--------|
| User wallets | User.wallet |
| Deposits | Transaction |
| Entry fee processing | Transaction |
| Escrow management | EscrowAccount |
| Prize distribution | EscrowAccount |
| Payout requests | PayoutRequest |
| Refunds | Transaction |
| Platform fee collection | Transaction |

**Endpoints**: `/api/v1/finance/*`, `/api/v1/transactions/*`, `/api/v1/payouts/*`, `/api/v1/escrow/*`

---

### 4. Community Service (`/services/community/`)

Handles community content, feedback, and notifications.

| Responsibility | Models |
|----------------|--------|
| Community posts | CommunityPost |
| Comments | Comment |
| Tournament feedback | TournamentFeedback |
| Bug reports | ReportFeedback |
| Feature requests | ReportFeedback |
| Notifications | Notification |
| Email delivery | - |
| SMS delivery | - |

**Endpoints**: `/api/v1/community/*`, `/api/v1/notifications/*`, `/api/v1/feedback/*`

---

## Models

| Model | Collection | Service |
|-------|------------|---------|
| User | ApexUser | Auth |
| OTP | ApexOTP | Auth |
| RefreshToken | ApexRefreshToken | Auth |
| AuthLog | ApexAuthLog | Auth |
| UserSecurity | ApexUserSecurity | Auth |
| Game | ApexGame | Tournament |
| GameRequest | ApexGameRequest | Tournament |
| Tournament | ApexTournament | Tournament |
| Registration | ApexRegistration | Tournament |
| Match | ApexMatch | Tournament |
| Team | ApexTeam | Tournament |
| TeamRecruitment | ApexTeamRecruitment | Tournament |
| Transaction | ApexTransaction | Finance |
| EscrowAccount | EscrowAccount | Finance |
| PayoutRequest | ApexPayoutRequest | Finance |
| CommunityPost | ApexCommunityPost | Community |
| Comment | ApexComment | Community |
| TournamentFeedback | ApexTournamentFeedback | Community |
| ReportFeedback | ApexReportFeedback | Community |
| Notification | ApexNotification | Community |

---

## Service Directory Structure

Each service follows this structure:

```
services/{service_name}/
├── controllers/    # Request handlers
├── services/       # Business logic
├── routes/         # Route definitions
├── middlewares/    # Service-specific middleware
└── validators/     # Input validation schemas
```

---

## Gateway

The gateway handles:

- CORS configuration
- Security headers (Helmet)
- XSS prevention
- MongoDB injection prevention
- Rate limiting (global and per-route)
- Request logging
- Error handling
- Route aggregation

All requests pass through the gateway before reaching services.

---

## Money Flow

1. Organizer deposits prize pool into escrow (platform takes 1%)
2. Players pay entry fees into escrow (platform takes 10%, organizer gets 90%)
3. Tournament completes
4. Winners receive prizes from organizer deposit
5. Organizer receives their share of entry fees

Cancellation rules:
- More than 24 hours before start: Full refunds allowed
- Less than 24 hours before start: No cancellations

---

## Currency

All monetary values stored as integers (pesewas) to avoid floating-point issues.

Default currency: GHS (Ghana Cedis)

Payment methods: Mobile Money (MTN, Vodafone, AirtelTigo)

---

## Setup

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

---

## Environment Variables

```
NODE_ENV=development
PORT=5000
MONGODB_URI=
JWT_SECRET=
JWT_EXPIRES_IN=
CORS_ORIGINS=
```

---

## API Version

Current: `/api/v1`

---

## Design Reference

Figma: https://www.figma.com/design/jVY1kDanxPylpAALtq86gf/Untitled?node-id=1-2&t=TZWyZCObHes3FMIC-1