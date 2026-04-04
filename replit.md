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
- **AI:** webwaka-ai-platform (centralised, OpenRouter-backed)
- **Messaging:** Termii (WhatsApp Business + SMS)
- **Auth:** JWT via `@webwaka/core` shared library
- **Offline Sync:** Dexie (IndexedDB) for client-side

## Project Layout

```
src/
  worker.ts              # Main Cloudflare Worker entry point
  core/
    types.ts             # Shared TypeScript interfaces (all entities)
    ai-platform-client.ts # webwaka-ai-platform client
    paystack.ts          # Paystack payment processing (kobo)
    whatsapp.ts          # Termii WhatsApp/SMS adapter
  db/
    db.ts                # Dexie offline DB + sync
    schema.sql           # D1 SQL schema (base)
  i18n/                  # 7-locale internationalization
  modules/
    clients/             # Client management routes
    invoices/            # Invoice routes
    projects/            # Project tracking routes
    appointments/        # Appointment CRUD + WhatsApp state machine
    whatsapp/            # WhatsApp webhook handler
    staff/               # Multi-staff management + availability calendars
    scheduling/          # Dynamic scheduling engine + HTTP router
    quotes/              # Automated quoting system
    deposits/            # Deposit charges + cancellation fee enforcement
    reminders/           # Automated appointment reminders
    support/             # AI customer support chatbot webhook
migrations/              # D1 SQL migration files (run in order)
wrangler.toml            # Cloudflare environments (staging/production)
```

## Key Principles

1. **Build Once Use Infinitely** — Centralized auth via `@webwaka/core`
2. **Mobile First** — Lightweight Hono APIs
3. **Offline First** — Dexie offline store on client
4. **Nigeria First** — Paystack kobo, `en-NG` locale
5. **Africa First** — 7-locale i18n
6. **Vendor Neutral AI** — OpenRouter via webwaka-ai-platform abstraction

## Implemented Features

### Phase 1: Scheduling & Staff

**Dynamic Scheduling Engine** (`src/modules/scheduling/engine.ts`)
- Calculates available time slots for a staff member on a given date
- Factors in: staff availability windows, existing appointments, configurable buffer time
- For mobile/field visits: Haversine travel time estimation (~30 km/h urban average)
- Unit-tested with 20 test cases covering pure functions and mock-DB integration
- HTTP router: `GET /api/scheduling/slots?staffId=&date=&duration=&buffer=&mobile=1`

**Multi-Staff Management** (`src/modules/staff/index.ts`)
- Full CRUD for staff members with skills, roles, commission tracking
- Individual weekly availability calendars per staff member
- Routes: `/api/staff` (list/create), `/api/staff/:id` (get/update/deactivate), `/api/staff/:id/availability` (get/replace)
- `isValidHHMM` exported for unit testing
- `POST /api/appointments` now accepts `staffId` and enforces **double-booking prevention** via `checkDoubleBooking()` — returns HTTP 409 on conflict

### Phase 2: Pricing & Quotes

**Automated Quoting System** (`src/modules/quotes/index.ts`)
- Instant quote estimation without persistence (`POST /api/quotes/estimate`)
- Formal quote creation with line items, VAT (7.5% Nigeria default), deposit calculation
- Quote lifecycle management (draft → sent → accepted/rejected/expired)
- WhatsApp quote delivery (`POST /api/quotes/:id/send`)

**Deposit & Cancellation Fees** (`src/modules/deposits/index.ts`)
- Paystack payment initiation and verification for booking deposits
- Configurable cancellation fee (kobo) retained from deposit on cancellation
- Appointment auto-confirmation on payment verification
- Routes: `/api/deposits`, `/api/deposits/:id/verify`, `/api/deposits/appointment/:id/cancel`

### Phase 3: AI & Customer Experience

**AI Customer Support Bot** (`src/modules/support/chatbot.ts`)
- Webhook at `POST /webhook/support/:tenantId` supporting both WhatsApp (Termii) and web widget
- Calls webwaka-ai-platform with `capabilityId: 'ai.services.support'`
- Seeded with service catalogue, cancellation policy, and booking FAQ
- Graceful fallback message directs customers to "call us to book" when AI platform is unreachable (503)
- Prompt injection mitigation: user content goes only to `prompt` field; system instruction in fixed `BASE_FAQ`
- Rate-limited at 20 messages/min per tenant (applied in worker.ts)
- `parseWebWidgetPayload` and `BASE_FAQ` exported for unit testing

**Automated Reminders** (`src/modules/reminders/index.ts`)
- Schedule reminders via SMS, WhatsApp, or email per appointment
- Dispatch endpoint for cron job integration (`POST /api/reminders/dispatch`)
- Nigeria-First display format: WAT (UTC+1) timestamps in all messages

## API Routes Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | None | Health check |
| GET | /api/clients | JWT | List clients |
| POST | /api/clients | JWT | Create client |
| GET | /api/appointments | JWT | List appointments |
| POST | /api/appointments | JWT | Create appointment |
| GET | /api/staff | JWT | List staff |
| POST | /api/staff | JWT | Create staff |
| PUT | /api/staff/:id/availability | JWT | Set staff availability |
| GET | /api/scheduling/slots | JWT | Get available time slots |
| POST | /api/quotes/estimate | JWT | Instant quote estimate |
| POST | /api/quotes | JWT | Create formal quote |
| POST | /api/quotes/:id/send | JWT | Send quote via WhatsApp |
| POST | /api/deposits | JWT | Create deposit + Paystack init |
| POST | /api/deposits/:id/verify | JWT | Verify Paystack payment |
| POST | /api/deposits/appointment/:id/cancel | JWT | Cancel with fee enforcement |
| POST | /api/reminders | JWT | Schedule reminder |
| POST | /api/reminders/dispatch | JWT(admin) | Dispatch due reminders |
| GET | /webhook/whatsapp/:tenantId | None | WhatsApp challenge verify |
| POST | /webhook/whatsapp/:tenantId | None | Inbound WhatsApp booking |
| GET | /webhook/support/:tenantId | None | Support bot challenge verify |
| POST | /webhook/support/:tenantId | None | Inbound support message |

## Database Migrations (run in order)

```
migrations/0001_initial_schema.sql
migrations/0002_appointments_whatsapp.sql
migrations/0003_staff_scheduling_quotes_deposits_reminders.sql
```

## Running Locally (Replit)

```bash
npm run dev       # wrangler dev on port 8000
npm test          # Run all unit tests (120 tests across 7 files)
npm run typecheck # TypeScript check
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
INTER_SERVICE_SECRET        # Inter-service auth for AI platform calls
OPENROUTER_API_KEY          # OpenRouter API key (used by AI platform)
```
