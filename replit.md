# WebWaka Services Suite

## Overview

Backend API service for a consulting/freelancing platform built for the Nigerian and African markets. Part of the **WebWaka OS v4** ecosystem.

**Platform:** Cloudflare Workers (Serverless)
**Framework:** Hono (lightweight edge web framework)
**Language:** TypeScript
**Package Manager:** npm

## Architecture

- **Runtime:** Cloudflare Workers via Wrangler
- **Database:** Cloudflare D1 (SQL), Cloudflare KV (sessions/rate limiting)
- **File Storage:** Cloudflare R2
- **Payments:** Paystack (NGN kobo)
- **AI:** OpenRouter abstraction
- **Auth:** JWT via `@webwaka/core` shared library
- **Offline Sync:** Dexie (IndexedDB) for client-side

## Project Layout

```
src/
  worker.ts          # Main Cloudflare Worker entry point
  core/
    types.ts         # Shared TypeScript interfaces
    ai.ts            # OpenRouter AI abstraction
    paystack.ts      # Payment processing
  db/
    db.ts            # Dexie offline DB + sync
    schema.sql       # D1 SQL schema
  i18n/              # 7-locale internationalization
  middleware/        # Auth + security (re-exported from @webwaka/core)
  modules/
    clients/         # Client management routes
    invoices/        # Invoice routes
    projects/        # Project tracking routes
  __mocks__/         # Test mocks for @webwaka/core
migrations/          # D1 SQL migration files
wrangler.toml        # Cloudflare environments (staging/production)
```

## Key Principles

1. **Build Once Use Infinitely** — Centralized auth via `@webwaka/core`
2. **Mobile First** — Lightweight Hono APIs
3. **Offline First** — Dexie offline store on client
4. **Nigeria First** — Paystack kobo, `en-NG` locale
5. **Africa First** — 7-locale i18n
6. **Vendor Neutral AI** — OpenRouter only

## Running Locally (Replit)

The app runs via `wrangler dev` on port 8000.

- Health check: `GET /health`
- API routes (require JWT): `/api/projects`, `/api/clients`, `/api/invoices`

Note: Cloudflare bindings (D1, KV, R2) return "No bindings found" in local mode without a Cloudflare account configured.

## Deployment

This project is designed for **Cloudflare Workers** deployment via:
```
npx wrangler deploy --env staging
npx wrangler deploy --env production
```

Required secrets (set via `wrangler secret put`):
- `JWT_SECRET`
- `PAYSTACK_SECRET_KEY`
- `OPENROUTER_API_KEY`
- `TERMII_API_KEY`

## Testing

```
npm test              # Run tests once
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
npm run typecheck     # TypeScript check
```
