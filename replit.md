# WebWaka Services Suite

## Overview

Backend API service for local service providers (salons, mechanics, home repair professionals) on the **WebWaka OS v4** platform. Designed for the Nigerian and African markets.

**Platform:** Cloudflare Workers (Serverless)  
**Framework:** Hono (lightweight edge web framework)  
**Language:** TypeScript  
**Package Manager:** npm

## Architecture

- **Runtime:** Cloudflare Workers via Wrangler (port 8000 in dev)
- **Database:** Cloudflare D1 (SQL), Cloudflare KV (sessions/rate limiting)
- **File Storage:** Cloudflare R2
- **Payments:** Paystack (NGN kobo — Invariant 5: Nigeria First)
- **Ledger:** webwaka-central-mgmt (financial event sink — `CENTRAL_MGMT_URL`)
- **AI:** webwaka-ai-platform (centralised, OpenRouter-backed)
- **Messaging:** Termii (WhatsApp Business + SMS)
- **Auth:** JWT via `@webwaka/core` shared library
- **External API:** API Key auth (SHA-256 hashed) for partner booking integrations

## Project Layout

```
src/
  worker.ts                    # Main Cloudflare Worker entry point
  core/
    types.ts                   # Shared TypeScript interfaces (all entities)
    central-mgmt-client.ts     # Ledger event emitter → webwaka-central-mgmt
    ai-platform-client.ts      # webwaka-ai-platform client
    paystack.ts                # Paystack payment processing (kobo)
    whatsapp.ts                # Termii WhatsApp/SMS adapter
  db/
    db.ts                      # Dexie offline DB + sync
    schema.sql                 # D1 SQL schema (base)
  i18n/                        # 7-locale internationalization
  modules/
    clients/                   # Client management (full CRUD + search + history)
    invoices/                  # Invoice CRUD + ledger events (WW-SVC-003)
    projects/                  # Project tracking + tasks + milestones (WW-SVC-006)
    appointments/              # Appointments + iCal feed + auto-reminders (WW-SVC-001/005)
    whatsapp/                  # WhatsApp webhook handler
    staff/                     # Multi-staff management + availability calendars
    scheduling/                # Dynamic scheduling engine (WW-SVC-004)
    quotes/                    # Automated quoting + ledger events (WW-SVC-003)
    deposits/                  # Deposit charges + ledger events (WW-SVC-007)
    reminders/                 # Automated appointment reminders (WW-SVC-005)
    services/                  # Service catalog CRUD (WW-SVC-008)
    api-keys/                  # API key management (admin only) (WW-SVC-008)
    external/                  # External booking API — API Key auth (WW-SVC-008)
    support/                   # AI customer support chatbot webhook
migrations/                    # D1 SQL migration files (run in order)
wrangler.toml                  # Cloudflare environments (staging/production)
```

## Key Principles (WebWaka OS v4 Invariants)

1. **Build Once Use Infinitely** — Centralised auth via `@webwaka/core`
2. **Mobile First** — Lightweight Hono APIs
3. **PWA First** — Cloudflare Workers + Pages
4. **Offline First** — Dexie offline store on client
5. **Nigeria First** — Paystack kobo, `en-NG` locale; ALL monetary values in kobo
6. **Africa First** — 7-locale i18n
7. **Vendor Neutral AI** — OpenRouter via webwaka-ai-platform abstraction

## Implemented Features (WW-SVC Taskbook — Complete)

### WW-SVC-001: Calendar Sync
- `calendarEventId` column on `appointments` for bidirectional external calendar sync
- `GET /api/appointments/calendar.ics` — RFC 5545 iCal feed (90-day window)
- Route registered before `/:id` to avoid param capture conflict

### WW-SVC-002: Client Management (Full CRUD)
- Full CRUD: list, get, create, update, deactivate
- `?search=` query param: searches `name`, `email`, `phone`, `company`
- `GET /api/clients/:id/history` — appointment and invoice history for a client

### WW-SVC-003: Central-Mgmt Ledger Integration
- `src/core/central-mgmt-client.ts` — HTTP client with exponential backoff (3 retries)
- Events emitted: `invoice.created`, `invoice.sent`, `invoice.paid`, `invoice.cancelled`, `quote.accepted`, `deposit.created`, `deposit.paid`, `deposit.forfeited`, `deposit.refunded`
- `CENTRAL_MGMT_URL` optional — if unset, events are logged but not sent (graceful skip)
- All event amounts in kobo; `currency: 'NGN'` hardcoded

### WW-SVC-004: Staff Scheduling — Available Staff
- `GET /api/scheduling/available-staff?date=&duration=&serviceId=` 
- Returns all active staff members with non-empty slot lists for the given date + duration
- Each staff entry includes their computed `TimeSlot[]` for client-side display

### WW-SVC-005: Auto-Reminders on Appointment Create
- On every `POST /api/appointments`, two `reminder_logs` rows are inserted:
  - 24h before `scheduledAt` (WhatsApp channel)
  - 1h before `scheduledAt` (WhatsApp channel)
- Reminders are `status = 'scheduled'`; dispatcher cron picks them up
- Cancelled when appointment is deleted/cancelled

### WW-SVC-006: Project Management (Full CRUD + Tasks + Milestones)
- Full project CRUD with status lifecycle (`draft → active → completed/cancelled`)
- `project_tasks` sub-resource: CRUD, status transitions, assignee, due dates
- `project_milestones` sub-resource: CRUD, amount tracking (kobo), status tracking

### WW-SVC-007: Deposit Ledger Events
- `deposit.created` emitted on `POST /api/deposits`
- `deposit.paid` emitted after successful Paystack verification
- `deposit.forfeited` or `deposit.refunded` emitted on cancellation via central-mgmt

### WW-SVC-008: External Booking API
- **Service Catalog** (`/api/services`): tenant-owned service definitions with name, duration, base price (kobo)
- **API Key Management** (`/api/api-keys`): admin-only create/list/revoke; plaintext shown once at creation, SHA-256 hash stored
- **External Routes** (`/external/*`): `Authorization: ApiKey <key>` header auth; tenant resolved from key record
  - `GET /external/services` — list active services for the tenant
  - `GET /external/availability?serviceId=&date=&staffId=` — available slots per staff
  - `POST /external/appointments` — book appointment (requires `bookings:write` scope)
  - `GET /external/appointments/:id` — get booking status
- Rate-limited at 60 req/min on `/external/*`

## API Routes Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | None | Health check |
| GET | /api/clients | JWT | List clients (supports ?search=) |
| POST | /api/clients | JWT | Create client |
| GET | /api/clients/:id | JWT | Get single client |
| PATCH | /api/clients/:id | JWT | Update client |
| DELETE | /api/clients/:id | JWT | Deactivate client |
| GET | /api/clients/:id/history | JWT | Client appointment + invoice history |
| GET | /api/projects | JWT | List projects |
| POST | /api/projects | JWT | Create project |
| GET | /api/projects/:id | JWT | Get project with tasks + milestones |
| PATCH | /api/projects/:id | JWT | Update project |
| DELETE | /api/projects/:id | JWT | Cancel project |
| POST | /api/projects/:id/tasks | JWT | Add task to project |
| PATCH | /api/projects/:id/tasks/:taskId | JWT | Update task |
| DELETE | /api/projects/:id/tasks/:taskId | JWT | Delete task |
| POST | /api/projects/:id/milestones | JWT | Add milestone |
| PATCH | /api/projects/:id/milestones/:msId | JWT | Update milestone |
| DELETE | /api/projects/:id/milestones/:msId | JWT | Delete milestone |
| GET | /api/invoices | JWT | List invoices |
| POST | /api/invoices | JWT | Create invoice (emits ledger event) |
| GET | /api/invoices/:id | JWT | Get invoice |
| PATCH | /api/invoices/:id | JWT | Update status (emits ledger event) |
| DELETE | /api/invoices/:id | JWT | Cancel invoice (emits ledger event) |
| GET | /api/appointments | JWT | List appointments |
| GET | /api/appointments/calendar.ics | JWT | iCal feed (90-day) |
| POST | /api/appointments | JWT | Create + auto-schedule reminders |
| GET | /api/appointments/:id | JWT | Get appointment |
| PATCH | /api/appointments/:id | JWT | Update appointment |
| DELETE | /api/appointments/:id | JWT | Delete + cancel reminders |
| GET | /api/staff | JWT | List staff |
| POST | /api/staff | JWT | Create staff |
| GET | /api/staff/:id | JWT | Get staff |
| PATCH | /api/staff/:id | JWT | Update staff |
| DELETE | /api/staff/:id | JWT | Deactivate staff |
| GET /PUT | /api/staff/:id/availability | JWT | Get/set weekly availability |
| GET | /api/scheduling/slots | JWT | Available slots for one staff |
| GET | /api/scheduling/available-staff | JWT | All staff with open slots |
| POST | /api/quotes/estimate | JWT | Instant estimate (no persist) |
| GET | /api/quotes | JWT | List quotes |
| POST | /api/quotes | JWT | Create quote |
| GET | /api/quotes/:id | JWT | Get quote with line items |
| PATCH | /api/quotes/:id | JWT | Update quote (emits ledger on accept) |
| POST | /api/quotes/:id/send | JWT | Send via WhatsApp |
| GET | /api/deposits | JWT | List deposits |
| POST | /api/deposits | JWT | Create + Paystack init (emits ledger) |
| GET | /api/deposits/:id | JWT | Get deposit |
| POST | /api/deposits/:id/verify | JWT | Verify payment (emits ledger) |
| GET | /api/deposits/appointment/:id | JWT | Deposit for appointment |
| POST | /api/deposits/appointment/:id/cancel | JWT | Cancel + fee enforcement (emits ledger) |
| GET | /api/reminders | JWT | List reminders |
| POST | /api/reminders | JWT | Schedule reminder |
| POST | /api/reminders/dispatch | JWT(admin) | Dispatch due reminders |
| GET | /api/services | JWT | List service catalog |
| POST | /api/services | JWT(admin) | Create service |
| GET | /api/services/:id | JWT | Get service |
| PATCH | /api/services/:id | JWT(admin) | Update service |
| DELETE | /api/services/:id | JWT(admin) | Deactivate service |
| GET | /api/api-keys | JWT(admin) | List API keys |
| POST | /api/api-keys | JWT(admin) | Create API key (plaintext once) |
| PATCH | /api/api-keys/:id | JWT(admin) | Update label/scopes |
| DELETE | /api/api-keys/:id | JWT(admin) | Revoke API key |
| GET | /external/services | ApiKey | List active services |
| GET | /external/availability | ApiKey | Available slots by service+date |
| POST | /external/appointments | ApiKey(bookings:write) | Book appointment |
| GET | /external/appointments/:id | ApiKey | Get booking status |
| GET | /webhook/whatsapp/:tenantId | None | WhatsApp challenge verify |
| POST | /webhook/whatsapp/:tenantId | None | Inbound WhatsApp booking |
| GET | /webhook/support/:tenantId | None | Support bot challenge verify |
| POST | /webhook/support/:tenantId | None | Inbound support message |

## Database Migrations (run in order)

```bash
wrangler d1 migrations apply DB --env staging
```

Files:
```
migrations/0001_initial_schema.sql
migrations/0002_appointments_whatsapp.sql
migrations/0003_staff_scheduling_quotes_deposits_reminders.sql
migrations/0004_extensions.sql      # calendarEventId, project_tasks, project_milestones, services, api_keys
```

## Running Locally (Replit)

```bash
npm run dev       # wrangler dev on port 8000
npm test          # Run all unit tests
npm run typecheck # TypeScript check (0 errors enforced)
```

## Deployment

```bash
npx wrangler deploy --env staging
npx wrangler deploy --env production
```

## Required Secrets

Set via `wrangler secret put <KEY> --env <staging|production>`:

```
JWT_SECRET                  # JWT signing secret
PAYSTACK_SECRET_KEY         # Paystack secret key
TERMII_API_KEY              # Termii API key
WHATSAPP_VERIFY_TOKEN       # Meta/Termii hub.challenge verification token
TERMII_WHATSAPP_SENDER_ID   # optional: Termii WhatsApp Business sender ID
AI_PLATFORM_URL             # URL of webwaka-ai-platform worker
INTER_SERVICE_SECRET        # Inter-service auth for AI platform + central-mgmt calls
CENTRAL_MGMT_URL            # optional: URL of webwaka-central-mgmt for ledger events
OPENROUTER_API_KEY          # OpenRouter API key (used by AI platform)
```
