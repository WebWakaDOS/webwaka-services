/**
 * Services Catalog Module — WebWaka Services Suite
 *
 * Tenant-specific catalog of offered services: name, duration, base price.
 * Used by the scheduling engine and external booking API to resolve service
 * definitions without hardcoding them.
 *
 * Routes:
 *   GET    /api/services              — list services (active by default)
 *   POST   /api/services              — create service
 *   GET    /api/services/:id          — get single service
 *   PATCH  /api/services/:id          — update service
 *   DELETE /api/services/:id          — deactivate service
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const servicesRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── List Services ─────────────────────────────────────────────────────────────

servicesRouter.get('/', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const activeOnly = c.req.query('active') !== 'false';

  let query = 'SELECT * FROM services WHERE tenantId = ?';
  const bindings: unknown[] = [tenantId];

  if (activeOnly) { query += ' AND isActive = 1'; }
  query += ' ORDER BY name ASC';

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json({ data: results });
});

// ─── Get Single Service ────────────────────────────────────────────────────────

servicesRouter.get('/:id', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM services WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();

  if (!row) return c.json({ error: 'Service not found' }, 404);
  return c.json({ data: row });
});

// ─── Create Service ────────────────────────────────────────────────────────────

servicesRouter.post('/', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    name: string;
    description?: string;
    durationMinutes: number;
    basePriceKobo: number;
  }>();

  if (!body.name || !body.durationMinutes || body.basePriceKobo === undefined) {
    return c.json({ error: 'name, durationMinutes, and basePriceKobo are required' }, 400);
  }

  if (!Number.isInteger(body.durationMinutes) || body.durationMinutes <= 0) {
    return c.json({ error: 'durationMinutes must be a positive integer' }, 400);
  }

  if (!Number.isInteger(body.basePriceKobo) || body.basePriceKobo < 0) {
    return c.json({ error: 'basePriceKobo must be a non-negative integer (kobo)' }, 400);
  }

  // Check for duplicate name within tenant
  const existing = await c.env.DB.prepare(
    'SELECT id FROM services WHERE tenantId = ? AND name = ?',
  )
    .bind(tenantId, body.name)
    .first();
  if (existing) {
    return c.json({ error: `A service named "${body.name}" already exists` }, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO services
       (id, tenantId, name, description, durationMinutes, basePriceKobo, isActive, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, tenantId, body.name, body.description ?? null, body.durationMinutes, body.basePriceKobo, now, now)
    .run();

  return c.json({ success: true, id }, 201);
});

// ─── Update Service ────────────────────────────────────────────────────────────

servicesRouter.patch('/:id', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM services WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!existing) return c.json({ error: 'Service not found' }, 404);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    durationMinutes?: number;
    basePriceKobo?: number;
    isActive?: boolean;
  }>();

  if (body.durationMinutes !== undefined && (!Number.isInteger(body.durationMinutes) || body.durationMinutes <= 0)) {
    return c.json({ error: 'durationMinutes must be a positive integer' }, 400);
  }
  if (body.basePriceKobo !== undefined && (!Number.isInteger(body.basePriceKobo) || body.basePriceKobo < 0)) {
    return c.json({ error: 'basePriceKobo must be a non-negative integer (kobo)' }, 400);
  }

  const fields: string[] = [];
  const vals: unknown[] = [];

  if (body.name !== undefined) { fields.push('name = ?'); vals.push(body.name); }
  if (body.description !== undefined) { fields.push('description = ?'); vals.push(body.description); }
  if (body.durationMinutes !== undefined) { fields.push('durationMinutes = ?'); vals.push(body.durationMinutes); }
  if (body.basePriceKobo !== undefined) { fields.push('basePriceKobo = ?'); vals.push(body.basePriceKobo); }
  if (body.isActive !== undefined) { fields.push('isActive = ?'); vals.push(body.isActive ? 1 : 0); }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push('updatedAt = ?');
  vals.push(new Date().toISOString(), id, tenantId);

  await c.env.DB.prepare(
    `UPDATE services SET ${fields.join(', ')} WHERE id = ? AND tenantId = ?`,
  )
    .bind(...vals)
    .run();

  return c.json({ success: true });
});

// ─── Deactivate Service ────────────────────────────────────────────────────────

servicesRouter.delete('/:id', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM services WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!existing) return c.json({ error: 'Service not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE services SET isActive = 0, updatedAt = ? WHERE id = ? AND tenantId = ?',
  )
    .bind(new Date().toISOString(), id, tenantId)
    .run();

  return c.json({ success: true });
});
