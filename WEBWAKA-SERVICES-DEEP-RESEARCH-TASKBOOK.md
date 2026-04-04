# WEBWAKA-SERVICES DEEP RESEARCH + ENHANCEMENT TASKBOOK

**Repository:** `webwaka-services`
**Platform:** Cloudflare Workers + Hono + D1 + KV + R2
**Ecosystem Position:** Backend services API layer within the multi-repo WebWaka OS v4 platform
**Document Version:** 1.0 — April 2026
**Classification:** Implementation + QA Execution Ready

---

## TABLE OF CONTENTS

1. [Repo Deep Understanding](#1-repo-deep-understanding)
2. [External Best-Practice Research](#2-external-best-practice-research)
3. [Synthesis and Gap Analysis](#3-synthesis-and-gap-analysis)
4. [Top 20 Enhancements + Bug Fixes](#4-top-20-enhancements--bug-fixes)
5. [Task Breakdown — 20 Detailed Tasks](#5-task-breakdown)
6. [QA Plans — One Per Task](#6-qa-plans)
7. [Implementation Prompts — One Per Task](#7-implementation-prompts)
8. [QA Prompts — One Per Task](#8-qa-prompts)
9. [Priority Order](#9-priority-order)
10. [Dependencies Map](#10-dependencies-map)
11. [Phase 1 / Phase 2 Split](#11-phase-1--phase-2-split)
12. [Repo Context and Ecosystem Notes](#12-repo-context-and-ecosystem-notes)
13. [Governance and Reminder Block](#13-governance-and-reminder-block)
14. [Execution Readiness Notes](#14-execution-readiness-notes)

---

## 1. REPO DEEP UNDERSTANDING

### 1.1 Repository Identity

- **Package name:** `@webwaka/services`
- **Version:** 0.1.0
- **Runtime:** Cloudflare Workers via Wrangler v4+
- **Framework:** Hono v4.4+
- **Language:** TypeScript (strict mode, ES2022 target)
- **Database:** Cloudflare D1 (SQL), Cloudflare KV (sessions/rate limiting), Cloudflare R2 (file storage)
- **Client-side DB:** Dexie.js (IndexedDB, offline-first)
- **Payments:** Paystack (Nigeria-first, all amounts in kobo integers)
- **AI:** OpenRouter (vendor-neutral abstraction, default model: `anthropic/claude-3-haiku`)
- **Messaging:** Termii (WhatsApp Business + SMS, Nigeria-first)
- **Auth:** JWT via `@webwaka/core` shared package (never re-implemented locally)
- **Testing:** Vitest v3+ with coverage thresholds (80% lines/functions/statements, 75% branches)

### 1.2 Module Inventory

#### `src/worker.ts` — Entry Point
- Initialises a Hono app with typed `Bindings` and `AppVariables`
- Applies `secureCORS()` globally (environment-aware, no wildcard)
- Applies `rateLimit()` on `/api/auth/*` (10 req/60s)
- Applies `jwtAuthMiddleware()` on all `/api/*` routes
- Applies `rateLimit()` on `/webhook/whatsapp/*` (30 req/60s per phone)
- Exposes unauthenticated `GET /health` returning `{ status, service, version }`
- Routes to 5 module routers: projects, clients, invoices, appointments, whatsapp
- 404 handler returns `{ error: 'Not found' }`

#### `src/modules/projects/index.ts` — Projects Module
- `GET /api/projects` — list all projects for authenticated tenant (roles: admin, manager, consultant)
- `POST /api/projects` — create project (roles: admin, manager)
- **Missing:** GET by ID, PATCH (update), DELETE, pagination, status filters, search
- Uses raw D1 SQL, no input validation on POST body
- No `updatedAt` field on projects table (schema gap)

#### `src/modules/clients/index.ts` — Clients Module
- `GET /api/clients` — list all clients for tenant (roles: admin, manager, consultant)
- `POST /api/clients` — create client (roles: admin, manager)
- **Missing:** GET by ID, PATCH (update), DELETE (soft/hard), search, filter by status
- No input validation on POST body
- No duplicate email detection within tenant

#### `src/modules/invoices/index.ts` — Invoices Module
- `GET /api/invoices` — list all invoices for tenant (roles: admin, manager, accountant)
- `POST /api/invoices` — create invoice with auto-generated `invoiceNumber` (`INV-{timestamp}`)
- **Missing:** GET by ID, PATCH, DELETE, filter by status/clientId/projectId, Paystack integration
- Invoice number generation uses `Date.now()` — not collision-proof at scale
- No validation that `projectId` / `clientId` belong to the same tenant
- `totalKobo` not validated as `amountKobo + taxKobo`
- `paystack.ts` is fully implemented but **never called** from invoices module

#### `src/modules/appointments/index.ts` — Appointments REST CRUD
- Full CRUD: GET list (with `?status` and `?phone` filters), GET by ID, POST, PATCH, DELETE
- Input validation: required fields, ISO datetime, future date constraint, status enum, duration integer
- Soft-delete on DELETE (sets `status = 'cancelled'`)
- **Missing:** pagination, date-range filter (`?from=`, `?to=`), reminder scheduling, Paystack deposit integration

#### `src/modules/appointments/stateMachine.ts` — WhatsApp State Machine (Pure)
- States: `IDLE → GREETING → COLLECT_SERVICE → COLLECT_DATE → COLLECT_TIME → CONFIRM → BOOKED | CANCELLED`
- `parseDate()` supports: "today", "tomorrow", "next Monday", "15th April", "April 15", "15/04", "15/04/2025"
- `parseTime()` supports: "3pm", "3:30pm", "15:00", "14", "3 o'clock"
- `parseService()` supports: numeric selectors (1-5), aliases, service names
- `buildScheduledAt()` converts WAT to UTC ISO string
- `formatScheduledForDisplay()` formats UTC back to WAT human-readable
- `MESSAGES` object holds all bot response strings (English only, no i18n keys)
- **Missing:** i18n integration for bot messages (Yoruba, Hausa, French support), session TTL/expiry logic, conflict detection (double-booking prevention), client name collection, reminder scheduling

#### `src/modules/whatsapp/index.ts` — WhatsApp Webhook
- `GET /webhook/whatsapp/:tenantId` — Meta hub.challenge verification
- `POST /webhook/whatsapp/:tenantId` — receives Termii inbound, runs state machine, persists D1, sends reply
- **Session management:** session composite key = `tenantId:phone`, stored in `whatsapp_sessions` D1 table
- **Past-appointment guard:** rejects past scheduledAt after confirmation step
- **Stale data guard:** clears all collected fields when session resets to GREETING
- **Missing:** session TTL expiry (stale sessions never cleaned up), HMAC signature verification on inbound (Termii does not provide it but a shared token approach could be added), media message handling, client name collection during conversation, double-booking detection before BOOKED commit

#### `src/core/types.ts` — Shared Type Definitions
- `Bindings` interface (D1, KV×2, R2, ENVIRONMENT, JWT_SECRET, PAYSTACK_SECRET_KEY, OPENROUTER_API_KEY, TERMII_API_KEY, WHATSAPP_VERIFY_TOKEN, TERMII_WHATSAPP_SENDER_ID)
- `AppVariables` (user: AuthUser, tenantId: string)
- Domain types: `ProjectStatus`, `InvoiceStatus`, `AppointmentStatus`, `WhatsAppSessionState`
- Entities: `Appointment`, `WhatsAppSession`, `Client`, `Project`, `Invoice`
- **Missing:** `Pagination` type, `ErrorResponse` type, `PaymentTransaction` type, request/response DTOs with validation schemas

#### `src/core/ai.ts` — OpenRouter AI Wrapper
- `getAICompletion(apiKey, params)` — calls OpenRouter chat completions endpoint
- Default model: `anthropic/claude-3-haiku`
- **Missing:** model fallback/failover chain, retry logic with exponential backoff, token budget tracking, streaming support, error categorisation (rate limit vs auth vs model unavailable)
- **Never called** by any module — AI functionality is fully prepared but not wired in

#### `src/core/paystack.ts` — Paystack Integration
- `initializePayment()` — creates Paystack transaction, returns `authorization_url`
- `verifyPayment()` — verifies transaction by reference
- `generatePaymentReference()` — `SRV-{tenantId8}-{timestamp}-{random}`
- **Never called** by any module — payment capability built but not wired in
- **Missing:** Paystack webhook receiver for async payment status updates, idempotency handling, payment transaction D1 table

#### `src/core/whatsapp.ts` — WhatsApp Adapter
- `sendWhatsAppMessage()` — routes through `@webwaka/core/notifications` → `NotificationService` → Termii
- `verifyWebhookChallenge()` — Meta hub.challenge protocol
- `parseTermiiInbound()` — validates and extracts sender+message from Termii payload, includes E.164 validation and empty message rejection

#### `src/db/db.ts` — Dexie Offline DB
- Tables: `clients`, `projects`, `invoices`, `mutationQueue`
- `enqueueMutation()` — adds offline mutation with retryCount=0
- `processMutationQueue()` — replays mutations when online
- **Missing:** `appointments` table offline support, conflict resolution strategy, max retry limit (currently retries forever), exponential backoff in processMutationQueue, sync status tracking, Dexie live queries for reactive UI

#### `src/i18n/index.ts` — Internationalisation
- Locales: `en-NG`, `en-GH`, `en-KE`, `en-ZA`, `fr-CI`, `yo-NG`, `ha-NG`
- `toSubunit()` — converts major currency to subunit (kobo)
- `formatCurrency()` — formats kobo integer as localised string
- `SERVICE_TYPE_LABELS` — 3 service type labels × 7 locales
- **Missing:** i18n keys for bot messages, appointment status labels, error messages, date/time display formatting per locale, RTL support consideration for Arabic/Hausa

#### `src/middleware/auth.ts` — Auth Re-exports
- Simply re-exports `verifyJWT`, `signJWT`, `requireRole`, `jwtAuthMiddleware`, `secureCORS`, `rateLimit` from `@webwaka/core`
- Correctly enforces Invariant 1 (Build Once Use Infinitely)

### 1.3 Database Schema Analysis

**Migration 0001 — Initial Schema:**
- `clients`: id, tenantId, name, email, phone, company, address, status, createdAt, updatedAt
- `projects`: id, tenantId, clientId, name, description, status, budgetKobo, startDate, endDate, createdAt (**missing `updatedAt`**)
- `invoices`: id, tenantId, projectId, clientId, invoiceNumber, amountKobo, taxKobo, totalKobo, status, dueDate, createdAt (**missing `updatedAt`, `paidAt`, `paystackReference`**)

**Migration 0002 — Appointments + WhatsApp:**
- `appointments`: id, tenantId, clientPhone, clientName, service, scheduledAt, durationMinutes, status, notes, createdAt, updatedAt
- `whatsapp_sessions`: id, tenantId, phone, state, collectedService, collectedDate, collectedTime, appointmentId, updatedAt (**missing `expiresAt`, `messageCount`**)

**Missing tables:** `payment_transactions`, `notification_log`, `audit_log`

### 1.4 Testing Coverage Assessment

- **Covered:** `parseDate`, `parseTime`, `buildScheduledAt`, `transition` (state machine), `formatCurrency`, `toSubunit`, `generatePaymentReference`
- **Not covered:** all HTTP route handlers (projects, clients, invoices, appointments REST, whatsapp webhook), `getAICompletion`, `sendWhatsAppMessage`, `verifyWebhookChallenge`, `parseTermiiInbound`, `processMutationQueue`, `enqueueMutation`
- Coverage thresholds: 80% lines/functions/statements, 75% branches — **at risk** given uncovered routes

### 1.5 CI/CD Assessment

- `.github/workflows/deploy.yml`: typecheck → test → deploy (staging on PR, production on main push)
- **Missing:** lint step, coverage enforcement gate, migration run step, separate staging test suite, rollback strategy, deployment notifications
- PR deploys to staging but also immediately deploys to production on merge — **risky** (no staging gate)

### 1.6 Dependency Analysis

- `@webwaka/core` v1.3.2 — external shared package; provides JWT, CORS, rate limiting, notifications
- `hono` v4.4.0 — web framework
- `dexie` v3.2.7 — client-side IndexedDB
- `wrangler` v4+ (dev) — Cloudflare CLI
- `vitest` v3.2.4 (dev), `@vitest/coverage-v8` v3.2.4 (dev)
- `typescript` v5.5.3 (dev)
- `@cloudflare/workers-types` v4.20240725.0 (dev)
- **No input validation library** (Zod/Valibot) — all validation is hand-rolled
- **No schema serialisation** (no OpenAPI/Zod integration)

---

## 2. EXTERNAL BEST-PRACTICE RESEARCH

### 2.1 Cloudflare Workers + Hono API Design (2024–2025)

World-class patterns include:
- **Cursor-based pagination** over offset (D1 does not guarantee row ordering with offset at scale)
- **Zod or Valibot** for request validation — Valibot is ~10× smaller bundle, ~2× faster, preferred for edge
- **OpenAPI spec generation** using `@hono/zod-openapi` for auto-documentation and client generation
- **Structured JSON logging** on every request with correlation IDs, duration, status codes
- **Middleware stacking** for concerns: logging → auth → validation → handler
- **Typed error responses** — a single error shape `{ error, code, details }` across the entire API
- **`c.executionCtx.waitUntil()`** for fire-and-forget background tasks (sending notifications, logging) without delaying response

### 2.2 Cloudflare D1 Multi-Tenant Best Practices

- **Row-level tenant isolation:** Always `WHERE tenantId = ?` as first binding in every query (enforced, but no abstraction helper present)
- **Cursor pagination:** Use `WHERE id > ? ORDER BY id LIMIT ?` not `OFFSET`
- **D1 batch API:** Group multiple writes into `c.env.DB.batch([...])` for atomic commits and reduced round trips
- **Index coverage:** Composite indexes for common filter patterns (e.g. `(tenantId, status)`, `(tenantId, scheduledAt)`)
- **Foreign key-like validation:** D1 does not enforce FK constraints — must validate clientId/projectId existence before INSERT at the API layer
- **Session TTL:** Use a scheduled Cloudflare Worker (cron trigger) to prune stale records

### 2.3 WhatsApp Conversational Booking Chatbot Best Practices

- **Session TTL (24h):** WhatsApp sessions must expire; users who abandon mid-flow should be gracefully restarted
- **Double-booking prevention:** Check for overlapping appointments before committing a new booking
- **Client name collection:** Collect during initial greeting or after service selection for personalisation
- **Reminder scheduling:** Send 24h and 1h reminders via `waitUntil()` + KV-based job queue
- **Media message handling:** Return graceful "text only" message for image/audio/video inbound
- **Confirmation with rescheduling:** Allow user to reply with a new date during CONFIRM state instead of just YES/NO
- **Idempotent webhook processing:** Deduplicate inbound messages using a message ID to prevent double-sends on Termii retries

### 2.4 Paystack Best Practices (Nigeria 2024)

- **Webhook verification:** Always verify `x-paystack-signature` HMAC-SHA512 header — critical security requirement
- **Idempotent reference generation:** Reference must be globally unique; `SRV-{tenantId8}-{timestamp}-{random}` is good but should use UUID-based suffix for collision safety at scale
- **Async payment updates:** Paystack callbacks are async; maintain a `payment_transactions` table with status transitions
- **Supported channels explicitly:** `['card', 'bank', 'ussd', 'bank_transfer']` are the most relevant for Nigerian B2B invoicing
- **Currency lock:** Always specify `currency: 'NGN'` in Paystack calls to prevent accidental multi-currency charges

### 2.5 Input Validation on Edge

- **Valibot** is the preferred choice for Cloudflare Workers: ~1.4kB vs Zod's ~17.7kB, ~2× faster, full TypeScript inference
- Schema-first validation eliminates all hand-rolled validation boilerplate
- `@hono/valibot-validator` middleware provides clean per-route validation with typed request bodies
- Error messages should be deterministic and structured for API consumers

### 2.6 Multi-Tenant Rate Limiting

- Per-tenant rate limiting (not just per-IP) is critical for fairness — the current implementation uses per-IP KV keys
- Sliding window counters in KV are the standard Cloudflare pattern
- Separate limits per endpoint class: read vs write vs webhook
- Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) should be returned to clients

### 2.7 Dexie Offline Sync

- **Conflict resolution:** "last-write-wins" (LWW) with server-side `updatedAt` timestamps is the simplest safe strategy for this domain
- **Max retry cap:** Mutations should fail permanently after N retries (e.g., 5) to avoid infinite loops
- **Exponential backoff:** Retry delays should grow: 1s → 2s → 4s → 8s → 16s
- **Sync status store:** A `syncStatus` Dexie table with `{ entityType, lastSyncedAt, isPending }` enables reactive UI sync indicators
- **Appointments offline:** The Dexie DB currently lacks the `appointments` table — this is a gap for mobile PWA users

### 2.8 OpenRouter AI Failover

- **Model routing:** Use `models` array (not `model` string) for automatic fallback across providers
- **Retry on 429/503:** Implement exponential backoff for transient failures
- **Token budget:** Track and log token usage per request and per tenant for cost management
- **Prompt caching:** OpenRouter supports Anthropic's prompt caching — use for repeated system prompts
- **Streaming:** For longer AI outputs (proposals, reports), use streaming to reduce TTFB

### 2.9 Consulting CRM SaaS Feature Standards

World-class platforms (HoneyBook, Dubsado, 17hats) offer:
- Client portal (self-service invoice view and payment)
- Proposal/contract generation with e-signature
- Time tracking against projects
- Recurring invoice templates
- Automated payment reminders (3 days before, day of, 3 days overdue)
- Revenue reporting (monthly revenue, outstanding AR, paid vs pending)
- Pipeline view (leads → proposals → active → completed)
- Multi-currency invoicing for African cross-border work
- Document upload per project/client (R2 exists but unused)

### 2.10 Cloudflare Workers Observability

- `console.log()` outputs appear in Cloudflare Workers tail logs (production)
- Structured JSON logs (`{ level, event, tenantId, duration, status }`) are parseable by Cloudflare Logpush
- Correlation IDs (request UUID in header `X-Request-ID`) enable request tracing across retries
- `performance.now()` is available in Workers for timing middleware

---

## 3. SYNTHESIS AND GAP ANALYSIS

### 3.1 Critical Gaps (Security / Data Integrity)

| Gap | Impact | Module |
|-----|--------|--------|
| Paystack webhook has no HMAC-SHA512 signature verification | Allows forged payment confirmations — HIGH RISK | `paystack.ts` + invoices |
| No input validation library — hand-rolled only | Inconsistent validation, injection risk on unvalidated routes | All modules |
| No FK validation on clientId/projectId in invoices | Allows cross-tenant data reference pollution | `invoices/index.ts` |
| WhatsApp sessions never expire | Stale sessions accumulate; users re-entering after long gaps may get wrong state | `whatsapp_sessions` |
| Double-booking not prevented in WhatsApp flow | Two users can book the same slot simultaneously | `whatsapp/index.ts` |
| `projects` table has no `updatedAt` column | Cannot detect stale cache, no audit trail for project changes | migration |

### 3.2 Functional Gaps (Missing CRUD)

| Module | Missing Operations |
|--------|-------------------|
| Projects | GET by ID, PATCH, DELETE, pagination, filters |
| Clients | GET by ID, PATCH, DELETE, search, duplicate detection |
| Invoices | GET by ID, PATCH (status update), DELETE, Paystack payment initiation, filter by status/project/client |
| Appointments | Pagination, date-range filter, calendar view endpoint |

### 3.3 Platform Wiring Gaps

| Capability | Status |
|-----------|--------|
| `paystack.ts` | Fully implemented, never called by any module |
| `ai.ts` | Fully implemented, never called by any module |
| R2 bucket | Bound in wrangler.toml, no upload/download routes exist |
| `@webwaka/core/notifications` | Used only by WhatsApp; no email or push notification paths |

### 3.4 Architecture Gaps

| Concern | Gap |
|---------|-----|
| Pagination | No cursor-based pagination on any list endpoint |
| Structured logging | No request logging middleware |
| Correlation IDs | No `X-Request-ID` tracking |
| Audit log | No immutable audit trail for financial entities |
| Error response shape | Inconsistent — some return `{ error }`, some return raw text |
| `updatedAt` on projects | Missing in schema and PATCH handler |
| CI/CD | No staging gate — production deploys immediately after test pass |
| D1 batch writes | Not used — multiple sequential D1 writes are not atomic |

---

## 4. TOP 20 ENHANCEMENTS + BUG FIXES

### BUG FIXES

**BUG-01:** `projects` schema missing `updatedAt` column — no migration for it, PATCH handler does not exist, data is unauditable.

**BUG-02:** `invoices` schema missing `updatedAt` and `paidAt` columns — invoices cannot track when they were paid or last modified.

**BUG-03:** Invoice `totalKobo` is not validated as `amountKobo + taxKobo` — silent data inconsistency possible.

**BUG-04:** Projects and clients POST handlers have zero body validation — any missing field causes a silent null insert.

**BUG-05:** `invoice.invoiceNumber` uses `Date.now()` — millisecond collisions possible under load; not human-readable in Nigerian format.

**BUG-06:** WhatsApp sessions have no TTL — abandoned sessions accumulate indefinitely in D1.

**BUG-07:** `processMutationQueue` in Dexie has no max retry cap — failed mutations retry forever.

**BUG-08:** Double-booking not checked in `whatsapp/index.ts` before inserting into appointments table.

**BUG-09:** CI/CD deploys to production immediately on `main` merge with no staging gate or promotion step.

**BUG-10:** Paystack webhook endpoint does not exist — `verifyPayment()` is never called after Paystack redirects back.

### TOP 20 ENHANCEMENTS

**ENH-01:** Complete CRUD for Projects (GET/:id, PATCH, DELETE, pagination, status filter)
**ENH-02:** Complete CRUD for Clients (GET/:id, PATCH, soft-delete, search, duplicate email guard)
**ENH-03:** Complete CRUD for Invoices (GET/:id, PATCH status, filter, Paystack initiation, webhook verification)
**ENH-04:** Add Valibot schema validation across all POST/PATCH routes
**ENH-05:** Add cursor-based pagination to all list endpoints
**ENH-06:** Add request logging middleware with correlation IDs and structured JSON output
**ENH-07:** Wire AI (OpenRouter) into invoices and proposals — AI-generated invoice descriptions and project summaries
**ENH-08:** Add Paystack webhook receiver with HMAC-SHA512 signature verification and payment_transactions table
**ENH-09:** Add WhatsApp session TTL expiry (24h) with D1 cleanup cron
**ENH-10:** Add double-booking prevention to WhatsApp flow and appointments REST
**ENH-11:** Add appointment reminder scheduling (24h + 1h before) via Cloudflare Durable Objects or KV-scheduled jobs
**ENH-12:** Add R2 file upload/download routes for client documents and invoice attachments
**ENH-13:** Add i18n keys to bot MESSAGES and extend i18n module with appointment-domain labels
**ENH-14:** Add `payment_transactions` D1 table and CRUD endpoints
**ENH-15:** Add `appointments` table to Dexie offline DB and sync logic
**ENH-16:** Fix offline mutation queue — add max retry cap, exponential backoff, and sync status store
**ENH-17:** Add audit log table and middleware for financial entities (invoices, payments, appointments)
**ENH-18:** Add OpenAPI/Swagger documentation using `@hono/zod-openapi` or `@hono/swagger-ui`
**ENH-19:** Add revenue and pipeline reporting endpoints (monthly revenue, outstanding AR, appointment stats)
**ENH-20:** Fix CI/CD pipeline — add staging promotion gate, migration run step, coverage enforcement

---

## 5. TASK BREAKDOWN

---

### TASK-01: Fix Projects Schema + Complete Projects CRUD

**Title:** Add `updatedAt` migration, complete Projects CRUD with pagination and filters

**Objective:** Projects module currently has only 2 endpoints (list, create) with no body validation, no `updatedAt`, and no way to retrieve, update, or delete a single project.

**Why it matters:** A consulting agency's core workflow is managing projects. Missing CRUD makes the module unusable in production. The missing `updatedAt` is a data integrity bug.

**Repo scope:** `webwaka-services`

**Dependencies:** None — self-contained to this module.

**Prerequisites:** Migration tooling (`wrangler d1 migrations apply`) available. `@webwaka/core` `requireRole` available.

**Impacted modules:** `src/modules/projects/index.ts`, `migrations/`, `src/core/types.ts`

**Likely files to change:**
- New migration: `migrations/0003_projects_updatedAt.sql`
- `src/modules/projects/index.ts` — add GET/:id, PATCH, DELETE, pagination, status filter, body validation
- `src/core/types.ts` — add `updatedAt` to `Project` interface

**Expected output:**
- `GET /api/projects` — cursor-based pagination (`?cursor=`, `?limit=`), `?status=` filter
- `GET /api/projects/:id` — single project with tenant guard
- `PATCH /api/projects/:id` — update name, description, status, budgetKobo, startDate, endDate
- `DELETE /api/projects/:id` — soft-delete (set status = 'cancelled') or hard delete

**Acceptance criteria:**
- All 6 endpoints return correct shapes and respect tenantId isolation
- POST validates required fields (name, clientId, budgetKobo must be positive integer)
- PATCH validates status against `ProjectStatus` enum
- Migration adds `updatedAt` to existing projects table
- Tests cover all 6 endpoints

**Tests required:** HTTP handler integration tests using Hono's test client (`app.request()`)

**Risks:** Migration must be backward compatible; existing rows need a default `updatedAt` value

**Governance docs:** `@webwaka/core` invariants, Invariant 5 (kobo), Invariant 3 (multi-tenant)

**Important reminders:** tenantId ALWAYS from JWT, never from body/headers. `budgetKobo` must be integer, never naira float.

---

### TASK-02: Complete Clients CRUD with Duplicate Detection

**Title:** Add GET/:id, PATCH, soft-delete, search, and duplicate email guard to Clients module

**Objective:** Clients module has only list and create; completing it unlocks full CRM workflows.

**Why it matters:** A client record is the anchor entity for projects and invoices. Without complete CRUD, operators cannot correct mistakes or deactivate clients.

**Repo scope:** `webwaka-services`

**Dependencies:** None

**Prerequisites:** `@webwaka/core` `requireRole`

**Impacted modules:** `src/modules/clients/index.ts`, `src/core/types.ts`

**Likely files to change:**
- `src/modules/clients/index.ts` — add GET/:id, PATCH, DELETE (soft), search `?q=`, filter `?status=`
- POST: add unique email check within tenant before insert

**Expected output:**
- `GET /api/clients?q=term&status=active` — search by name/email/company, filter by status
- `GET /api/clients/:id` — single client
- `PATCH /api/clients/:id` — update any client field
- `DELETE /api/clients/:id` — soft-delete (status = 'inactive')
- `POST /api/clients` — rejects duplicate email within same tenant

**Acceptance criteria:**
- Duplicate email within tenant returns 409 Conflict
- Soft-delete sets status to 'inactive', not hard delete
- Search is case-insensitive using SQLite `LIKE`
- All endpoints enforce tenantId

**Tests required:** Tests for duplicate detection (same email same tenant, same email different tenant allowed), search, PATCH, soft-delete

**Risks:** Case-insensitive email comparison must use `LOWER(email) = LOWER(?)` to avoid false negatives

**Governance docs:** Invariant 3 (multi-tenant), GDPR-equivalent data minimisation

---

### TASK-03: Complete Invoices CRUD + Paystack Payment Initiation

**Title:** Add GET/:id, PATCH, filter, invoice number fix, and Paystack initiation to Invoices module

**Objective:** Wire the already-built Paystack integration into the invoices module, fix the invoice number generator, and complete CRUD.

**Why it matters:** Invoicing and payment collection is the primary monetisation function. Without it, the platform cannot process money.

**Repo scope:** `webwaka-services`

**Dependencies:** TASK-01 (projects must exist to reference), `paystack.ts` (already implemented)

**Prerequisites:** `PAYSTACK_SECRET_KEY` secret set. Migration for `invoices.updatedAt`, `invoices.paidAt`, `invoices.paystackReference` columns.

**Impacted modules:** `src/modules/invoices/index.ts`, `src/core/paystack.ts`, `migrations/`

**Likely files to change:**
- New migration: `migrations/0004_invoices_payment_columns.sql` — add `updatedAt`, `paidAt`, `paystackReference`
- `src/modules/invoices/index.ts` — GET/:id, PATCH status, filter by status/clientId/projectId, `POST /api/invoices/:id/pay` initiation
- Fix `invoiceNumber` to use: `INV-{YYYY}-{MM}-{padded sequential or UUID-based suffix}`
- Add `totalKobo === amountKobo + taxKobo` validation on POST

**Expected output:**
- `GET /api/invoices?status=sent&clientId=X&projectId=Y` — filtered list
- `GET /api/invoices/:id` — single invoice
- `PATCH /api/invoices/:id` — update status, dueDate, notes
- `POST /api/invoices/:id/pay` — initialise Paystack payment, return `{ authorization_url, reference }`
- Invoice numbers format: `INV-2026-04-{NANOID5}` (year-month-unique)

**Acceptance criteria:**
- `totalKobo` POST validation rejects mismatched totals
- Paystack initiation uses `generatePaymentReference()` and stores reference on invoice
- Only invoices in `draft` or `sent` status can be paid
- tenantId enforced on all endpoints

**Tests required:** Payment initiation with mocked Paystack fetch, totalKobo validation, status transitions

**Risks:** Paystack secret must be present in env; mock carefully in tests

**Governance docs:** Invariant 5 (kobo only, never naira), paystack.ts comments

---

### TASK-04: Add Paystack Webhook Receiver + `payment_transactions` Table

**Title:** Implement Paystack webhook endpoint with HMAC-SHA512 verification and payment_transactions D1 table

**Objective:** Paystack sends async payment confirmations via webhook. Without this, invoices can never be automatically marked as paid.

**Why it matters:** This is a critical security and business logic requirement. Without HMAC verification, forged webhooks could fraudulently mark invoices as paid.

**Repo scope:** `webwaka-services`

**Dependencies:** TASK-03 (invoices must have `paystackReference` column)

**Prerequisites:** `PAYSTACK_SECRET_KEY` env, migration for `payment_transactions` table, `PAYSTACK_WEBHOOK_PATH` configured

**Impacted modules:** `src/worker.ts`, `src/modules/invoices/index.ts`, `src/core/paystack.ts`, `migrations/`

**Likely files to change:**
- New migration: `migrations/0005_payment_transactions.sql`
- New module: `src/modules/payments/index.ts` — webhook handler at `POST /webhook/paystack`
- `src/worker.ts` — register payments router
- `src/core/paystack.ts` — add `verifyPaystackWebhookSignature(rawBody, signature, secret): boolean`

**Expected output:**
- `POST /webhook/paystack` (unauthenticated, secured by HMAC)
- On `charge.success`: update `invoices.status = 'paid'`, `invoices.paidAt`, insert `payment_transactions` row
- On `charge.failed`: update `payment_transactions` status
- Returns 200 immediately to prevent Paystack retries

**Acceptance criteria:**
- HMAC-SHA512 verification using `crypto.subtle.verify()` (Web Crypto, available in Workers)
- Idempotent — second webhook for same reference does not double-process
- All D1 writes in a `DB.batch()` for atomicity

**Tests required:** Signature verification unit test, mock Paystack webhook POST, idempotency test

**Risks:** `crypto.subtle` API availability in Workers test environment (Vitest node environment differs)

**Governance docs:** Paystack docs on webhook security

---

### TASK-05: Add Valibot Schema Validation to All POST/PATCH Routes

**Title:** Install Valibot and add schema validation middleware to all mutation routes

**Objective:** Replace inconsistent hand-rolled validation with Valibot schema-first validation for all POST and PATCH handlers.

**Why it matters:** Missing validation on projects and clients POST allows malformed data into D1. Valibot provides type-safe, consistent, bundle-efficient validation.

**Repo scope:** `webwaka-services`

**Dependencies:** None — additive change

**Prerequisites:** `npm install valibot @hono/valibot-validator`

**Impacted modules:** All modules

**Likely files to change:**
- `src/schemas/` — new directory with per-entity schemas
- `src/modules/projects/index.ts`, `clients/index.ts`, `invoices/index.ts`, `appointments/index.ts`

**Expected output:**
- `CreateProjectSchema`, `PatchProjectSchema`, `CreateClientSchema`, etc.
- `400` response with structured `{ error, details: [{ field, message }] }` on validation failure
- All existing hand-rolled validation replaced

**Acceptance criteria:**
- Missing required fields → 400 with field-level errors
- Invalid kobo values (float, negative, zero) → 400
- Valid requests pass through unchanged

**Tests required:** Schema unit tests for boundary cases, invalid inputs

**Risks:** Bundle size increase (Valibot is small ~1.4kB); `@hono/valibot-validator` compatibility with Hono v4.4

**Governance docs:** Invariant 5 (kobo must be integer), type definitions in `types.ts`

---

### TASK-06: Add Cursor-Based Pagination to All List Endpoints

**Title:** Implement cursor-based pagination on clients, projects, invoices, appointments

**Objective:** All list endpoints currently return all rows for a tenant with no pagination — unscalable and dangerous for large tenants.

**Why it matters:** A tenant with 500+ clients/invoices will cause timeouts or huge payloads. Cursor pagination is the Cloudflare D1 recommended pattern.

**Repo scope:** `webwaka-services`

**Dependencies:** TASK-01, TASK-02, TASK-03 (CRUD completion)

**Prerequisites:** None

**Impacted modules:** All module index files, `src/core/types.ts`

**Likely files to change:**
- `src/core/pagination.ts` — new helper: `buildCursorQuery(baseQuery, cursor, limit)`
- All 4 list endpoints
- `src/core/types.ts` — add `PaginatedResponse<T>` interface

**Expected output:**
- `GET /api/clients?cursor=LAST_ID&limit=20` → `{ data: [...], nextCursor: ID | null, hasMore: bool }`
- Default limit: 20, max: 100
- Consistent pagination shape across all list endpoints

**Acceptance criteria:**
- First page returns `nextCursor` pointing to last item
- Second call with `cursor=LAST_ID` returns next page
- Empty page returns `{ data: [], nextCursor: null, hasMore: false }`
- Limit > 100 is rejected with 400

**Tests required:** Pagination unit tests with mocked D1

**Risks:** D1 does not support server-side cursors; cursor must be encoded as last-seen `id` value

---

### TASK-07: Add Request Logging Middleware with Correlation IDs

**Title:** Implement structured JSON logging middleware with X-Request-ID correlation

**Objective:** Add production-grade observability to every request: log request method, path, status, duration, tenantId, and correlation ID.

**Why it matters:** Without structured logs, debugging production issues on Cloudflare Workers tail is extremely difficult. Correlation IDs allow tracing multi-step requests.

**Repo scope:** `webwaka-services`

**Dependencies:** None

**Prerequisites:** None — uses `console.log` and `crypto.randomUUID()`

**Impacted modules:** `src/worker.ts`, new `src/middleware/logging.ts`

**Likely files to change:**
- `src/middleware/logging.ts` — new logging middleware
- `src/worker.ts` — register logging middleware before auth

**Expected output:**
- Every request logs: `{ requestId, method, path, status, durationMs, tenantId?, timestamp }`
- `X-Request-ID` response header set on every response
- Errors log `{ requestId, error, stack }` (stack in non-production only)

**Acceptance criteria:**
- Logging middleware runs before auth, so failed auth requests are also logged
- Duration measured with `performance.now()`
- `requestId` is a UUID generated per request
- Sensitive data (auth tokens, API keys) never logged

**Tests required:** Middleware unit test asserting log shape, header presence

**Risks:** Logging adds ~0.1ms overhead per request — acceptable

---

### TASK-08: Add WhatsApp Session TTL + D1 Cleanup Cron

**Title:** Implement 24h WhatsApp session TTL with Cloudflare cron trigger for cleanup

**Objective:** WhatsApp sessions currently never expire. Users who abandon a conversation mid-flow retain stale state indefinitely.

**Why it matters:** Stale sessions cause confusing UX (user returns days later, state machine is mid-flow) and accumulate in D1 indefinitely.

**Repo scope:** `webwaka-services`

**Dependencies:** Migration for `expiresAt` column on `whatsapp_sessions`

**Prerequisites:** `wrangler.toml` cron trigger configuration

**Impacted modules:** `src/modules/whatsapp/index.ts`, `migrations/`, `wrangler.toml`, new `src/cron/cleanupSessions.ts`

**Likely files to change:**
- New migration: `migrations/0006_session_ttl.sql` — add `expiresAt TEXT` to `whatsapp_sessions`
- `src/modules/whatsapp/index.ts` — set `expiresAt = now + 24h` on session create/update; check expiry before processing
- `src/cron/cleanupSessions.ts` — scheduled handler: `DELETE FROM whatsapp_sessions WHERE expiresAt < ?`
- `wrangler.toml` — add `[triggers] crons = ["0 2 * * *"]` (2am UTC daily)
- `src/worker.ts` — export `scheduled` handler

**Expected output:**
- Sessions with `expiresAt < now` treated as IDLE (reset and restarted)
- Daily cron deletes expired sessions
- New `expiresAt` refreshed on every inbound message

**Acceptance criteria:**
- Expired session is reset to IDLE, user receives GREETING message
- Cron runs daily without errors
- Migration backward-compatible (NULL expiresAt treated as already expired after 24h from `updatedAt`)

**Tests required:** Session expiry unit test, cron handler unit test

**Risks:** Cloudflare cron triggers require paid Workers plan (Bundled or above)

---

### TASK-09: Add Double-Booking Prevention

**Title:** Prevent overlapping appointments for the same tenant-slot combination

**Objective:** Currently two simultaneous WhatsApp users can both book the same appointment slot. Add a D1 check before committing the BOOKED state.

**Why it matters:** Double bookings are a core operational problem for consulting businesses and destroy client trust.

**Repo scope:** `webwaka-services`

**Dependencies:** TASK-01 (appointments have date indexes)

**Prerequisites:** `idx_appointments_scheduledAt` index (already exists in migration 0002)

**Impacted modules:** `src/modules/whatsapp/index.ts`, `src/modules/appointments/index.ts`

**Likely files to change:**
- `src/modules/whatsapp/index.ts` — before INSERT, query for overlapping confirmed/pending appointments within `[scheduledAt, scheduledAt + durationMinutes]`
- `src/modules/appointments/index.ts` — same check on POST (manual creation)
- New helper: `src/core/appointmentConflict.ts`

**Expected output:**
- Overlap query: `SELECT id FROM appointments WHERE tenantId = ? AND status IN ('pending','confirmed') AND scheduledAt = ?`
- On conflict: WhatsApp bot replies with available slots message, stays in COLLECT_TIME state
- REST POST returns `409 Conflict` with `{ error: 'Time slot already booked' }`

**Acceptance criteria:**
- Two simultaneous bookings for the same slot: only one succeeds
- D1 batch used to atomically check + insert (or use D1 unique index as backup)
- WhatsApp user sees a helpful alternative slots message

**Tests required:** Concurrent booking test (sequential calls simulating race), overlap detection unit test

**Risks:** D1 does not have true serializable transactions at the edge; mitigate with a UNIQUE index on `(tenantId, scheduledAt)` as backstop

---

### TASK-10: Add Appointment Reminder Scheduling

**Title:** Schedule 24h and 1h appointment reminders via Cloudflare KV job queue

**Objective:** After an appointment is booked (via WhatsApp or REST), schedule automated WhatsApp reminder messages.

**Why it matters:** Appointment reminders are a critical feature for reducing no-shows in the consulting context. Leading booking platforms (Calendly, Acuity) send 2–3 reminders.

**Repo scope:** `webwaka-services`

**Dependencies:** TASK-03 (invoices), TASK-08 (WhatsApp send infrastructure), `@webwaka/core/notifications`

**Prerequisites:** `SESSIONS_KV` or a dedicated `REMINDERS_KV` namespace. Cloudflare cron trigger.

**Impacted modules:** `src/modules/whatsapp/index.ts`, `src/modules/appointments/index.ts`, new `src/cron/reminders.ts`

**Likely files to change:**
- `src/cron/reminders.ts` — cron handler: queries appointments within next 25h and 2h, sends reminders via `sendWhatsAppMessage()`
- `src/modules/whatsapp/index.ts` — after BOOKED, enqueue reminders in `SESSIONS_KV` as `reminder:{appointmentId}:24h` and `:1h`
- `wrangler.toml` — add hourly cron: `"0 * * * *"`

**Expected output:**
- 24h before appointment: `"⏰ Reminder: Your {service} appointment is tomorrow at {time} (WAT). Reply CANCEL to cancel."`
- 1h before appointment: `"⏰ Your {service} appointment is in 1 hour at {time} (WAT). See you soon!"`
- Reminder idempotency: KV key deleted after send to prevent double-send

**Acceptance criteria:**
- Reminders sent only for `pending` or `confirmed` appointments
- `cancelled` appointments skip reminders
- Cron runs every hour without errors
- MESSAGES object extended with `REMINDER_24H` and `REMINDER_1H`

**Tests required:** Reminder cron unit test with mocked D1 query and sendWhatsAppMessage

**Risks:** Cloudflare KV consistency is eventual; reminder could be sent slightly off-time — acceptable for this use case

---

### TASK-11: Add R2 File Upload/Download Routes

**Title:** Implement file upload and download endpoints for client documents and invoice attachments using R2

**Objective:** The `MEDIA_BUCKET` R2 binding exists in wrangler.toml but no upload/download routes are implemented.

**Why it matters:** Client documents (contracts, briefs) and invoice PDFs are core consulting artifacts. R2 provides cheap, fast, globally distributed object storage.

**Repo scope:** `webwaka-services`

**Dependencies:** None — R2 binding already configured

**Prerequisites:** `MEDIA_BUCKET` R2 binding in all environments

**Impacted modules:** New `src/modules/files/index.ts`, `src/worker.ts`

**Likely files to change:**
- `src/modules/files/index.ts` — new file module
- `src/worker.ts` — register `/api/files` route

**Expected output:**
- `POST /api/files/upload?entityType=client&entityId=X` — multipart upload, stores to R2 at `{tenantId}/{entityType}/{entityId}/{uuid}.{ext}`, returns `{ fileKey, url }`
- `GET /api/files/:fileKey` — presigned R2 URL or direct stream
- `DELETE /api/files/:fileKey` — remove from R2 (admin/manager only)
- Max file size: 10MB. Allowed types: PDF, PNG, JPG, DOCX

**Acceptance criteria:**
- Files stored under tenant-scoped R2 prefix (tenant isolation)
- File type validation via MIME type (not file extension only)
- File access gated by JWT auth + tenantId ownership check

**Tests required:** Upload/download/delete handler tests with mocked R2 binding

**Risks:** R2 multipart upload API differences between local Wrangler dev and production; test both paths

---

### TASK-12: Wire OpenRouter AI into Invoice and Proposal Generation

**Title:** Add AI-powered invoice description and project proposal generation endpoints

**Objective:** The `ai.ts` OpenRouter abstraction is fully built but never called. Wire it into practical AI features for the consulting domain.

**Why it matters:** AI-generated proposals and invoice descriptions save consultants significant time and are a key differentiation for the platform.

**Repo scope:** `webwaka-services`

**Dependencies:** TASK-03 (invoices exist), TASK-01 (projects exist), `ai.ts`

**Prerequisites:** `OPENROUTER_API_KEY` secret set

**Impacted modules:** `src/modules/invoices/index.ts`, `src/modules/projects/index.ts`, `src/core/ai.ts`

**Likely files to change:**
- `src/core/ai.ts` — add model fallback array, retry logic with exponential backoff
- `src/modules/invoices/index.ts` — add `POST /api/invoices/:id/generate-description` using `c.executionCtx.waitUntil()` for async generation
- `src/modules/projects/index.ts` — add `POST /api/projects/:id/generate-proposal` returning a structured proposal outline

**Expected output:**
- `POST /api/invoices/:id/generate-description` — returns `{ description: string }` using project/client context
- `POST /api/projects/:id/generate-proposal` — returns `{ proposal: { executive_summary, scope, timeline, pricing } }`
- AI errors return graceful `503` fallback message, never expose API keys in errors

**Acceptance criteria:**
- Fallback model chain: `anthropic/claude-3-haiku` → `google/gemini-flash-1.5` → `meta-llama/llama-3.1-8b-instruct:free`
- Token usage logged per request
- System prompt enforces conciseness and Nigerian business context
- Rate limiting: max 5 AI requests/minute per tenant (KV-based)

**Tests required:** Mock OpenRouter fetch, retry logic test (simulate 429 → success), fallback test

**Risks:** OpenRouter token costs; rate limiting must prevent abuse

---

### TASK-13: Add i18n Keys to WhatsApp Bot Messages

**Title:** Integrate i18n module into WhatsApp state machine messages for Yoruba, Hausa, and French support

**Objective:** Bot messages in `stateMachine.ts` are hardcoded English strings. Extend the i18n module with appointment booking message keys and wire them into the state machine.

**Why it matters:** Invariant 6 (Africa First) requires 7-locale support. Yoruba and Hausa are spoken by hundreds of millions of Nigerians and are critical for mass market adoption.

**Repo scope:** `webwaka-services`

**Dependencies:** `src/i18n/index.ts` (extend)

**Prerequisites:** Translation strings for `yo-NG`, `ha-NG`, `fr-CI` (can start with `en-NG` defaults)

**Impacted modules:** `src/i18n/index.ts`, `src/modules/appointments/stateMachine.ts`, `src/modules/whatsapp/index.ts`

**Likely files to change:**
- `src/i18n/index.ts` — add `BOT_MESSAGES` i18n map with all message keys × 7 locales
- `src/modules/appointments/stateMachine.ts` — `MESSAGES` factory accepts `locale: SupportedLocale` param
- `src/modules/whatsapp/index.ts` — determine locale from session (default `en-NG`); pass to `transition()`

**Expected output:**
- `MESSAGES.GREETING(name?, locale)` returns localised greeting
- `whatsapp_sessions` stores `locale` field (default `en-NG`)
- User can set locale by sending "Yoruba", "Hausa", "French" at any IDLE state

**Acceptance criteria:**
- All 7 locales return non-empty strings for all message keys
- Locale selection persisted in session
- Tests verify localised message shapes

**Tests required:** i18n unit tests for all locales, state machine locale routing tests

**Risks:** Translation quality for Yoruba/Hausa — must be reviewed by native speakers before production deployment

---

### TASK-14: Add Audit Log Table and Middleware

**Title:** Implement immutable audit log for all financial entity mutations

**Objective:** Track all creates, updates, and status changes to invoices, payments, and appointments in an append-only D1 audit log.

**Why it matters:** Financial audit trails are a regulatory and trust requirement for any business operating in Nigeria (FIRS, CAC compliance). Consulting firms need to show when invoices were created, sent, and paid.

**Repo scope:** `webwaka-services`

**Dependencies:** TASK-04 (payments), TASK-03 (invoices)

**Prerequisites:** Migration for `audit_log` table

**Impacted modules:** `src/worker.ts`, new `src/middleware/audit.ts`, `migrations/`

**Likely files to change:**
- New migration: `migrations/0007_audit_log.sql`
- `src/middleware/audit.ts` — `auditLog(entityType, action)` middleware factory
- Apply to `PATCH /api/invoices/:id`, `POST /api/invoices/:id/pay`, `PATCH /api/appointments/:id`

**Expected output:**
- `audit_log` table: id, tenantId, userId, entityType, entityId, action, payload (JSON), timestamp
- Every mutation creates an audit_log row via `c.executionCtx.waitUntil()` (non-blocking)
- `GET /api/audit?entityType=invoice&entityId=X` — read-only audit trail (admin only)

**Acceptance criteria:**
- Audit log is append-only (no UPDATE/DELETE on audit_log)
- Sensitive fields (PAYSTACK_SECRET_KEY etc.) stripped from payload before logging
- Non-blocking via `waitUntil()`

**Tests required:** Middleware unit test asserting log creation, payload sanitisation test

**Risks:** D1 write volume if audit log is applied too broadly — scope to financial entities only

---

### TASK-15: Add Revenue Reporting Endpoints

**Title:** Implement revenue reporting and appointment analytics endpoints

**Objective:** Add read-only reporting endpoints for monthly revenue, outstanding AR, and appointment statistics.

**Why it matters:** Leading consulting platforms provide dashboards. Without reporting, operators must query D1 manually. This is a key admin and business intelligence feature.

**Repo scope:** `webwaka-services`

**Dependencies:** TASK-03 (invoices), TASK-04 (payments), TASK-01 (appointments)

**Prerequisites:** All core CRUD tasks complete

**Impacted modules:** New `src/modules/reports/index.ts`, `src/worker.ts`

**Likely files to change:**
- `src/modules/reports/index.ts` — new reports router
- `src/worker.ts` — register `/api/reports` route (admin only)

**Expected output:**
- `GET /api/reports/revenue?year=2026&month=04` — total invoiced, total paid, outstanding AR (all in kobo)
- `GET /api/reports/appointments?year=2026&month=04` — total booked, confirmed, cancelled, completed counts
- `GET /api/reports/clients` — top 5 clients by invoice total

**Acceptance criteria:**
- All amounts in kobo (never naira)
- `formatCurrency()` from i18n used for display labels in response
- Requires `admin` role
- Results tenant-scoped

**Tests required:** Report endpoint tests with seed D1 data

**Risks:** Aggregation queries on large D1 tables can be slow; add composite indexes

---

### TASK-16: Fix Dexie Offline DB — Appointments + Retry Cap + Backoff

**Title:** Add appointments to Dexie offline DB, implement max retry cap and exponential backoff in mutation queue

**Objective:** `db.ts` is missing appointments offline storage. The mutation queue retries failed mutations forever. Add both fixes.

**Why it matters:** Invariant 4 (Offline First) is only partially implemented. Mobile PWA users cannot create/view appointments offline. Infinite retries can cause IndexedDB bloat.

**Repo scope:** `webwaka-services`

**Dependencies:** None

**Prerequisites:** None

**Impacted modules:** `src/db/db.ts`, `src/core/types.ts`

**Likely files to change:**
- `src/db/db.ts` — add `appointments` table to Dexie schema (version 2 migration), add `syncStatus` table, fix `processMutationQueue()` with max retries (5) and exponential backoff, add `MAX_RETRY_COUNT = 5`

**Expected output:**
- `db.appointments` table with indexed fields
- `processMutationQueue()` skips entries with `retryCount >= MAX_RETRY_COUNT` and marks them `failed`
- Backoff: `await delay(Math.pow(2, entry.retryCount) * 1000)`
- `syncStatus` table: `{ entity, lastSyncedAt, pendingCount }`

**Acceptance criteria:**
- Mutation with 5 failures marked as permanently failed, not retried
- `appointments` table supports offline creates and reads
- Dexie schema version incremented to 2

**Tests required:** Retry cap unit test, backoff delay test, appointments table smoke test

**Risks:** Dexie version migration must preserve existing data (version 2 additive only)

---

### TASK-17: Add OpenAPI Documentation with Swagger UI

**Title:** Generate OpenAPI 3.0 spec and add Swagger UI endpoint using Hono middleware

**Objective:** Add self-documenting API with OpenAPI 3.0 spec auto-generated from Hono route definitions.

**Why it matters:** An undocumented API makes client development (mobile app, admin dashboard) slow and error-prone. OpenAPI enables auto-generation of TypeScript clients, Postman collections, and test fixtures.

**Repo scope:** `webwaka-services`

**Dependencies:** TASK-05 (Valibot schemas — can be reused for OpenAPI spec)

**Prerequisites:** `npm install @hono/swagger-ui @hono/zod-openapi` (or manual OpenAPI definition)

**Impacted modules:** `src/worker.ts`, new `src/openapi/spec.ts`

**Likely files to change:**
- `src/openapi/spec.ts` — OpenAPI 3.0 document (paths, schemas, security)
- `src/worker.ts` — register `GET /docs` (Swagger UI), `GET /openapi.json`

**Expected output:**
- `GET /openapi.json` — machine-readable OpenAPI 3.0 spec
- `GET /docs` — Swagger UI (development/staging only; disabled in production)
- All endpoints documented with request/response schemas

**Acceptance criteria:**
- Spec validates with OpenAPI 3.0 validator
- Auth endpoints documented with Bearer security scheme
- Kobo amounts documented with `integer` type and `format: kobo` description

**Tests required:** Spec structure unit test (valid JSON, required fields present)

**Risks:** Manual spec maintenance drift — mitigate with schema-driven approach (Valibot → OpenAPI types)

---

### TASK-18: Fix CI/CD — Add Staging Gate, Coverage Enforcement, Migration Step

**Title:** Harden CI/CD pipeline with staging promotion gate, coverage threshold enforcement, and D1 migration step

**Objective:** The current CI/CD deploys to production on every main branch push with no staging gate, no coverage enforcement gate, and no migration step.

**Why it matters:** A broken deploy can take down the production API for all tenants. D1 migrations must run before the new code that requires them.

**Repo scope:** `webwaka-services`

**Dependencies:** None

**Prerequisites:** `CLOUDFLARE_ACCOUNT_ID`, `CF_API_TOKEN` secrets in GitHub

**Impacted modules:** `.github/workflows/deploy.yml`

**Likely files to change:**
- `.github/workflows/deploy.yml` — restructure into: test → deploy-staging → staging-smoke-test → manual-approve → deploy-production
- Add `wrangler d1 migrations apply --env staging` step before staging deploy
- Add `wrangler d1 migrations apply --env production` step before production deploy
- Add coverage threshold gate using `vitest run --coverage` exit code

**Expected output:**
- PRs deploy to staging only
- Production deploy requires explicit manual approval (GitHub `environment: production` with protection rules)
- Coverage below threshold (80% lines) fails the pipeline
- Migrations run atomically before deploy

**Acceptance criteria:**
- Manual approval gate blocks production deploy
- Coverage report uploaded as artifact
- Migration step runs with `--local` flag for staging dry-run

**Tests required:** CI pipeline test (validate yml syntax, step ordering)

**Risks:** Manual approval gates require GitHub Pro or GitHub Actions paid plan for private repos

---

### TASK-19: Add Client Name Collection to WhatsApp Flow

**Title:** Collect and persist client name during WhatsApp appointment booking

**Objective:** Currently `clientName` is always `null` in the WhatsApp booking flow. Add a name collection step after GREETING.

**Why it matters:** Personalised bot messages ("Your appointment has been booked, Chidi!") significantly increase user satisfaction. Client name is needed for the appointment record.

**Repo scope:** `webwaka-services`

**Dependencies:** TASK-08 (session TTL migration for adding `clientName` to sessions)

**Prerequisites:** Migration to add `clientName TEXT` to `whatsapp_sessions`

**Impacted modules:** `src/modules/appointments/stateMachine.ts`, `src/modules/whatsapp/index.ts`, `src/core/types.ts`

**Likely files to change:**
- New state: `COLLECT_NAME` inserted between `GREETING` and `COLLECT_SERVICE`
- `src/core/types.ts` — add `clientName` to `WhatsAppSession`, add `COLLECT_NAME` to `WhatsAppSessionState`
- `src/modules/appointments/stateMachine.ts` — new `COLLECT_NAME` transition, `MESSAGES.ASK_NAME`
- `src/modules/whatsapp/index.ts` — pass `clientName` to appointment INSERT

**Expected output:**
- Flow: `IDLE → GREETING → COLLECT_NAME → COLLECT_SERVICE → COLLECT_DATE → COLLECT_TIME → CONFIRM → BOOKED`
- `MESSAGES.ASK_NAME`: "What's your name?"
- Name stored in `whatsapp_sessions.clientName` and `appointments.clientName`
- BOOKED message personalised: `"✅ ${clientName}, your appointment has been booked!"`

**Acceptance criteria:**
- Empty/whitespace-only name triggers re-prompt
- Name is trimmed and title-cased before storage
- All existing state machine tests updated for new flow
- New state machine tests for name collection

**Tests required:** Full flow test including name collection, invalid name (empty), personalised BOOKED message

**Risks:** Adding a state adds 1 extra round-trip for all new users — UX cost is acceptable given benefit

---

### TASK-20: Add Media Message Handling + Idempotent Webhook Processing

**Title:** Handle media inbound messages gracefully and add Termii webhook idempotency deduplication

**Objective:** Currently, if a user sends an image or audio message, `parseTermiiInbound` returns null and the webhook returns 400 — causing Termii to retry indefinitely. Add graceful media handling and deduplication.

**Why it matters:** WhatsApp users frequently send photos. A 400 on every photo causes Termii retry loops and message flooding. Deduplication prevents duplicate bookings on webhook retries.

**Repo scope:** `webwaka-services`

**Dependencies:** None

**Prerequisites:** `RATE_LIMIT_KV` for deduplication key storage

**Impacted modules:** `src/core/whatsapp.ts`, `src/modules/whatsapp/index.ts`

**Likely files to change:**
- `src/core/whatsapp.ts` — `parseTermiiInbound()` returns `{ sender, message, isMedia: true }` for media payloads; `message` = empty string triggers media response
- `src/modules/whatsapp/index.ts` — check for `isMedia` flag, reply with `MESSAGES.MEDIA_NOT_SUPPORTED` and return 200
- Add message deduplication using `RATE_LIMIT_KV` with key `msgdedup:{tenantId}:{phone}:{messageHash}` TTL 10 minutes

**Expected output:**
- Media inbound returns 200 with bot reply: "Sorry, I can only process text messages. Please type your response."
- Duplicate webhook (same sender + same message within 10 min) returns 200 silently without re-processing
- `MESSAGES.MEDIA_NOT_SUPPORTED` added to MESSAGES object

**Acceptance criteria:**
- Termii retries are properly absorbed (200 returned, no duplicate processing)
- Media messages get a helpful text reply
- `parseTermiiInbound` returns `{ ..., isMedia: false }` for text, `{ ..., isMedia: true }` for media

**Tests required:** Media payload parse test, deduplication unit test

**Risks:** KV TTL precision — 10 minute window may be too short if Termii retries span longer

---

## 6. QA PLANS

---

### QA-01: Projects CRUD + Schema Migration

**What to verify:**
- Migration 0003 applies without errors and adds `updatedAt` to `projects` table
- Existing project rows get `updatedAt = createdAt` default
- `GET /api/projects` returns paginated results with correct tenant isolation
- `GET /api/projects/:id` returns 404 for unknown ID, 403 for wrong tenant
- `POST /api/projects` with missing `name` returns 400; with `budgetKobo` as float returns 400
- `PATCH /api/projects/:id` updates `updatedAt` and only modified fields
- `DELETE /api/projects/:id` soft-deletes (status = 'cancelled'), does not hard delete
- Role enforcement: `consultant` cannot POST/PATCH/DELETE, only list/read

**Edge cases:** Empty `name` string, `budgetKobo = 0`, `budgetKobo` as negative, `clientId` pointing to non-existent client, `startDate > endDate`, updating a cancelled project

**Regressions:** Verify existing list+create tests still pass after CRUD additions

**Cross-module:** Verify invoices linked to a soft-deleted project still return valid data

**Deployment checks:** Migration applied to staging D1 before code deploy

**Done means:** All 6 endpoints return correct shapes, tenant isolation enforced, validation errors return structured 400s, migration applied

---

### QA-02: Clients CRUD + Duplicate Detection

**What to verify:**
- `GET /api/clients?q=search` returns results matching name, email, or company case-insensitively
- `POST /api/clients` with duplicate email within same tenant returns 409
- Same email for different tenant is allowed (200 expected)
- `PATCH /api/clients/:id` cannot change `tenantId`
- Soft-delete sets status to `inactive`, not actual row deletion
- Deleted clients do not appear in `status=active` filtered list

**Edge cases:** `q=` empty string returns all, `email` with mixed case duplicates, company name with special characters

**Cross-module:** Projects referencing a soft-deleted client still accessible

---

### QA-03: Invoices CRUD + Paystack Initiation

**What to verify:**
- `POST /api/invoices` with `totalKobo != amountKobo + taxKobo` returns 400
- Invoice number format matches `INV-YYYY-MM-{suffix}`, unique per run
- `POST /api/invoices/:id/pay` returns `authorization_url` from mocked Paystack
- `paystackReference` stored on invoice after payment initiation
- Only `draft` or `sent` invoices can be paid (paid/cancelled status returns 409)
- `GET /api/invoices?status=paid&clientId=X` returns only matching invoices for tenant

**Edge cases:** `amountKobo = 0`, duplicate payment initiation (idempotency), `projectId` from different tenant

**Deployment checks:** `PAYSTACK_SECRET_KEY` configured in staging environment

---

### QA-04: Paystack Webhook + Payment Transactions

**What to verify:**
- POST to `/webhook/paystack` with valid HMAC-SHA512 signature is accepted (200)
- POST with invalid/missing signature returns 403
- `charge.success` event: invoice status updated to `paid`, `paidAt` set, `payment_transactions` row created
- `charge.failed` event: `payment_transactions` row created with `failed` status
- Second webhook for same reference: no duplicate DB row, 200 returned (idempotent)
- `GET /api/reports/...` reflects payment totals correctly after webhook

**Edge cases:** Webhook with `reference` not matching any invoice, webhook without `data.reference`, malformed JSON body

**Security checks:** Verify that a request without HMAC header is rejected; verify HMAC uses raw body (not parsed JSON)

---

### QA-05: Valibot Schema Validation

**What to verify:**
- All POST/PATCH routes return structured `{ error, details: [{ field, message }] }` on invalid input
- Required field missing → 400 with specific field named
- `budgetKobo` as float → 400
- `budgetKobo` as negative integer → 400
- Valid request passes without extra validation errors
- `PATCH` with empty body returns 400 "No fields to update"

**Edge cases:** Extra unexpected fields in body (should be stripped or ignored), null values for optional fields

**Regression:** All existing passing routes still accept valid inputs

---

### QA-06: Cursor-Based Pagination

**What to verify:**
- `GET /api/clients` (no cursor) returns first page, `nextCursor` pointing to last item
- `GET /api/clients?cursor=LAST_ID` returns next page correctly
- `GET /api/clients?limit=101` returns 400 "limit too large"
- Last page returns `{ nextCursor: null, hasMore: false }`
- Adding a new item mid-pagination does not cause skipped or duplicated items

**Edge cases:** `limit=0` returns 400, `cursor` pointing to deleted item (skip gracefully), `cursor` from different tenant (returns empty set)

---

### QA-07: Request Logging Middleware

**What to verify:**
- Every request produces a JSON log line with `requestId`, `method`, `path`, `status`, `durationMs`
- `X-Request-ID` header present in every response
- Auth failures are logged (logging runs before auth)
- Sensitive data (Authorization header value) NOT present in logs

**Edge cases:** 404 requests logged, 500 errors logged with error info, health endpoint logged (or explicitly excluded for noise reduction)

---

### QA-08: WhatsApp Session TTL

**What to verify:**
- Session with `expiresAt` in the past is treated as IDLE (user gets GREETING)
- Session with `expiresAt` in the future continues normally
- After processing a message, `expiresAt` updated to `now + 24h`
- Daily cron deletes sessions with `expiresAt < now`
- New session created after expiry starts fresh with no stale data

**Edge cases:** Session expiring mid-conversation (e.g., user waits 25 hours between messages), cron running while webhook is processing (no data corruption)

---

### QA-09: Double-Booking Prevention

**What to verify:**
- Booking slot that is already confirmed/pending returns conflict
- Booking same slot for same tenant by two simultaneous requests: only one succeeds
- Cancelled appointments do NOT block the slot
- Manual REST `POST /api/appointments` for conflicting slot returns 409
- WhatsApp bot shows alternative time message on conflict

**Edge cases:** Booking exactly at end time of existing appointment (30min + 30min, no overlap), different tenants booking same slot (allowed)

---

### QA-10: Appointment Reminders

**What to verify:**
- After booking, reminder KV keys created for 24h and 1h
- Cron at 24h before: sends reminder, deletes KV key
- Cron at 1h before: sends reminder, deletes KV key
- Cancelled appointment: reminder not sent
- Completed appointment: reminder not sent (if cancellation arrives before cron)

**Edge cases:** Appointment booked less than 1h in future (1h reminder already missed, skip gracefully), cron running twice (idempotency via KV key deletion)

---

### QA-11: R2 File Upload/Download

**What to verify:**
- Upload a PDF returns `{ fileKey, url }` with correct R2 prefix
- Tenant A cannot download Tenant B's files
- File type validation rejects `.exe`, `.sh`, `.html`
- File size > 10MB returns 413
- Deleted file returns 404 on subsequent download attempt

**Edge cases:** Empty file upload (0 bytes), same filename uploaded twice (UUID prevents collision), concurrent uploads

---

### QA-12: AI Generation Endpoints

**What to verify:**
- `POST /api/invoices/:id/generate-description` returns non-empty `description` string
- On OpenRouter 429: retry succeeds on second attempt (mock)
- On OpenRouter 5xx: fallback model used, graceful 503 if all fail
- AI rate limit (5 req/min per tenant) triggers 429 after 5 rapid requests
- Sensitive env vars (OPENROUTER_API_KEY) never exposed in error responses

**Edge cases:** Invoice with missing client/project context (partial prompt), non-existent invoiceId (404)

---

### QA-13: i18n Bot Messages

**What to verify:**
- All 7 locales return non-empty strings for all 10+ message keys
- Default locale (`en-NG`) used when session has no locale set
- User sending "Yoruba" sets session locale to `yo-NG` and subsequent messages are in Yoruba
- State machine tests updated to pass locale parameter

**Edge cases:** Unknown locale string from user (ignore, keep current), empty message with locale command

---

### QA-14: Audit Log

**What to verify:**
- Every invoice PATCH creates an audit_log entry
- Audit log entry contains `tenantId`, `userId`, `entityType`, `entityId`, `action`, `timestamp`
- `payload` field does not contain `PAYSTACK_SECRET_KEY` or any env var secrets
- `GET /api/audit?entityType=invoice&entityId=X` returns chronological entries
- Non-admin role cannot access audit log (403)

**Edge cases:** Failed mutation (error mid-handler) does not create audit entry, `waitUntil` audit write failure does not affect main response

---

### QA-15: Revenue Reporting

**What to verify:**
- `GET /api/reports/revenue?year=2026&month=04` returns correct kobo totals for test data
- Zero invoices in month returns `{ totalInvoiced: 0, totalPaid: 0, outstandingAR: 0 }`
- Amounts never returned as naira (always kobo integers)
- Different tenant's invoices not included in totals

**Edge cases:** Month with no data, future month (returns zeroes), invalid month `month=13` (400)

---

### QA-16: Dexie Offline DB Fixes

**What to verify:**
- `db.appointments` table accessible in browser context after version 2 migration
- Mutation with 5 retries marked `failed`, not retried on 6th attempt
- Exponential backoff: 2nd retry waits ~2s, 3rd ~4s (verify delay logic)
- Existing `clients`, `projects`, `invoices` tables unaffected by version migration

**Edge cases:** IndexedDB blocked during version upgrade (pending transaction), corruption recovery

---

### QA-17: OpenAPI Documentation

**What to verify:**
- `GET /openapi.json` returns valid OpenAPI 3.0 JSON
- All authenticated routes show `BearerAuth` security scheme
- `GET /docs` returns Swagger UI HTML in development, 404 in production
- Kobo fields documented as `integer` type with description

**Edge cases:** Spec missing required fields (`info`, `paths`), Swagger UI loading external CDN (check CSP)

---

### QA-18: CI/CD Pipeline Fix

**What to verify:**
- PR to `main`: typecheck + test + staging deploy (no production)
- Merge to `main`: requires manual approval in GitHub "production" environment before deploy
- Coverage below 80%: pipeline fails at coverage gate
- Migration step runs before code deploy (order verified in workflow YAML)
- D1 migration rollback on staging deploy failure

**Edge cases:** Force push to main bypassing approval, migration failure mid-deploy (worker still serves old schema), concurrent PRs applying migrations

---

### QA-19: Client Name Collection in WhatsApp Flow

**What to verify:**
- New user flow: IDLE → GREETING → COLLECT_NAME → COLLECT_SERVICE → ... → BOOKED
- Empty name re-prompts correctly
- Name stored in `appointments.clientName` for new bookings
- BOOKED message contains client name: "✅ {Name}, your appointment is booked!"
- All existing state machine tests still pass (updated for new state)

**Edge cases:** Name with special characters (emojis, numbers), very long name (>100 chars — truncate), returning user (already named — skip COLLECT_NAME if name known in session)

---

### QA-20: Media Handling + Webhook Deduplication

**What to verify:**
- Inbound media message returns 200 with "text only" reply
- Termii retry (same sender + message within 10 min) returns 200 without re-processing state machine
- Two different messages from same sender within 10 min both processed normally (different hash)
- `parseTermiiInbound` returns `isMedia: true` for audio/image payloads

**Edge cases:** Media payload with no `sender` field (null returned, 400), message hash collision (extremely rare — acceptable), deduplication KV write failure (fall through, process normally)

---

## 7. IMPLEMENTATION PROMPTS

---

### IMPL-PROMPT-01: Projects CRUD + Schema Migration

```
You are implementing TASK-01 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, TypeScript strict mode
ECOSYSTEM NOTE: This repository is NOT standalone. It is part of the WebWaka OS v4 multi-repo platform. Auth primitives come from @webwaka/core. Never re-implement JWT, CORS, or rate limiting locally. The tenantId MUST always come from the JWT (via c.get('user').tenantId), NEVER from request headers or body.

OBJECTIVE: Add updatedAt to the projects table via a new D1 migration, then implement complete CRUD for the projects module: GET/:id, PATCH, DELETE (soft), cursor-based pagination on list, status filter, and body validation.

DEPENDENCIES: @webwaka/core requireRole (already imported), D1 binding (c.env.DB)

REQUIRED DELIVERABLES:
1. migrations/0003_projects_updatedAt.sql — ALTER TABLE or CREATE TABLE to add updatedAt column with default
2. src/modules/projects/index.ts — complete 6 endpoints (GET /, GET /:id, POST, PATCH /:id, DELETE /:id)
3. src/core/types.ts — add updatedAt to Project interface
4. Tests for all 6 endpoints using Hono app.request() test client and mocked D1

ACCEPTANCE CRITERIA:
- All monetary values (budgetKobo) validated as positive integers — NEVER floats or naira
- tenantId enforced on every query (WHERE tenantId = ?)
- POST validates: name (required, non-empty), clientId (required), budgetKobo (positive integer), status defaults to 'draft'
- PATCH validates status against ProjectStatus enum
- DELETE soft-deletes (status = 'cancelled'), does not hard delete
- List endpoint supports ?cursor= (last-seen id) and ?limit= (default 20, max 100) and ?status= filter
- 404 returned for unknown ID, 403 for wrong tenant (use 404 to avoid information leakage)
- Migration backward-compatible: existing rows get updatedAt = createdAt

IMPORTANT REMINDERS:
- Invariant 1: Build Once Use Infinitely — use @webwaka/core for auth only
- Invariant 5: Nigeria First — budgetKobo must be integer in kobo
- Invariant 3: Multi-Tenant — ALL queries include tenantId = ?
- Read replit.md and wrangler.toml before starting
- Do not add any new npm dependencies beyond what is already installed
- Do not skip tests — test coverage required for all 6 endpoints
```

---

### IMPL-PROMPT-02: Clients CRUD + Duplicate Detection

```
You are implementing TASK-02 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, TypeScript strict mode
ECOSYSTEM NOTE: This repository is NOT standalone. Part of WebWaka OS v4. tenantId ALWAYS from JWT. Never from headers or body. Auth from @webwaka/core only.

OBJECTIVE: Complete the clients module with GET/:id, PATCH, soft-delete (DELETE), full-text search (?q=), status filter (?status=), and duplicate email detection within a tenant on POST.

REQUIRED DELIVERABLES:
1. src/modules/clients/index.ts — complete 6 endpoints
2. Tests covering: duplicate email (same tenant = 409, different tenant = 201), search, soft-delete, PATCH, GET/:id

ACCEPTANCE CRITERIA:
- POST: check LOWER(email) = LOWER(?) uniqueness within tenantId before INSERT; return 409 on duplicate
- DELETE: sets status = 'inactive', does NOT delete the row
- GET /: supports ?q= (LIKE on name, email, company), ?status= filter, cursor pagination
- GET /:id: 404 for unknown or cross-tenant access
- PATCH: validates only fields provided, rejects empty patch
- Role enforcement: consultant = read only; admin/manager = full write

IMPORTANT REMINDERS:
- Use LOWER() for email comparison
- Soft-delete only — never hard delete client records (they anchor invoices/projects)
- Invariant 3: tenantId on every query
```

---

### IMPL-PROMPT-03: Invoices CRUD + Paystack Payment Initiation

```
You are implementing TASK-03 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, TypeScript strict mode, Paystack API
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4. paystack.ts already implemented — DO NOT re-implement. Use initializePayment() and generatePaymentReference() from src/core/paystack.ts.

OBJECTIVE: Add updatedAt, paidAt, paystackReference columns to invoices via migration. Complete invoices CRUD. Fix invoice number generation. Wire Paystack payment initiation endpoint. Add totalKobo validation.

REQUIRED DELIVERABLES:
1. migrations/0004_invoices_payment_columns.sql — add updatedAt, paidAt, paystackReference
2. src/modules/invoices/index.ts — complete 6 endpoints + POST /:id/pay
3. Tests including: totalKobo mismatch (400), payment initiation mock, status transition validation

ACCEPTANCE CRITERIA:
- POST validates: totalKobo === amountKobo + taxKobo; return 400 on mismatch
- Invoice numbers: INV-{YYYY}-{MM}-{nanoid(6)} format, not Date.now()
- POST /:id/pay: only allowed when status is 'draft' or 'sent'; returns { authorization_url, reference }
- On payment initiation: store paystackReference on invoice row
- PATCH: can update status (draft → sent → paid), dueDate, notes
- Filter: ?status=, ?clientId=, ?projectId=

IMPORTANT REMINDERS:
- ALL amounts are kobo integers — NEVER naira floats
- c.env.PAYSTACK_SECRET_KEY used for initializePayment call
- generatePaymentReference(tenantId) from paystack.ts for reference generation
- Invariant 5: kobo only
- Mock fetch for Paystack in tests — do NOT make real API calls in test suite
```

---

### IMPL-PROMPT-04: Paystack Webhook + payment_transactions Table

```
You are implementing TASK-04 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, Web Crypto API (crypto.subtle)
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4. TASK-03 must be complete first (invoices.paystackReference column exists).

OBJECTIVE: Create a Paystack webhook endpoint at POST /webhook/paystack (unauthenticated, secured by HMAC-SHA512). Verify the x-paystack-signature header against the raw body using crypto.subtle. On charge.success, update invoice status and create payment_transactions row.

REQUIRED DELIVERABLES:
1. migrations/0005_payment_transactions.sql — payment_transactions table
2. src/modules/payments/index.ts — webhook handler
3. src/core/paystack.ts — add verifyPaystackWebhookSignature(rawBody: string, signature: string, secret: string): Promise<boolean> using crypto.subtle.hmac
4. src/worker.ts — register /webhook/paystack route (unauthenticated)
5. Tests: HMAC verification unit test, idempotency test, charge.success handler test

ACCEPTANCE CRITERIA:
- HMAC-SHA512 verification using Web Crypto (crypto.subtle.importKey + crypto.subtle.verify) — not a Node.js crypto module
- Invalid or missing signature → 403 Forbidden
- charge.success: UPDATE invoices SET status='paid', paidAt=now WHERE paystackReference=ref; INSERT payment_transactions row
- Idempotent: second webhook for same reference → SELECT first, if already processed return 200 without re-writing
- All D1 writes in DB.batch() for atomicity
- Webhook returns 200 immediately regardless of processing outcome to prevent Paystack retries

IMPORTANT REMINDERS:
- Use crypto.subtle NOT Node.js crypto — Cloudflare Workers uses Web Crypto API
- NEVER log or expose PAYSTACK_SECRET_KEY
- Invariant 5: all amounts in kobo in payment_transactions
```

---

### IMPL-PROMPT-05: Valibot Schema Validation

```
You are implementing TASK-05 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4.

OBJECTIVE: Install valibot and @hono/valibot-validator. Create schema definitions for all POST and PATCH request bodies. Replace all hand-rolled validation with schema-based validation. Return structured { error, details: [{ field, message }] } on 400.

REQUIRED DELIVERABLES:
1. npm install valibot (lightweight ~1.4kB, NOT Zod)
2. src/schemas/index.ts — CreateProjectSchema, PatchProjectSchema, CreateClientSchema, PatchClientSchema, CreateInvoiceSchema, PatchInvoiceSchema, CreateAppointmentSchema, PatchAppointmentSchema
3. Update all module POST/PATCH handlers to use @hono/valibot-validator middleware
4. Tests: invalid input schema tests for each schema

ACCEPTANCE CRITERIA:
- budgetKobo, amountKobo, taxKobo, totalKobo: integer(), minValue(1) validators
- All required string fields: string(), minLength(1) validators
- Status fields: picklist([...]) validator against valid enum values
- 400 response shape: { error: 'Validation failed', details: [{ field: 'name', message: 'Required' }] }
- Valid inputs pass unchanged
- Bundle size does not significantly increase (valibot is <2kB)

IMPORTANT REMINDERS:
- Use valibot, NOT zod (bundle size concern for edge Workers)
- Invariant 5: kobo must be integer, minValue(0) is NOT acceptable — use minValue(1) for amounts
- Do NOT change any auth logic
```

---

### IMPL-PROMPT-06: Cursor-Based Pagination

```
You are implementing TASK-06 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4.

OBJECTIVE: Add cursor-based pagination to all 4 list endpoints (clients, projects, invoices, appointments). Create a shared pagination helper. Return consistent { data, nextCursor, hasMore } shape.

REQUIRED DELIVERABLES:
1. src/core/pagination.ts — buildCursorQuery(baseQuery, bindings, cursor, limit) helper
2. Update src/modules/clients/index.ts, projects/index.ts, invoices/index.ts, appointments/index.ts GET / handlers
3. src/core/types.ts — add PaginatedResponse<T> interface
4. Tests for pagination behavior

ACCEPTANCE CRITERIA:
- Default limit = 20, max limit = 100; limit > 100 returns 400
- Cursor = last-seen id from previous page; encoded as base64 to prevent direct manipulation
- Query uses WHERE id > ? ORDER BY id ASC LIMIT ? pattern (after tenantId filter)
- Empty result returns { data: [], nextCursor: null, hasMore: false }
- Invalid cursor returns empty result gracefully (does not 500)

IMPORTANT REMINDERS:
- D1 does not support server-side cursors — cursor is client-side last-seen-id
- Invariant 3: cursor must be scoped to tenantId (no cross-tenant cursor leakage)
- Do NOT use OFFSET — it is inefficient and inconsistent in D1
```

---

### IMPL-PROMPT-07: Request Logging Middleware

```
You are implementing TASK-07 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4.

OBJECTIVE: Implement a structured JSON request logging middleware that logs every request with correlation ID, method, path, status, duration, and tenantId. Add X-Request-ID to all responses.

REQUIRED DELIVERABLES:
1. src/middleware/logging.ts — loggingMiddleware() using Hono middleware pattern
2. src/worker.ts — register loggingMiddleware as first middleware (before secureCORS, before auth)
3. Tests: verify log shape, verify X-Request-ID header presence

ACCEPTANCE CRITERIA:
- Every request logs: { requestId: UUID, method, path, status, durationMs, tenantId?: string, timestamp: ISO string }
- X-Request-ID: {requestId} header set on ALL responses including errors
- Duration measured using performance.now()
- Sensitive data (Authorization header content) NEVER logged
- requestId generated with crypto.randomUUID() per request
- Log output via console.log (JSON.stringify) — visible in Cloudflare Workers tail logs

IMPORTANT REMINDERS:
- Middleware registered BEFORE auth so failed auth requests are also logged
- tenantId extracted from c.get('user')?.tenantId — may be undefined for unauthenticated routes (log as null)
- Never log raw Authorization header value
```

---

### IMPL-PROMPT-08: WhatsApp Session TTL + Cleanup Cron

```
You are implementing TASK-08 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, Cloudflare Cron Triggers
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4.

OBJECTIVE: Add expiresAt column to whatsapp_sessions. Sessions older than 24h are treated as IDLE. Add a daily cron trigger (2am UTC) to DELETE expired sessions from D1.

REQUIRED DELIVERABLES:
1. migrations/0006_session_ttl.sql — ALTER TABLE whatsapp_sessions ADD COLUMN expiresAt TEXT
2. src/modules/whatsapp/index.ts — check expiresAt before processing; refresh expiresAt on every message
3. src/cron/cleanupSessions.ts — scheduled handler: DELETE FROM whatsapp_sessions WHERE expiresAt < ?
4. wrangler.toml — add [triggers] crons = ["0 2 * * *"]
5. src/worker.ts — export scheduled = cleanupSessions handler
6. Tests: expiry check unit test, cron handler unit test

ACCEPTANCE CRITERIA:
- On inbound message: if expiresAt < now, reset session to IDLE and update expiresAt = now + 24h
- On every successful message processing: expiresAt updated to now + 24h
- Cron deletes sessions where expiresAt < current UTC ISO string
- Migration backward-compatible: NULL expiresAt treated as expired if updatedAt < now - 24h
- Cron export named `scheduled` in worker.ts exports

IMPORTANT REMINDERS:
- Cloudflare Workers scheduled handler signature: scheduled(event, env, ctx)
- Do NOT use JavaScript setTimeout for scheduling — use cron triggers
- Invariant 3: Session cleanup must NOT delete sessions from other tenants (WHERE is unbounded by tenantId here — global cleanup is OK as cron runs as system, not as tenant user)
```

---

### IMPL-PROMPT-09: Double-Booking Prevention

```
You are implementing TASK-09 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4.

OBJECTIVE: Prevent double-bookings by checking for existing appointments at the same scheduledAt before committing a new booking. Add the check to both the WhatsApp flow and the REST POST /api/appointments endpoint.

REQUIRED DELIVERABLES:
1. src/core/appointmentConflict.ts — checkForConflict(db: D1Database, tenantId: string, scheduledAt: string, durationMinutes: number): Promise<boolean>
2. src/modules/whatsapp/index.ts — call checkForConflict before INSERT; on conflict reply with MESSAGES.SLOT_TAKEN and reset to COLLECT_TIME
3. src/modules/appointments/index.ts — call checkForConflict before POST INSERT; return 409 on conflict
4. Add MESSAGES.SLOT_TAKEN to stateMachine.ts
5. Tests: conflict detection, concurrent booking simulation

ACCEPTANCE CRITERIA:
- Conflict query: SELECT id FROM appointments WHERE tenantId=? AND status IN ('pending','confirmed') AND scheduledAt=?
- On conflict in WhatsApp: MESSAGES.SLOT_TAKEN sent, state stays COLLECT_TIME, collectedTime cleared
- On conflict in REST: 409 { error: 'Appointment slot already booked', scheduledAt }
- Different tenants can book the same slot (tenant isolation)
- Cancelled appointments do NOT block the slot

IMPORTANT REMINDERS:
- Add a D1 UNIQUE INDEX ON appointments(tenantId, scheduledAt) as backstop in a migration — this provides database-level conflict prevention even under race conditions
- The index should allow NULL tenantId? No — tenantId is always NOT NULL
```

---

### IMPL-PROMPT-10: Appointment Reminder Scheduling

```
You are implementing TASK-10 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, Cloudflare KV, Cloudflare Cron Triggers
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4. Notifications via @webwaka/core/notifications (NotificationService → sendWhatsAppMessage in core/whatsapp.ts).

OBJECTIVE: After each appointment booking (WhatsApp or REST), enqueue 24h and 1h reminder jobs. An hourly cron trigger sends pending reminders.

REQUIRED DELIVERABLES:
1. src/cron/reminders.ts — scheduled handler: query appointments within next 25h and 2h, send reminders via sendWhatsAppMessage, update reminder_sent flags
2. migrations/0008_appointment_reminders.sql — add reminder_24h_sent INTEGER DEFAULT 0, reminder_1h_sent INTEGER DEFAULT 0 to appointments
3. src/modules/whatsapp/index.ts — after BOOKED commit, no additional KV needed if using D1 flags
4. wrangler.toml — add hourly cron "0 * * * *"
5. MESSAGES.REMINDER_24H(service, display) and MESSAGES.REMINDER_1H(service, display) in stateMachine.ts
6. Tests: reminder cron unit test with mocked D1 and sendWhatsAppMessage

ACCEPTANCE CRITERIA:
- Cron selects appointments where: status IN ('pending','confirmed') AND reminder_24h_sent=0 AND scheduledAt BETWEEN now+23h AND now+25h
- After sending 24h reminder: UPDATE appointments SET reminder_24h_sent=1
- Same logic for 1h reminder with reminder_1h_sent
- sendWhatsAppMessage called with tenantId, clientPhone, reminder body
- Cancelled/completed appointments skipped

IMPORTANT REMINDERS:
- Time window query uses UTC ISO strings — WAT offset not needed server-side
- c.env.TERMII_API_KEY and TERMII_WHATSAPP_SENDER_ID required in cron env
- Use executionCtx.waitUntil() for non-blocking reminder sends if applicable
```

---

### IMPL-PROMPT-11: R2 File Upload/Download

```
You are implementing TASK-11 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare R2
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4. MEDIA_BUCKET R2 binding already configured in wrangler.toml.

OBJECTIVE: Add file upload, download, and delete endpoints for client/project documents. Files stored in R2 under tenant-scoped prefixes.

REQUIRED DELIVERABLES:
1. src/modules/files/index.ts — filesRouter with upload/download/delete
2. src/worker.ts — register /api/files route
3. Tests with mocked R2 binding

ACCEPTANCE CRITERIA:
- POST /api/files/upload?entityType=client&entityId=X — multipart/form-data, single file, stored at {tenantId}/{entityType}/{entityId}/{uuid}.{ext}
- GET /api/files/:fileKey — stream R2 object as response with correct Content-Type
- DELETE /api/files/:fileKey — remove from R2; verify tenantId prefix before delete
- Max size: 10MB (check Content-Length header); return 413 if exceeded
- Allowed MIME types: application/pdf, image/png, image/jpeg, application/vnd.openxmlformats-officedocument.wordprocessingml.document
- fileKey is the full R2 key: {tenantId}/{entityType}/{entityId}/{uuid}.{ext}
- Tenant isolation enforced by key prefix check (key.startsWith(tenantId))

IMPORTANT REMINDERS:
- R2 does not require presigned URLs in Workers — direct c.env.MEDIA_BUCKET.get(key) works
- Never expose other tenants' R2 keys
- Content-Disposition: attachment header on download
```

---

### IMPL-PROMPT-12: AI Invoice and Proposal Generation

```
You are implementing TASK-12 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, OpenRouter API (via src/core/ai.ts)
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4. Invariant 7: Vendor Neutral AI — ALL AI calls via OpenRouter, NEVER directly to OpenAI/Anthropic. ai.ts already implemented — extend it, do not replace it.

OBJECTIVE: Add model fallback chain and retry logic to ai.ts. Wire AI into two new endpoints: POST /api/invoices/:id/generate-description and POST /api/projects/:id/generate-proposal.

REQUIRED DELIVERABLES:
1. src/core/ai.ts — add getAICompletionWithFallback(apiKey, params, modelChain?) using model array fallback
2. src/modules/invoices/index.ts — POST /:id/generate-description
3. src/modules/projects/index.ts — POST /:id/generate-proposal
4. Tests: mock fetch for OpenRouter, retry on 429, fallback on 5xx

ACCEPTANCE CRITERIA:
- Default model chain: ['anthropic/claude-3-haiku', 'google/gemini-flash-1.5', 'meta-llama/llama-3.1-8b-instruct:free']
- Retry on 429 (rate limited): 3 retries with exponential backoff (1s, 2s, 4s)
- Fallback on model 5xx: try next model in chain
- If all models fail: return 503 { error: 'AI service temporarily unavailable' }
- Rate limit: max 5 AI requests per tenant per minute using RATE_LIMIT_KV
- Token usage logged: console.log({ event: 'ai_completion', model, tokens, tenantId })
- OPENROUTER_API_KEY NEVER in error response or logs

IMPORTANT REMINDERS:
- Invariant 7: OpenRouter only — never call OpenAI API directly
- c.executionCtx.waitUntil() NOT needed here — AI response is synchronous/awaited
- Nigeria-First system prompt: reference Nigerian business context, naira amounts should mention kobo equivalent
```

---

### IMPL-PROMPT-13: i18n Bot Messages

```
You are implementing TASK-13 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4. Invariant 6: Africa First — 7 locales. i18n/index.ts already has SUPPORTED_LOCALES.

OBJECTIVE: Add localised bot message translations to the i18n module. Wire locale parameter into the WhatsApp state machine. Persist locale in whatsapp_sessions.

REQUIRED DELIVERABLES:
1. src/i18n/index.ts — BOT_MESSAGES: Record<BotMessageKey, Record<SupportedLocale, string>> — all message keys for all 7 locales
2. src/modules/appointments/stateMachine.ts — MESSAGES factory functions accept locale: SupportedLocale param (default 'en-NG')
3. migrations/0009_session_locale.sql — ADD COLUMN locale TEXT DEFAULT 'en-NG' to whatsapp_sessions
4. src/modules/whatsapp/index.ts — detect locale from session; allow locale setting ("Yoruba"/"Hausa"/"French" → set locale)
5. Tests: all locales non-empty, locale selection flow, personalised messages per locale

ACCEPTANCE CRITERIA:
- All 7 locales return non-empty translated strings for: GREETING, ASK_DATE, ASK_TIME, CONFIRM, BOOKED, CANCELLED, INVALID_SERVICE, INVALID_DATE, INVALID_TIME, ERROR
- English (en-NG) remains the default and highest quality translation
- User sending "Yoruba" updates session.locale = 'yo-NG'
- Existing tests updated to pass default locale ('en-NG') and still pass

IMPORTANT REMINDERS:
- Yoruba and Hausa translations should be marked as DRAFT in comments if professional translation not yet available
- SupportedLocale type already defined in i18n/index.ts — use it, do not redefine
```

---

### IMPL-PROMPT-14: Audit Log

```
You are implementing TASK-14 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4. Auth from @webwaka/core. executionCtx.waitUntil() available for non-blocking background writes.

OBJECTIVE: Add an immutable audit_log D1 table. Add audit logging middleware applied to invoice and appointment mutation routes. Add GET /api/audit read endpoint (admin only).

REQUIRED DELIVERABLES:
1. migrations/0007_audit_log.sql — audit_log table (id, tenantId, userId, entityType, entityId, action, oldStatus, newStatus, payload TEXT, timestamp)
2. src/middleware/audit.ts — auditLog(entityType: string, action: string) Hono middleware factory
3. Apply to: PATCH /api/invoices/:id, POST /api/invoices/:id/pay, PATCH /api/appointments/:id, DELETE /api/appointments/:id
4. GET /api/audit?entityType=&entityId= (requireRole(['admin']) only)
5. Tests: middleware unit test, payload sanitisation test (no secrets in payload)

ACCEPTANCE CRITERIA:
- Audit write uses c.executionCtx.waitUntil() — non-blocking
- payload is JSON.stringify of request body with sensitive fields stripped (no keys containing 'secret', 'key', 'token', 'password')
- audit_log has no UPDATE or DELETE endpoints — append only
- GET /api/audit returns { data: [...], count } ordered by timestamp DESC

IMPORTANT REMINDERS:
- NEVER hard-delete audit_log rows — this is an immutable trail
- Invariant 3: tenantId enforced on audit_log reads
- userId from c.get('user').sub (JWT subject)
```

---

### IMPL-PROMPT-15: Revenue Reporting

```
You are implementing TASK-15 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4. TASKS 01-04 must be complete. All monetary values in kobo.

OBJECTIVE: Add reporting endpoints for monthly revenue, appointment statistics, and top clients. All amounts in kobo integers.

REQUIRED DELIVERABLES:
1. src/modules/reports/index.ts — reportsRouter
2. src/worker.ts — register /api/reports (admin only)
3. Tests with seeded D1 data (in-memory or mocked)

ACCEPTANCE CRITERIA:
- GET /api/reports/revenue?year=2026&month=04 returns: { totalInvoicedKobo, totalPaidKobo, outstandingARKobo, invoiceCount, paidCount }
- GET /api/reports/appointments?year=2026&month=04 returns: { total, pending, confirmed, cancelled, completed }
- GET /api/reports/clients returns top 5 clients by totalInvoicedKobo (include clientId, name, totalKobo)
- Invalid month (>12 or <1) returns 400
- Zero data returns zeroes, not null
- All kobo fields are integers

IMPORTANT REMINDERS:
- SUM(totalKobo) in D1 returns integer — correct
- Invariant 5: NEVER convert to naira in response — always kobo
- Invariant 3: tenantId in all aggregate queries
- requireRole(['admin']) on all report endpoints
```

---

### IMPL-PROMPT-16: Dexie Offline DB Fixes

```
You are implementing TASK-16 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Browser/PWA context, Dexie.js v3, IndexedDB, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4. Invariant 4: Offline First — Dexie is the client-side offline layer.

OBJECTIVE: Add appointments table to Dexie DB (version 2 migration). Add max retry cap (5 retries) and exponential backoff to processMutationQueue. Add syncStatus table.

REQUIRED DELIVERABLES:
1. src/db/db.ts — version(2) schema with appointments table, syncStatus table
2. processMutationQueue() — skip entries with retryCount >= 5; mark as failed; add delay backoff
3. enqueueMutation() — unchanged interface
4. Tests: retry cap test, backoff test (mock delay), appointments table access test

ACCEPTANCE CRITERIA:
- db.appointments table: 'id, tenantId, clientPhone, scheduledAt, status' indexes
- MAX_RETRY_COUNT = 5; entries at or above are marked { failed: true }, not deleted
- Backoff delay: 2^retryCount seconds between retries
- syncStatus table: 'entity' primary key, lastSyncedAt, pendingCount fields
- Version 2 migration preserves existing clients/projects/invoices/mutationQueue data

IMPORTANT REMINDERS:
- Dexie version migrations must be additive — never remove columns in version upgrades
- This code runs in browser/PWA context — not in Cloudflare Workers
- processMutationQueue delay must be real async delay, not just loop counting
```

---

### IMPL-PROMPT-17: OpenAPI Documentation

```
You are implementing TASK-17 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4.

OBJECTIVE: Add OpenAPI 3.0 spec document and Swagger UI. Swagger UI only served in non-production environments.

REQUIRED DELIVERABLES:
1. src/openapi/spec.ts — complete OpenAPI 3.0 document as TypeScript object
2. src/worker.ts — GET /openapi.json (always available), GET /docs (only if ENVIRONMENT !== 'production')
3. Tests: spec structure validation (required fields), /docs 404 in production

ACCEPTANCE CRITERIA:
- openapi.json validates as valid OpenAPI 3.0
- All /api/* endpoints documented with request/response schemas
- BearerAuth security scheme applied to /api/* routes
- Webhook endpoints documented as unauthenticated
- Integer fields with kobo amounts documented with description: 'Amount in kobo (NGN × 100)'
- /docs returns 404 in production environment

IMPORTANT REMINDERS:
- Check c.env.ENVIRONMENT to gate /docs
- Kobo fields are integer type, not number — use { type: 'integer', description: 'Amount in kobo' }
```

---

### IMPL-PROMPT-18: CI/CD Pipeline Fix

```
You are implementing TASK-18 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: GitHub Actions, Cloudflare Wrangler Action v3
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4.

OBJECTIVE: Harden the CI/CD pipeline. Add coverage enforcement gate. Add D1 migration step before each deploy. Add manual approval gate before production deploy. Separate staging and production jobs.

REQUIRED DELIVERABLES:
1. .github/workflows/deploy.yml — restructured with 3 jobs: test, deploy-staging, deploy-production
2. deploy-staging job: runs on PR; includes wrangler d1 migrations apply --env staging; deploys to staging
3. deploy-production job: runs on main merge; requires manual-approval environment; includes migration step; deploys to production
4. Coverage gate: vitest --coverage fails pipeline if below 80% lines threshold

ACCEPTANCE CRITERIA:
- PRs only deploy to staging — production deploy blocked
- deploy-production has needs: [deploy-staging] and environment: production (with required reviewers)
- Coverage report uploaded as GitHub Actions artifact
- Migration step: `wrangler d1 migrations apply --env staging --remote` before staging deploy
- Migration step: `wrangler d1 migrations apply --env production --remote` before production deploy (after approval)
- Lint step added (npm run typecheck)

IMPORTANT REMINDERS:
- GitHub environment protection rules must be configured separately in GitHub repo settings
- CF_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be in GitHub Secrets
- Do not break existing test or typecheck steps
```

---

### IMPL-PROMPT-19: Client Name Collection in WhatsApp Flow

```
You are implementing TASK-19 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4.

OBJECTIVE: Add COLLECT_NAME state to the WhatsApp state machine between GREETING and COLLECT_SERVICE. Collect, validate, and persist client name in session and appointment records.

REQUIRED DELIVERABLES:
1. src/core/types.ts — add 'COLLECT_NAME' to WhatsAppSessionState union; add clientName to WhatsAppSession
2. migrations/0010_session_client_name.sql — ADD COLUMN clientName TEXT to whatsapp_sessions
3. src/modules/appointments/stateMachine.ts — add COLLECT_NAME state transitions, MESSAGES.ASK_NAME, name validation (non-empty, trimmed)
4. src/modules/whatsapp/index.ts — pass clientName from session to appointment INSERT
5. BOOKED message updated: MESSAGES.BOOKED(display, id, clientName?)
6. All existing state machine tests updated for new flow
7. New tests for COLLECT_NAME state

ACCEPTANCE CRITERIA:
- Empty/whitespace name stays COLLECT_NAME with re-prompt
- Name trimmed and stored (not title-cased programmatically — leave as user typed)
- appointments.clientName populated from session on BOOKED
- BOOKED message: "✅ {clientName}, your appointment has been booked!" if name provided
- Global restart ("hi"/"book") clears clientName from session (isRestartingToGreeting logic)

IMPORTANT REMINDERS:
- Add 'COLLECT_NAME' to WhatsAppSessionState — this is a type change, update all exhaustive switches
- whatsapp_sessions migration must be backward-compatible (NULL clientName allowed)
```

---

### IMPL-PROMPT-20: Media Handling + Webhook Deduplication

```
You are implementing TASK-20 in the webwaka-services repository.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare KV, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone. Part of WebWaka OS v4.

OBJECTIVE: Handle inbound media messages gracefully (reply with text-only message, return 200). Add deduplication of Termii webhook retries using RATE_LIMIT_KV.

REQUIRED DELIVERABLES:
1. src/core/whatsapp.ts — update parseTermiiInbound to return isMedia: boolean; detect media by presence of media field or missing message
2. src/modules/whatsapp/index.ts — check isMedia flag; send MESSAGES.MEDIA_NOT_SUPPORTED; return 200
3. src/modules/whatsapp/index.ts — deduplication: hash sender+message, check/set KV key msgdedup:{tenantId}:{hash} with 10min TTL
4. MESSAGES.MEDIA_NOT_SUPPORTED in stateMachine.ts
5. Tests: media parse test, deduplication unit test

ACCEPTANCE CRITERIA:
- Media inbound: isMedia=true, reply MEDIA_NOT_SUPPORTED, return 200 (not 400)
- Text inbound: isMedia=false, process normally
- Deduplication key: `msgdedup:${tenantId}:${sha256hash(sender+message)}`; use crypto.subtle.digest for hash
- KV put with expirationTtl: 600 (10 minutes)
- Duplicate detected: return 200 silently without re-running state machine
- First occurrence: process normally, then set dedup KV key via executionCtx.waitUntil()

IMPORTANT REMINDERS:
- crypto.subtle.digest returns ArrayBuffer — convert to hex for KV key
- RATE_LIMIT_KV is already bound — use it for deduplication (no new binding needed)
- Return 200 on media messages — NOT 400 — to prevent Termii retry loops
```

---

## 8. QA PROMPTS

---

### QA-PROMPT-01: QA — Projects CRUD

```
You are the QA engineer for the webwaka-services repository, verifying TASK-01 implementation.

REPOSITORY: webwaka-services
PLATFORM: Cloudflare Workers, Hono v4.4, Cloudflare D1, TypeScript strict mode
ECOSYSTEM NOTE: Not standalone — part of WebWaka OS v4. tenantId always from JWT. All monetary amounts in kobo.

OBJECTIVE: Verify that the complete Projects CRUD implementation is correct, secure, and well-tested.

VERIFICATION CHECKLIST:
1. Run npm test — all tests must pass, coverage >= 80%
2. Run npm run typecheck — zero TypeScript errors
3. Verify migration 0003 applies without errors: wrangler d1 migrations apply --local
4. Verify updatedAt column added to projects table with default value for existing rows
5. Test GET /api/projects: returns { data, nextCursor, hasMore }; cursor pagination works
6. Test GET /api/projects?status=active: filters correctly
7. Test GET /api/projects/:id with valid JWT: returns single project
8. Test GET /api/projects/:id with wrong tenant JWT: returns 404 (not 403 — no info leakage)
9. Test POST /api/projects with missing name: returns 400 with { error, details }
10. Test POST /api/projects with budgetKobo = 99.50 (float): returns 400
11. Test POST /api/projects with budgetKobo = -1000: returns 400
12. Test PATCH /api/projects/:id with invalid status: returns 400
13. Test DELETE /api/projects/:id: row still exists with status = 'cancelled'
14. Test role enforcement: consultant cannot POST (403)

BUG PATTERNS TO CHECK:
- tenantId NOT in WHERE clause (check all SQL strings)
- budgetKobo stored as float (check D1 schema column type INTEGER)
- updatedAt not set on PATCH
- Cursor pagination using OFFSET instead of WHERE id > ?
- Sensitive data in error messages

REGRESSION CHECKS:
- Original GET /api/projects list still works after pagination addition
- Original POST /api/projects still works after validation addition

DONE CRITERIA: All 14 checks pass, npm test passes, typecheck passes, migration applies cleanly.
```

---

### QA-PROMPT-02: QA — Clients CRUD

```
You are the QA engineer for the webwaka-services repository, verifying TASK-02.

REPOSITORY: webwaka-services
ECOSYSTEM NOTE: Not standalone — part of WebWaka OS v4.

OBJECTIVE: Verify complete Clients CRUD including duplicate detection, soft-delete, and search.

VERIFICATION CHECKLIST:
1. Run npm test — all new client tests pass
2. POST duplicate email same tenant → 409; different tenant → 201
3. POST duplicate email case-insensitive: POST 'Chidi@Test.com', then POST 'chidi@test.com' same tenant → 409
4. GET /api/clients?q=abc — returns clients where name, email, OR company contains 'abc' case-insensitively
5. GET /api/clients?status=active — returns only active clients
6. DELETE /api/clients/:id — row still exists, status = 'inactive'
7. PATCH /api/clients/:id — updates only provided fields; updatedAt changes
8. consultant role: POST returns 403, GET returns 200

BUG PATTERNS:
- Email comparison not using LOWER() — case-sensitive false negative
- Hard delete instead of soft delete
- tenantId leaked in duplicate check (checking across tenants)

DONE CRITERIA: All checks pass, npm test passes.
```

---

### QA-PROMPT-03: QA — Invoices CRUD + Paystack

```
You are the QA engineer for the webwaka-services repository, verifying TASK-03.

REPOSITORY: webwaka-services
ECOSYSTEM NOTE: Not standalone. PAYSTACK calls must be mocked in tests.

VERIFICATION CHECKLIST:
1. POST /api/invoices with totalKobo = 10000, amountKobo = 8000, taxKobo = 1000 → 400 (mismatch)
2. POST /api/invoices with totalKobo = 9000, amountKobo = 8000, taxKobo = 1000 → 201
3. Invoice number format: matches /^INV-\d{4}-\d{2}-[A-Za-z0-9]+$/
4. Two invoices created in rapid succession have DIFFERENT invoice numbers
5. POST /api/invoices/:id/pay — invoice in 'draft' status → 200 with authorization_url
6. POST /api/invoices/:id/pay — invoice already 'paid' → 409
7. GET /api/invoices?status=paid → only paid invoices
8. Migration 0004 applied cleanly, updatedAt and paidAt and paystackReference columns exist

BUG PATTERNS:
- Date.now() collision in invoice number (test with rapid creation)
- totalKobo validation skipped
- Paystack secret exposed in error messages

DONE CRITERIA: All checks pass, mock Paystack fetch works in tests.
```

---

### QA-PROMPT-04: QA — Paystack Webhook

```
You are the QA engineer verifying TASK-04 implementation.

REPOSITORY: webwaka-services
ECOSYSTEM NOTE: Not standalone. HMAC verification uses Web Crypto API (crypto.subtle) — not Node.js crypto.

VERIFICATION CHECKLIST:
1. POST /webhook/paystack with valid HMAC-SHA512 signature → 200
2. POST /webhook/paystack with wrong signature → 403
3. POST /webhook/paystack without x-paystack-signature header → 403
4. charge.success event: invoice status = 'paid', paidAt set, payment_transactions row created
5. Same webhook sent twice: second call returns 200 but does NOT create second payment_transactions row
6. charge.failed event: payment_transactions row with status='failed' created
7. Webhook for unknown reference → 200 (graceful, no 500)

SECURITY CHECKS:
- HMAC verification uses raw body bytes before JSON parsing
- PAYSTACK_SECRET_KEY never logged or returned in response

DONE CRITERIA: All checks pass, HMAC test uses real SHA512 verification logic.
```

---

### QA-PROMPT-05: QA — Valibot Validation

```
You are the QA engineer verifying TASK-05 implementation.

REPOSITORY: webwaka-services

VERIFICATION CHECKLIST:
1. POST /api/projects with body {} → 400, details contains 'name' field error
2. POST /api/projects with budgetKobo: 1000.5 → 400 (not integer)
3. POST /api/projects with budgetKobo: 0 → 400 (not positive)
4. POST /api/projects with budgetKobo: -500 → 400
5. PATCH /api/projects/:id with status: 'invalid_status' → 400
6. PATCH /api/projects/:id with empty body → 400
7. Valid POST request passes all validation → 201
8. npm run typecheck passes (schemas are type-safe)

DONE CRITERIA: All boundary cases produce structured 400s, valid inputs succeed.
```

---

### QA-PROMPT-06: QA — Pagination

```
You are the QA engineer verifying TASK-06 implementation.

REPOSITORY: webwaka-services

VERIFICATION CHECKLIST:
1. GET /api/clients (20 clients in DB) → returns 20 items, nextCursor: null
2. GET /api/clients (25 clients, limit=10) → 10 items, nextCursor non-null
3. GET /api/clients?cursor=PREV_CURSOR (using cursor from above) → next 10 items, no overlap
4. GET /api/clients?limit=200 → 400 'limit exceeds maximum of 100'
5. GET /api/clients?limit=0 → 400
6. Empty DB → { data: [], nextCursor: null, hasMore: false }
7. Invalid cursor → empty result, no 500

DONE CRITERIA: Full pagination flow works end-to-end.
```

---

### QA-PROMPT-07: QA — Request Logging

```
You are the QA engineer verifying TASK-07 implementation.

REPOSITORY: webwaka-services

VERIFICATION CHECKLIST:
1. Any request → response contains X-Request-ID header (UUID format)
2. All requests → console.log output is valid JSON with requestId, method, path, status, durationMs
3. Failed auth request → still logged (loggingMiddleware runs before auth)
4. Log output does NOT contain Authorization header value
5. X-Request-ID is different for every request

DONE CRITERIA: All checks pass, no sensitive data in logs.
```

---

### QA-PROMPT-08: QA — Session TTL

```
You are the QA engineer verifying TASK-08 implementation.

REPOSITORY: webwaka-services

VERIFICATION CHECKLIST:
1. Session with expiresAt = 25h ago → on next inbound message, state reset to IDLE, user receives GREETING
2. Session with expiresAt = 1h from now → processes normally
3. After processing: expiresAt updated to ~now + 24h (within 1 minute tolerance)
4. Cron handler deletes rows with expiresAt < now (unit test with mocked DB.prepare)
5. Migration 0006 adds expiresAt to whatsapp_sessions without destroying existing rows

DONE CRITERIA: Expiry detection works, cron deletes correct rows.
```

---

### QA-PROMPT-09: QA — Double-Booking Prevention

```
You are the QA engineer verifying TASK-09 implementation.

REPOSITORY: webwaka-services

VERIFICATION CHECKLIST:
1. Book slot 2026-05-01T10:00:00.000Z → 201 success
2. Book same slot same tenant → 409 or SLOT_TAKEN bot message
3. Book same slot different tenant → 201 (allowed)
4. Cancelled appointment: book same slot same tenant → 201 (cancelled doesn't block)
5. WhatsApp SLOT_TAKEN scenario: state stays COLLECT_TIME, collectedTime cleared
6. D1 UNIQUE INDEX on appointments(tenantId, scheduledAt) exists

DONE CRITERIA: All conflict scenarios handled correctly.
```

---

### QA-PROMPT-10: QA — Appointment Reminders

```
You are the QA engineer verifying TASK-10 implementation.

REPOSITORY: webwaka-services

VERIFICATION CHECKLIST:
1. Cron runs: appointments in 23h-25h range with reminder_24h_sent=0 receive reminder
2. After 24h reminder sent: reminder_24h_sent=1 updated
3. Cron runs again: same appointment NOT reminded twice (idempotent)
4. Cancelled appointment: reminder NOT sent
5. MESSAGES.REMINDER_24H and REMINDER_1H exist and are non-empty strings
6. Migration 0008 adds reminder columns

DONE CRITERIA: Cron is idempotent, reminders sent correctly, no double-sends.
```

---

### QA-PROMPT-11: QA — R2 File Upload

```
You are the QA engineer verifying TASK-11 implementation.

REPOSITORY: webwaka-services

VERIFICATION CHECKLIST:
1. Upload PDF → 201, fileKey has {tenantId}/ prefix
2. Download file with correct JWT → 200, correct Content-Type
3. Download file with different tenant JWT → 404 (tenant prefix mismatch)
4. Upload .exe file → 400 (disallowed type)
5. Upload 11MB file → 413
6. Delete file → 204; subsequent GET → 404

DONE CRITERIA: Tenant isolation enforced in R2 keys, file type and size validation working.
```

---

### QA-PROMPT-12: QA — AI Generation

```
You are the QA engineer verifying TASK-12 implementation.

REPOSITORY: webwaka-services

VERIFICATION CHECKLIST:
1. POST /api/invoices/:id/generate-description with mocked OpenRouter → 200, non-empty description
2. OpenRouter mock returns 429 twice then 200 → 200 returned after retries
3. All 3 models fail → 503 { error: 'AI service temporarily unavailable' }
4. 6th AI request in 1 minute from same tenant → 429 rate limit
5. OPENROUTER_API_KEY never in response body or console.log output
6. Token usage logged: console.log contains { event: 'ai_completion', model, tokens }

DONE CRITERIA: All fallback, retry, rate limit, and secret protection checks pass.
```

---

### QA-PROMPT-13: QA — i18n Bot Messages

```
You are the QA engineer verifying TASK-13 implementation.

VERIFICATION CHECKLIST:
1. All 7 locales × 10 message keys → no empty strings
2. Default locale (en-NG) works when session.locale is undefined or null
3. User sends "Yoruba" → next message is in yo-NG locale
4. User sends "French" → next message is in fr-CI locale
5. All existing stateMachine tests pass (updated for locale param)

DONE CRITERIA: All locales non-empty, locale switching works.
```

---

### QA-PROMPT-14: QA — Audit Log

```
You are the QA engineer verifying TASK-14 implementation.

VERIFICATION CHECKLIST:
1. PATCH /api/invoices/:id → audit_log row created with correct entityType/entityId/action
2. audit_log payload does NOT contain any value from c.env (no PAYSTACK_SECRET_KEY etc.)
3. GET /api/audit as admin → returns entries
4. GET /api/audit as consultant → 403
5. No DELETE endpoint exists for audit_log (append-only enforcement)

DONE CRITERIA: Audit trail created, no secrets in payload, admin-only access.
```

---

### QA-PROMPT-15: QA — Revenue Reporting

```
You are the QA engineer verifying TASK-15 implementation.

VERIFICATION CHECKLIST:
1. Seed D1 with 3 invoices (2 paid, 1 pending) for 2026-04 → GET /api/reports/revenue?year=2026&month=04 returns correct kobo totals
2. GET /api/reports/revenue?year=2026&month=13 → 400
3. GET /api/reports/appointments returns integer counts
4. All amounts are integers (no floats) in response
5. Different tenant's data not included

DONE CRITERIA: Correct aggregations, kobo only, tenant isolation.
```

---

### QA-PROMPT-16: QA — Dexie Offline DB

```
You are the QA engineer verifying TASK-16 implementation.

VERIFICATION CHECKLIST:
1. db.appointments table accessible after version 2 Dexie migration
2. Mutation with retryCount = 5: processMutationQueue skips it (not retried)
3. Mutation with retryCount = 4: processMutationQueue retries it, increments to 5 on failure
4. Existing clients/projects/invoices tables unaffected
5. backoff delay: 2^3 = 8 seconds for retryCount = 3 (verify delay function)

DONE CRITERIA: Retry cap enforced, appointments table accessible, existing data preserved.
```

---

### QA-PROMPT-17: QA — OpenAPI Docs

```
You are the QA engineer verifying TASK-17 implementation.

VERIFICATION CHECKLIST:
1. GET /openapi.json → valid JSON, has openapi: '3.0.x', info, paths fields
2. GET /docs in staging → 200 with Swagger UI HTML
3. GET /docs with ENVIRONMENT=production → 404
4. /api/clients path documented in spec
5. BearerAuth security scheme present

DONE CRITERIA: Valid spec, Swagger UI conditional on environment.
```

---

### QA-PROMPT-18: QA — CI/CD Pipeline

```
You are the QA engineer verifying TASK-18 implementation.

VERIFICATION CHECKLIST:
1. .github/workflows/deploy.yml syntax is valid YAML
2. Jobs: test, deploy-staging, deploy-production in correct dependency order
3. deploy-production has 'environment: production' key
4. Coverage step present with --coverage flag
5. Migration steps present before each deploy
6. PR workflow does NOT include deploy-production job

DONE CRITERIA: YAML valid, production gate present, migration steps ordered correctly.
```

---

### QA-PROMPT-19: QA — Client Name Collection

```
You are the QA engineer verifying TASK-19 implementation.

VERIFICATION CHECKLIST:
1. New user: IDLE → "hi" → GREETING → receives ASK_NAME → sends "Chidi" → receives service list
2. Empty name " " → re-prompt for name
3. appointments.clientName = "Chidi" after booking
4. BOOKED message contains "Chidi"
5. Global restart ("hi") clears clientName from session
6. All pre-existing state machine tests pass

DONE CRITERIA: Name collected, personalised message, stale name cleared on restart.
```

---

### QA-PROMPT-20: QA — Media Handling + Deduplication

```
You are the QA engineer verifying TASK-20 implementation.

VERIFICATION CHECKLIST:
1. Inbound with media field → isMedia=true, 200 returned, MEDIA_NOT_SUPPORTED message sent
2. Inbound text → isMedia=false, processed normally
3. Duplicate inbound (same sender+message within 10 min) → 200, state machine NOT run second time
4. Two different messages from same sender → both processed
5. crypto.subtle.digest used for hash (not Math.random or Date.now)

DONE CRITERIA: Media 200, deduplication idempotent, no re-processing.
```

---

## 9. PRIORITY ORDER

### Phase 1 — Immediate (Critical Path, Security, Data Integrity)

| Priority | Task | Rationale |
|----------|------|-----------|
| P1 | TASK-05 — Valibot Validation | Security — currently no validation on projects/clients POST |
| P2 | TASK-04 — Paystack Webhook + HMAC | Security — forged payment confirmations without this |
| P3 | TASK-03 — Invoices CRUD + Paystack | Core monetisation — platform cannot process payments without it |
| P4 | TASK-09 — Double-Booking Prevention | Data integrity — concurrent bookings corrupting appointment data |
| P5 | TASK-01 — Projects CRUD | Core CRM completeness |
| P6 | TASK-02 — Clients CRUD | Core CRM completeness |
| P7 | TASK-08 — Session TTL | User experience + D1 hygiene |
| P8 | TASK-18 — CI/CD Fix | Deployment safety — production hotfix risk |
| P9 | TASK-07 — Logging Middleware | Observability — blind without logs in production |
| P10 | TASK-20 — Media + Deduplication | WhatsApp reliability — retry loops without this |

### Phase 2 — Enhancement (Business Features, Polish)

| Priority | Task | Rationale |
|----------|------|-----------|
| P11 | TASK-06 — Pagination | Scalability |
| P12 | TASK-10 — Reminders | High business value |
| P13 | TASK-14 — Audit Log | Compliance + trust |
| P14 | TASK-12 — AI Generation | Differentiation |
| P15 | TASK-19 — Client Name | UX improvement |
| P16 | TASK-11 — R2 File Upload | Document workflow |
| P17 | TASK-13 — i18n Bot Messages | Invariant 6 fulfilment |
| P18 | TASK-15 — Revenue Reporting | Business intelligence |
| P19 | TASK-16 — Dexie Fixes | PWA completeness |
| P20 | TASK-17 — OpenAPI Docs | Developer experience |

---

## 10. DEPENDENCIES MAP

```
TASK-04 (Paystack Webhook)
  └─ depends on: TASK-03 (invoices.paystackReference column)

TASK-03 (Invoices CRUD)
  └─ depends on: TASK-01 (projects must exist for FK reference validation)

TASK-06 (Pagination)
  └─ depends on: TASK-01, TASK-02, TASK-03 (CRUD complete before pagination)

TASK-10 (Reminders)
  └─ depends on: TASK-08 (WhatsApp send infrastructure), TASK-09 (appointment booking reliable)

TASK-12 (AI)
  └─ depends on: TASK-01 (projects), TASK-03 (invoices)

TASK-14 (Audit Log)
  └─ depends on: TASK-03, TASK-04 (financial entities exist)

TASK-15 (Reports)
  └─ depends on: TASK-01, TASK-02, TASK-03, TASK-04

TASK-19 (Client Name)
  └─ depends on: TASK-08 (session migration — can share migration)

INDEPENDENT (no dependencies):
  TASK-05 (Valibot), TASK-07 (Logging), TASK-08 (Session TTL), TASK-09 (Double-booking),
  TASK-11 (R2), TASK-13 (i18n), TASK-16 (Dexie), TASK-17 (OpenAPI), TASK-18 (CI/CD),
  TASK-20 (Media)
```

---

## 11. PHASE 1 / PHASE 2 SPLIT

### Phase 1 Tasks (Security, Core Completeness, Reliability)

**Recommended execution order within Phase 1:**
1. TASK-18 (CI/CD) — fix the pipeline first so all subsequent work is safely deployable
2. TASK-05 (Valibot) — add validation foundation before completing CRUD
3. TASK-07 (Logging) — add observability before writing new code
4. TASK-01 (Projects CRUD) — complete core entity
5. TASK-02 (Clients CRUD) — complete core entity
6. TASK-03 (Invoices CRUD + Paystack) — wire payments
7. TASK-04 (Paystack Webhook) — complete payment loop
8. TASK-08 (Session TTL) — fix WhatsApp hygiene
9. TASK-09 (Double-Booking) — data integrity
10. TASK-20 (Media + Dedup) — WhatsApp reliability

**Phase 1 outcome:** A production-safe, fully functional API with complete CRUD, secure payment processing, and reliable WhatsApp booking.

### Phase 2 Tasks (Enhancement, AI, Reporting, PWA)

1. TASK-06 (Pagination) — scale readiness
2. TASK-10 (Reminders) — automation
3. TASK-14 (Audit Log) — compliance
4. TASK-12 (AI Generation) — differentiation
5. TASK-19 (Client Name) — UX
6. TASK-11 (R2 Upload) — document workflow
7. TASK-13 (i18n) — Africa-first
8. TASK-15 (Reports) — business intelligence
9. TASK-16 (Dexie) — PWA completeness
10. TASK-17 (OpenAPI) — developer experience

---

## 12. REPO CONTEXT AND ECOSYSTEM NOTES

### 12.1 What This Repo Does NOT Own

- **Authentication and JWT issuance:** Handled by a separate `webwaka-auth` or `@webwaka/core` package. This repo is a consumer only — it validates JWTs via `jwtAuthMiddleware()` but never issues them.
- **Notification routing and Termii integration logic:** Owned by `@webwaka/core/notifications` (NotificationService). This repo dispatches notifications through that abstraction — never directly to Termii's API.
- **CORS policy logic:** Owned by `@webwaka/core` `secureCORS()`. Do not redefine CORS rules here.
- **Role definitions:** Roles (`admin`, `manager`, `consultant`, `accountant`) are defined and validated in `@webwaka/core`. This repo references them but does not define them.
- **Frontend/PWA shell:** The Dexie `db.ts` is a client-side module but the PWA shell itself lives in a separate frontend repository. This repo provides the API it syncs against.

### 12.2 What This Repo Uniquely Owns

- **D1 schema for services domain:** clients, projects, invoices, appointments, whatsapp_sessions
- **Services domain business logic:** invoicing rules (kobo math), appointment state machine, WhatsApp booking flow
- **Paystack integration:** `paystack.ts` is the canonical Paystack adapter for this domain
- **OpenRouter AI abstraction:** `ai.ts` is the only place AI calls may be made in this repo

### 12.3 Cross-Repo Contracts

- Any change to the `tenantId` field naming convention in `@webwaka/core` JWT payload **must be synchronized** here in `types.ts`
- `@webwaka/core` version bumps (currently v1.3.2) must be tested before upgrading — the mock in `src/__mocks__/@webwaka/core.ts` must mirror the real package API
- `NotificationService.dispatch()` signature changes in `@webwaka/core/notifications` will break `core/whatsapp.ts`
- The D1 schema is the source of truth for the offline Dexie schema in `db/db.ts` — schema changes must be propagated to both

### 12.4 Ecosystem Invariants (Mandatory)

1. **Build Once Use Infinitely** — never duplicate auth, CORS, rate limiting, or notification logic from `@webwaka/core`
2. **Mobile/PWA/Offline First** — all REST responses must be compatible with Dexie offline sync
3. **Nigeria First, Africa Ready** — kobo integers always, `en-NG` default locale, Paystack as payment provider, Termii for messaging
4. **Vendor Neutral AI** — OpenRouter only; never hardcode OpenAI or Anthropic endpoints
5. **Multi-Tenant Tenant-as-Code** — `tenantId` in every D1 query, every auth check, every response scoping
6. **Event-Driven** — no direct cross-DB access; use domain events or API calls for cross-service communication
7. **Cloudflare-First Deployment** — D1, KV, R2, Cron Triggers, not AWS/GCP/Azure equivalents

---

## 13. GOVERNANCE AND REMINDER BLOCK

### For Every Implementation Agent

Before writing any code in this repository:

- [ ] Read `replit.md` — understand the architecture and running instructions
- [ ] Read `wrangler.toml` — understand environment bindings and secrets
- [ ] Read `src/core/types.ts` — understand the full domain type system
- [ ] Read the relevant module files being modified
- [ ] Check if `@webwaka/core` already provides the capability you are about to implement

### Hard Rules (Never Violate)

1. **NEVER** store naira amounts — always kobo integers
2. **NEVER** get `tenantId` from request body or headers — always from `c.get('user').tenantId` (JWT)
3. **NEVER** re-implement `verifyJWT`, `requireRole`, `secureCORS`, or `rateLimit` locally
4. **NEVER** call OpenAI, Anthropic, or Google AI APIs directly — always via OpenRouter
5. **NEVER** hard-delete financial records (invoices, payment_transactions, audit_log)
6. **NEVER** expose API keys, secrets, or env var values in error responses or logs
7. **NEVER** add `WHERE tenantId = ?` as an afterthought — it must be the first binding in every query

### Testing Rules

- Every new endpoint must have at least one test
- Coverage thresholds (80% lines/functions/statements, 75% branches) must be maintained
- Paystack, OpenRouter, and Termii API calls must be mocked in all tests — never make real network calls
- Use `app.request()` from Hono's test utilities for HTTP handler tests

### Migration Rules

- Every schema change requires a new numbered migration file (`migrations/XXXX_description.sql`)
- Migrations must be backward-compatible (no column removal, no type changes)
- Always test migration with `wrangler d1 migrations apply --local` before committing
- Production migrations require manual approval gate in CI/CD (TASK-18)

---

## 14. EXECUTION READINESS NOTES

### Environment Setup Required

Before any implementation task can be executed in Replit:

1. **Wrangler auth:** `wrangler login` or `CLOUDFLARE_API_TOKEN` env var for D1 local dev
2. **Local D1 migrations:** `wrangler d1 migrations apply --local` to create local SQLite DB
3. **Secrets for local dev:** Set in `.dev.vars` file (not committed):
   ```
   JWT_SECRET=test-secret-local
   PAYSTACK_SECRET_KEY=sk_test_xxx
   OPENROUTER_API_KEY=sk-or-xxx
   TERMII_API_KEY=xxx
   WHATSAPP_VERIFY_TOKEN=local-verify-token
   ```
4. **npm install** already done — all dependencies current

### Current Passing Tests

Run `npm test` — all current tests (stateMachine, i18n, paystack utils) should pass before starting any task. If any tests are red, fix them before proceeding.

### Current TypeScript Status

Run `npm run typecheck` — should pass with zero errors on the base repository before starting work.

### Development Server

The application runs on `node_modules/.bin/wrangler dev --port 8000 --ip 0.0.0.0`. Health check: `GET http://localhost:8000/health` → `{"status":"ok","service":"webwaka-services","version":"0.1.0"}`.

### Task Execution Order Recommendation

For a single implementation session, recommend this execution order to minimise merge conflicts and maximise value delivery:

**Session 1 (Security + Foundation):** TASK-18 → TASK-05 → TASK-07
**Session 2 (Core CRUD):** TASK-01 → TASK-02 → TASK-03
**Session 3 (Payments + Reliability):** TASK-04 → TASK-08 → TASK-09 → TASK-20
**Session 4 (Enhancements):** TASK-06 → TASK-10 → TASK-14
**Session 5 (AI + UX + Reporting):** TASK-12 → TASK-19 → TASK-13 → TASK-15
**Session 6 (PWA + Docs):** TASK-11 → TASK-16 → TASK-17

---

*Document end — WEBWAKA-SERVICES-DEEP-RESEARCH-TASKBOOK.md*
*Total tasks: 20 | Total QA plans: 20 | Total implementation prompts: 20 | Total QA prompts: 20*
*Phase 1 tasks: 10 | Phase 2 tasks: 10 | Bug fixes identified: 10 | Enhancements identified: 20*
