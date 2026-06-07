# BAREZ Platform — Architecture Reference

**Stack:** Node.js · Express · MongoDB (Mongoose) · EJS · Vercel Serverless  
**Last updated:** 2026-06-07

---

## System Overview

Barez is a real-estate property management platform with three distinct user surfaces:

| Surface | Entry Point | Auth Mechanism |
|---------|-------------|----------------|
| Admin Dashboard | `/login` → `/dashboard` | HMAC-signed cookie `fs_auth` |
| Staff Portal | `/staff` | Same `fs_auth` cookie, role-filtered |
| Customer Portal | `/account` | Separate cookie `fs_cust` |
| Host Portal | `/host` | Separate cookie `fs_host` |

---

## Directory Structure

```
finsight-web/
├── server.js              # App entry — middleware stack, route mounting, error handler
├── middleware/
│   ├── security.js        # Security headers (CSP, HSTS, XSS) + body sanitization
│   └── validate.js        # Composable input validation schemas
├── routes/
│   ├── api.js             # Internal JSON API (dashboard data)
│   ├── staff.js           # Staff portal routes
│   ├── account.js         # Customer self-service
│   ├── host.js            # Host portal
│   ├── client.js          # Public-facing pages
│   └── superadmin.js      # Super-admin (multi-tenant management)
├── models/                # Mongoose schemas (one file per entity)
├── utils/
│   ├── auth.js            # HMAC token create/verify + requireRole middleware
│   ├── rateLimit.js       # In-memory sliding-window rate limiter
│   └── retry.js           # Exponential backoff for external API calls
├── views/                 # EJS templates (server-rendered pages)
├── public/                # Static assets (CSS, JS, images)
└── vercel.json            # Serverless deployment config
```

---

## Authentication Architecture

All auth uses a **custom HMAC token** (not JWT) stored in an `httpOnly` cookie:

```
cookie = base64(JSON payload) + "." + HMAC-SHA256(base64 payload, SESSION_SECRET)
```

- Stateless — no session store needed on serverless
- Expiry embedded in payload (`exp` field)
- `verifyToken()` in `utils/auth.js` validates signature + expiry on every request
- Roles: `admin`, `manager`, `employee` — checked via `requireRole(...roles)` middleware

**Login flow:**
1. Try DB lookup (bcrypt comparison via `AdminUser` model)
2. Fall back to env-var users (legacy, plain text — remove when all users are in DB)

---

## Database Layer

**MongoDB** via Mongoose on MongoDB Atlas.

Connection is lazy (`connectDB()`) and cached across Vercel serverless invocations via `mongoose.connection.readyState` check.

### Key Models

| Model | Purpose |
|-------|---------|
| `Booking` | Apartment reservations (checkIn, checkOut, status, totalPrice) |
| `Customer` | Registered guests (phone, name, notes) |
| `Guest` | Walk-in / non-registered guests |
| `StaffUser` | Staff accounts with role + building assignments |
| `Contract` | Tenant contracts with payment schedules |
| `RoomInfo` | Apartment metadata (building, floor, type, status) |
| `AuditLog` | Immutable action log (who did what, when) |
| `ActivityLog` | Staff activity feed |
| `AdminUser` | Dashboard login accounts (bcrypt passwords) |

### Index Strategy

Critical compound indexes on hot query paths:
- `Booking`: `{ status, checkIn }`, `{ apartment, checkIn }`
- `Contract`: `{ status, nextPaymentDate }`
- `StaffUser`: `{ buildingId, role }`

---

## Request Lifecycle

```
Request
  │
  ├─ securityHeaders        (sets CSP, HSTS, X-Frame-Options, removes X-Powered-By)
  ├─ express.json()         (parse body, 2MB limit)
  ├─ sanitizeBody           (strip XSS vectors from all string fields)
  ├─ cookieParser()
  ├─ static files
  │
  ├─ Route-specific middleware:
  │    ├─ dbMiddleware       (ensures MongoDB connected before handler runs)
  │    ├─ loginRateLimit     (10 req / 15 min per IP on /login)
  │    ├─ apiRateLimit       (500 req / 15 min per IP on /api/*)
  │    └─ validate(schema)   (field-level validation, returns 400 on failure)
  │
  ├─ Route handler
  │
  └─ Global error handler   (catches next(err), hides stack in production)
```

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| XSS | CSP header + `sanitizeBody` middleware strips tags/event-handlers |
| Clickjacking | `X-Frame-Options: SAMEORIGIN` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Brute-force login | `loginRateLimit` (10 req/15min per IP) |
| Token tampering | HMAC-SHA256 signature on every cookie |
| Expired sessions | `exp` field in token payload, checked on every verify |
| Stack trace leakage | Global error handler hides details in `NODE_ENV=production` |
| Payload bombs | `express.json({ limit: '2mb' })` |

---

## Resilience Patterns

### Retry with Exponential Backoff (`utils/retry.js`)
Wrap any external API call (Resend email, Gemini AI, etc.):
```javascript
const { withRetry, retryOnTransient } = require('./utils/retry');
const result = await withRetry(() => sendEmail(data), {
  retries: 3, baseMs: 300, shouldRetry: retryOnTransient, label: 'email'
});
```

### DB Connection Resilience
`connectDB()` handles reconnection. If connection fails on a request, `dbMiddleware` returns HTTP 500 and destroys the broken socket so the next request gets a fresh connection.

---

## Deployment

**Platform:** Vercel (Hobby plan)  
**Build:** `@vercel/node` — each `server.js` becomes a serverless function  
**Cron:** `/api/cron/checkout-reminders` runs daily at 05:00 UTC

### Required Environment Variables

| Variable | Purpose |
|----------|---------|
| `MONGO_URI` | MongoDB Atlas connection string |
| `SESSION_SECRET` | HMAC signing secret (min 32 chars) |
| `DASHBOARD_PASSWORD` | Admin login fallback |
| `RESEND_API_KEY` | Email delivery |
| `GEMINI_API_KEY` | AI features |
| `CRON_SECRET` | Protects cron endpoint from public access |
| `SUPERADMIN_PASSWORD` | Super-admin portal access |

---

## Known Constraints & Future Work

- **No TypeScript** — migration would require full rewrite; deferred until v2.
- **In-memory rate limiter** — resets on cold start; acceptable for current scale. Replace with Redis if traffic grows past ~10k req/day.
- **Env-var user fallback** — remove `USERS` array from server.js once all accounts are migrated to `AdminUser` collection.
- **EJS templates** — consider migrating high-interactivity pages to a React/Vue SPA if complexity grows.
