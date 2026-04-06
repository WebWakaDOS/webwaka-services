/**
 * Clients Module — WebWaka Services Suite
 *
 * Full CRM-like client management: create, retrieve, update, deactivate,
 * search, and view service history. Tenant isolation via JWT.
 *
 * Routes:
 *   GET    /api/clients                  — list clients (with optional ?search=)
 *   POST   /api/clients                  — create client
 *   GET    /api/clients/:id              — get single client
 *   PATCH  /api/clients/:id              — update client details
 *   DELETE /api/clients/:id              — deactivate client (soft delete)
 *   GET    /api/clients/:id/history      — service history (appointments + invoices + projects)
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const clientsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── List Clients ─────────────────────────────────────────────────────────────

clientsRouter.get('/', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const search = c.req.query('search');
  const status = c.req.query('status') ?? 'active';

  let query = 'SELECT * FROM clients WHERE tenantId = ?';
  const bindings: unknown[] = [tenantId];

  if (status !== 'all') {
    query += ' AND status = ?';
    bindings.push(status);
  }

  if (search) {
    query += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ?)';
    const pattern = `%${search}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }

  query += ' ORDER BY name ASC';

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json({ data: results });
});

// ─── Get Single Client ────────────────────────────────────────────────────────

clientsRouter.get('/:id', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM clients WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();

  if (!row) return c.json({ error: 'Client not found' }, 404);
  return c.json({ data: row });
});

// ─── Create Client ────────────────────────────────────────────────────────────

clientsRouter.post('/', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    name: string;
    email: string;
    phone: string;
    company?: string;
    address?: string;
  }>();

  if (!body.name || !body.email || !body.phone) {
    return c.json({ error: 'name, email, and phone are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO clients
       (id, tenantId, name, email, phone, company, address, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      body.name,
      body.email,
      body.phone,
      body.company ?? '',
      body.address ?? '',
      now,
      now,
    )
    .run();

  return c.json({ success: true, id }, 201);
});

// ─── Update Client ────────────────────────────────────────────────────────────

clientsRouter.patch('/:id', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM clients WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();

  if (!existing) return c.json({ error: 'Client not found' }, 404);

  const body = await c.req.json<{
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    address?: string;
    status?: 'active' | 'inactive';
  }>();

  const fields: string[] = [];
  const vals: unknown[] = [];

  if (body.name !== undefined) { fields.push('name = ?'); vals.push(body.name); }
  if (body.email !== undefined) { fields.push('email = ?'); vals.push(body.email); }
  if (body.phone !== undefined) { fields.push('phone = ?'); vals.push(body.phone); }
  if (body.company !== undefined) { fields.push('company = ?'); vals.push(body.company); }
  if (body.address !== undefined) { fields.push('address = ?'); vals.push(body.address); }
  if (body.status !== undefined) {
    if (!['active', 'inactive'].includes(body.status)) {
      return c.json({ error: 'status must be active or inactive' }, 400);
    }
    fields.push('status = ?');
    vals.push(body.status);
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push('updatedAt = ?');
  vals.push(new Date().toISOString(), id, tenantId);

  await c.env.DB.prepare(
    `UPDATE clients SET ${fields.join(', ')} WHERE id = ? AND tenantId = ?`,
  )
    .bind(...vals)
    .run();

  return c.json({ success: true });
});

// ─── Deactivate Client (soft delete) ──────────────────────────────────────────

clientsRouter.delete('/:id', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM clients WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();

  if (!existing) return c.json({ error: 'Client not found' }, 404);

  await c.env.DB.prepare(
    "UPDATE clients SET status = 'inactive', updatedAt = ? WHERE id = ? AND tenantId = ?",
  )
    .bind(new Date().toISOString(), id, tenantId)
    .run();

  return c.json({ success: true });
});

// ─── Service History ──────────────────────────────────────────────────────────
// Returns a unified timeline of the client's appointments, invoices, and projects.

clientsRouter.get('/:id/history', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  // Verify client exists and belongs to tenant
  const client = await c.env.DB.prepare(
    'SELECT id, name FROM clients WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first<{ id: string; name: string }>();

  if (!client) return c.json({ error: 'Client not found' }, 404);

  // Fetch appointments linked to this client by clientId or by clientPhone match
  const [appointmentsResult, invoicesResult, projectsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, service, scheduledAt, status, durationMinutes, notes
       FROM appointments
       WHERE tenantId = ? AND clientId = ?
       ORDER BY scheduledAt DESC LIMIT 50`,
    )
      .bind(tenantId, id)
      .all(),

    c.env.DB.prepare(
      `SELECT id, invoiceNumber, totalKobo, status, dueDate, createdAt
       FROM invoices
       WHERE tenantId = ? AND clientId = ?
       ORDER BY createdAt DESC LIMIT 50`,
    )
      .bind(tenantId, id)
      .all(),

    c.env.DB.prepare(
      `SELECT id, name, status, budgetKobo, startDate, endDate
       FROM projects
       WHERE tenantId = ? AND clientId = ?
       ORDER BY createdAt DESC LIMIT 50`,
    )
      .bind(tenantId, id)
      .all(),
  ]);

  return c.json({
    data: {
      client,
      appointments: appointmentsResult.results,
      invoices: invoicesResult.results,
      projects: projectsResult.results,
      totals: {
        appointmentCount: appointmentsResult.results.length,
        invoiceCount: invoicesResult.results.length,
        projectCount: projectsResult.results.length,
      },
    },
  });
});
