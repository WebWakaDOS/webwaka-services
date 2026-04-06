/**
 * Invoices Module — WebWaka Services Suite
 *
 * Invoice lifecycle management with financial ledger integration.
 * All amounts in kobo — Invariant 5: Nigeria First.
 * Financial events emitted to webwaka-central-mgmt on status transitions.
 *
 * Routes:
 *   GET    /api/svc_invoices              — list svc_invoices (filter by status/clientId)
 *   POST   /api/svc_invoices              — create invoice (status: draft)
 *   GET    /api/svc_invoices/:id          — get single invoice
 *   PATCH  /api/svc_invoices/:id          — update invoice (trigger ledger event on sent/paid)
 *   DELETE /api/svc_invoices/:id          — cancel invoice
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, InvoiceStatus } from '../../core/types';
import { emitLedgerEvent } from '../../core/central-mgmt-client';

const VALID_STATUSES: readonly InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];

export const invoicesRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── List Invoices ─────────────────────────────────────────────────────────────

invoicesRouter.get('/', requireRole(['admin', 'manager', 'accountant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const status = c.req.query('status');
  const clientId = c.req.query('clientId');
  const projectId = c.req.query('projectId');

  let query = 'SELECT * FROM svc_invoices WHERE tenantId = ?';
  const bindings: unknown[] = [tenantId];

  if (status) { query += ' AND status = ?'; bindings.push(status); }
  if (clientId) { query += ' AND clientId = ?'; bindings.push(clientId); }
  if (projectId) { query += ' AND projectId = ?'; bindings.push(projectId); }

  query += ' ORDER BY createdAt DESC';

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json({ data: results });
});

// ─── Get Single Invoice ────────────────────────────────────────────────────────

invoicesRouter.get('/:id', requireRole(['admin', 'manager', 'accountant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM svc_invoices WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();

  if (!row) return c.json({ error: 'Invoice not found' }, 404);
  return c.json({ data: row });
});

// ─── Create Invoice ────────────────────────────────────────────────────────────

invoicesRouter.post('/', requireRole(['admin', 'manager', 'accountant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    projectId?: string;
    clientId: string;
    amountKobo: number;
    taxKobo?: number;
    dueDate: string;
    notes?: string;
  }>();

  if (!body.clientId || body.amountKobo === undefined || !body.dueDate) {
    return c.json({ error: 'clientId, amountKobo, and dueDate are required' }, 400);
  }

  if (!Number.isInteger(body.amountKobo) || body.amountKobo < 0) {
    return c.json({ error: 'amountKobo must be a non-negative integer (kobo)' }, 400);
  }

  const taxKobo = body.taxKobo ?? 0;
  const totalKobo = body.amountKobo + taxKobo;
  const invoiceNumber = `INV-${Date.now()}`;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO svc_invoices
       (id, tenantId, projectId, clientId, invoiceNumber, amountKobo, taxKobo, totalKobo,
        status, dueDate, notes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      body.projectId ?? null,
      body.clientId,
      invoiceNumber,
      body.amountKobo,
      taxKobo,
      totalKobo,
      body.dueDate,
      body.notes ?? null,
      now,
      now,
    )
    .run();

  // Emit ledger event for invoice creation
  await emitLedgerEvent(
    { CENTRAL_MGMT_URL: c.env.CENTRAL_MGMT_URL, INTER_SERVICE_SECRET: c.env.INTER_SERVICE_SECRET },
    {
      eventType: 'invoice.created',
      tenantId,
      entityId: id,
      entityType: 'invoice',
      amountKobo: totalKobo,
      currency: 'NGN',
      referenceNumber: invoiceNumber,
      clientId: body.clientId,
      projectId: body.projectId,
      occurredAt: now,
    },
  );

  return c.json({ success: true, id, invoiceNumber }, 201);
});

// ─── Update Invoice ────────────────────────────────────────────────────────────
// Emits ledger events when status transitions to 'sent' or 'paid'.

invoicesRouter.patch('/:id', requireRole(['admin', 'manager', 'accountant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, status, totalKobo, invoiceNumber, clientId, projectId FROM svc_invoices WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first<{ id: string; status: string; totalKobo: number; invoiceNumber: string; clientId: string; projectId: string | null }>();
  if (!existing) return c.json({ error: 'Invoice not found' }, 404);

  const body = await c.req.json<{
    status?: string;
    notes?: string;
    dueDate?: string;
  }>();

  if (body.status && !VALID_STATUSES.includes(body.status as InvoiceStatus)) {
    return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }

  // Prevent re-opening a paid or cancelled invoice
  if (existing.status === 'paid' || existing.status === 'cancelled') {
    if (body.status && body.status !== existing.status) {
      return c.json({ error: `Cannot change status of a ${existing.status} invoice` }, 400);
    }
  }

  const fields: string[] = [];
  const vals: unknown[] = [];

  if (body.status !== undefined) { fields.push('status = ?'); vals.push(body.status); }
  if (body.notes !== undefined) { fields.push('notes = ?'); vals.push(body.notes); }
  if (body.dueDate !== undefined) { fields.push('dueDate = ?'); vals.push(body.dueDate); }
  if (body.status === 'paid') {
    fields.push('paidAt = ?');
    vals.push(new Date().toISOString());
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  const now = new Date().toISOString();
  fields.push('updatedAt = ?');
  vals.push(now, id, tenantId);

  await c.env.DB.prepare(
    `UPDATE svc_invoices SET ${fields.join(', ')} WHERE id = ? AND tenantId = ?`,
  )
    .bind(...vals)
    .run();

  // Emit ledger event on significant status transitions
  if (body.status && body.status !== existing.status) {
    const eventType =
      body.status === 'sent' ? 'invoice.sent' :
      body.status === 'paid' ? 'invoice.paid' :
      body.status === 'cancelled' ? 'invoice.cancelled' :
      null;

    if (eventType) {
      await emitLedgerEvent(
        { CENTRAL_MGMT_URL: c.env.CENTRAL_MGMT_URL, INTER_SERVICE_SECRET: c.env.INTER_SERVICE_SECRET },
        {
          eventType,
          tenantId,
          entityId: id,
          entityType: 'invoice',
          amountKobo: existing.totalKobo,
          currency: 'NGN',
          referenceNumber: existing.invoiceNumber,
          clientId: existing.clientId,
          projectId: existing.projectId ?? undefined,
          occurredAt: now,
        },
      );
    }
  }

  return c.json({ success: true });
});

// ─── Cancel Invoice ────────────────────────────────────────────────────────────

invoicesRouter.delete('/:id', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, status, totalKobo, invoiceNumber FROM svc_invoices WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first<{ id: string; status: string; totalKobo: number; invoiceNumber: string }>();
  if (!existing) return c.json({ error: 'Invoice not found' }, 404);

  if (existing.status === 'paid') {
    return c.json({ error: 'Cannot cancel a paid invoice' }, 400);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE svc_invoices SET status = 'cancelled', updatedAt = ? WHERE id = ? AND tenantId = ?",
  )
    .bind(now, id, tenantId)
    .run();

  await emitLedgerEvent(
    { CENTRAL_MGMT_URL: c.env.CENTRAL_MGMT_URL, INTER_SERVICE_SECRET: c.env.INTER_SERVICE_SECRET },
    {
      eventType: 'invoice.cancelled',
      tenantId,
      entityId: id,
      entityType: 'invoice',
      amountKobo: existing.totalKobo,
      currency: 'NGN',
      referenceNumber: existing.invoiceNumber,
      occurredAt: now,
    },
  );

  return c.json({ success: true });
});
