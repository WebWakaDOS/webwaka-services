/**
 * Automated Quoting System — WebWaka Services Suite
 *
 * Generates instant service svc_quotes based on user-supplied parameters, stores
 * them in D1, and optionally sends them to svc_clients via WhatsApp/email.
 *
 * All monetary values are stored and returned in kobo — Invariant 5: Nigeria First.
 *
 * Routes:
 *   POST /api/svc_quotes/estimate        — compute quote without persisting (instant estimate)
 *   GET  /api/svc_quotes                 — list all svc_quotes for the tenant
 *   GET  /api/svc_quotes/:id             — get a single quote with its line items
 *   POST /api/svc_quotes                 — create and persist a formal quote
 *   PATCH /api/svc_quotes/:id            — update quote status or notes
 *   POST /api/svc_quotes/:id/send        — send the quote to the client via WhatsApp
 *
 * Pricing rules:
 *   Quotes are built from line items. Each line item has a description, quantity,
 *   and a unit price (in kobo). The system supports a configurable deposit
 *   percentage (depositBps — basis points × 100) which is applied to the subtotal.
 *   VAT is configurable per tenant via the request body (vatBps, default 7.5% = 750).
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, QuoteStatus } from '../../core/types';
import { sendWhatsAppMessage } from '../../core/whatsapp';
import { emitLedgerEvent } from '../../core/central-mgmt-client';

const VALID_STATUSES: readonly QuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired'];

/** Default VAT rate in basis points (7.5% = 750 bps) — Nigeria standard VAT */
const DEFAULT_VAT_BPS = 750;
/** Default deposit in basis points (30% = 3000 bps) */
const DEFAULT_DEPOSIT_BPS = 3000;
/** Default quote validity in days */
const DEFAULT_VALIDITY_DAYS = 7;

interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceKobo: number;
}

function computeQuoteTotals(
  lineItems: LineItemInput[],
  vatBps: number,
  depositBps: number,
): {
  subtotalKobo: number;
  taxKobo: number;
  totalKobo: number;
  depositKobo: number;
  computedItems: Array<LineItemInput & { totalKobo: number }>;
} {
  const computedItems = lineItems.map((item) => ({
    ...item,
    totalKobo: Math.round(item.quantity * item.unitPriceKobo),
  }));

  const subtotalKobo = computedItems.reduce((sum, i) => sum + i.totalKobo, 0);
  const taxKobo = Math.round((subtotalKobo * vatBps) / 10000);
  const totalKobo = subtotalKobo + taxKobo;
  const depositKobo = Math.round((subtotalKobo * depositBps) / 10000);

  return { subtotalKobo, taxKobo, totalKobo, depositKobo, computedItems };
}

function validityDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatKoboDisplay(kobo: number): string {
  const naira = (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
  return `₦${naira}`;
}

export const quotesRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Instant Estimate (no persistence) ───────────────────────────────────────

quotesRouter.post('/estimate', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const body = await c.req.json<{
    service: string;
    lineItems: LineItemInput[];
    vatBps?: number;
    depositBps?: number;
  }>();

  if (!body.service) return c.json({ error: 'service is required' }, 400);
  if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
    return c.json({ error: 'lineItems must be a non-empty array' }, 400);
  }

  const vatBps = body.vatBps ?? DEFAULT_VAT_BPS;
  const depositBps = body.depositBps ?? DEFAULT_DEPOSIT_BPS;

  const { subtotalKobo, taxKobo, totalKobo, depositKobo, computedItems } =
    computeQuoteTotals(body.lineItems, vatBps, depositBps);

  return c.json({
    estimate: {
      service: body.service,
      lineItems: computedItems,
      subtotalKobo,
      taxKobo,
      totalKobo,
      depositKobo,
      vatBps,
      depositBps,
      validUntil: validityDate(DEFAULT_VALIDITY_DAYS),
      display: {
        subtotal: formatKoboDisplay(subtotalKobo),
        tax: formatKoboDisplay(taxKobo),
        total: formatKoboDisplay(totalKobo),
        deposit: formatKoboDisplay(depositKobo),
      },
    },
  });
});

// ─── List Quotes ──────────────────────────────────────────────────────────────

quotesRouter.get('/', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const status = c.req.query('status');
  const clientId = c.req.query('clientId');

  let query = 'SELECT * FROM svc_quotes WHERE tenantId = ?';
  const bindings: unknown[] = [tenantId];

  if (status) { query += ' AND status = ?'; bindings.push(status); }
  if (clientId) { query += ' AND clientId = ?'; bindings.push(clientId); }

  query += ' ORDER BY createdAt DESC';

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json({ data: results });
});

// ─── Get Single Quote ─────────────────────────────────────────────────────────

quotesRouter.get('/:id', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const quote = await c.env.DB.prepare(
    'SELECT * FROM svc_quotes WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!quote) return c.json({ error: 'Quote not found' }, 404);

  const { results: lineItems } = await c.env.DB.prepare(
    'SELECT * FROM svc_quote_line_items WHERE quoteId = ? ORDER BY rowid ASC',
  )
    .bind(id)
    .all();

  return c.json({ data: { ...quote, lineItems } });
});

// ─── Create Quote ─────────────────────────────────────────────────────────────

quotesRouter.post('/', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    service: string;
    lineItems: LineItemInput[];
    clientId?: string;
    clientPhone?: string;
    clientEmail?: string;
    vatBps?: number;
    depositBps?: number;
    validityDays?: number;
    notes?: string;
  }>();

  if (!body.service) return c.json({ error: 'service is required' }, 400);
  if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
    return c.json({ error: 'lineItems must be a non-empty array' }, 400);
  }
  if (!body.clientId && !body.clientPhone && !body.clientEmail) {
    return c.json({ error: 'At least one of clientId, clientPhone, or clientEmail is required' }, 400);
  }

  const vatBps = body.vatBps ?? DEFAULT_VAT_BPS;
  const depositBps = body.depositBps ?? DEFAULT_DEPOSIT_BPS;
  const validityDays = body.validityDays ?? DEFAULT_VALIDITY_DAYS;

  const { subtotalKobo, taxKobo, totalKobo, depositKobo, computedItems } =
    computeQuoteTotals(body.lineItems, vatBps, depositBps);

  const quoteId = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO svc_quotes
       (id, tenantId, clientId, clientPhone, clientEmail, service,
        subtotalKobo, taxKobo, totalKobo, depositKobo,
        status, validUntil, notes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
  )
    .bind(
      quoteId,
      tenantId,
      body.clientId ?? null,
      body.clientPhone ?? null,
      body.clientEmail ?? null,
      body.service,
      subtotalKobo,
      taxKobo,
      totalKobo,
      depositKobo,
      validityDate(validityDays),
      body.notes ?? null,
      now,
      now,
    )
    .run();

  for (const item of computedItems) {
    const itemId = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO svc_quote_line_items (id, quoteId, description, quantity, unitPriceKobo, totalKobo) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(itemId, quoteId, item.description, item.quantity, item.unitPriceKobo, item.totalKobo)
      .run();
  }

  // WW-SVC-003: Emit ledger event for quote creation
  await emitLedgerEvent(
    { CENTRAL_MGMT_URL: c.env.CENTRAL_MGMT_URL, INTER_SERVICE_SECRET: c.env.INTER_SERVICE_SECRET },
    {
      eventType: 'quote.created',
      tenantId,
      entityId: quoteId,
      entityType: 'quote',
      amountKobo: totalKobo,
      currency: 'NGN',
      clientId: body.clientId,
      metadata: { service: body.service },
      occurredAt: now,
    },
  );

  return c.json({ success: true, id: quoteId }, 201);
});

// ─── Update Quote ─────────────────────────────────────────────────────────────

quotesRouter.patch('/:id', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM svc_quotes WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first<{ id: string; status: string }>();
  if (!existing) return c.json({ error: 'Quote not found' }, 404);

  const body = await c.req.json<{ status?: string; notes?: string }>();

  if (body.status && !VALID_STATUSES.includes(body.status as QuoteStatus)) {
    return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }

  const fields: string[] = [];
  const vals: unknown[] = [];
  if (body.status !== undefined) { fields.push('status = ?'); vals.push(body.status); }
  if (body.notes !== undefined) { fields.push('notes = ?'); vals.push(body.notes); }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push('updatedAt = ?');
  vals.push(new Date().toISOString(), id, tenantId);

  await c.env.DB.prepare(
    `UPDATE svc_quotes SET ${fields.join(', ')} WHERE id = ? AND tenantId = ?`,
  )
    .bind(...vals)
    .run();

  // Emit ledger event when quote is accepted or rejected (WW-SVC-003)
  if (body.status === 'accepted' || body.status === 'rejected') {
    const freshQuote = await c.env.DB.prepare(
      'SELECT id, totalKobo, clientId, service FROM svc_quotes WHERE id = ? AND tenantId = ?',
    )
      .bind(id, tenantId)
      .first<{ id: string; totalKobo: number; clientId: string | null; service: string }>();

    if (freshQuote) {
      await emitLedgerEvent(
        { CENTRAL_MGMT_URL: c.env.CENTRAL_MGMT_URL, INTER_SERVICE_SECRET: c.env.INTER_SERVICE_SECRET },
        {
          eventType: body.status === 'accepted' ? 'quote.accepted' : 'quote.rejected',
          tenantId,
          entityId: freshQuote.id,
          entityType: 'quote',
          amountKobo: freshQuote.totalKobo,
          currency: 'NGN',
          clientId: freshQuote.clientId ?? undefined,
          metadata: { service: freshQuote.service },
          occurredAt: new Date().toISOString(),
        },
      );
    }
  }

  return c.json({ success: true });
});

// ─── Send Quote via WhatsApp ───────────────────────────────────────────────────

quotesRouter.post('/:id/send', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const quote = await c.env.DB.prepare(
    'SELECT * FROM svc_quotes WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first<{
      id: string;
      service: string;
      clientPhone: string | null;
      totalKobo: number;
      depositKobo: number;
      validUntil: string;
      status: string;
    }>();

  if (!quote) return c.json({ error: 'Quote not found' }, 404);
  if (!quote.clientPhone) {
    return c.json({ error: 'Quote has no clientPhone — cannot send via WhatsApp' }, 400);
  }
  if (quote.status === 'accepted' || quote.status === 'rejected') {
    return c.json({ error: `Cannot send a quote with status '${quote.status}'` }, 400);
  }

  const message =
    `📋 *Your WebWaka Quote*\n\n` +
    `Service: ${quote.service}\n` +
    `Total: ${formatKoboDisplay(quote.totalKobo)}\n` +
    `Deposit required: ${formatKoboDisplay(quote.depositKobo)}\n` +
    `Valid until: ${quote.validUntil}\n\n` +
    `Reply *YES* to accept this quote and proceed with payment, or *NO* to decline.`;

  const sent = await sendWhatsAppMessage(
    { tenantId, to: quote.clientPhone, body: message },
    c.env.TERMII_API_KEY,
    c.env.TERMII_WHATSAPP_SENDER_ID,
  );

  if (sent) {
    await c.env.DB.prepare(
      "UPDATE svc_quotes SET status = 'sent', updatedAt = ? WHERE id = ? AND tenantId = ?",
    )
      .bind(new Date().toISOString(), id, tenantId)
      .run();
  }

  return c.json({ success: sent, sent });
});
