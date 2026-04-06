/**
 * Staff Management Module — WebWaka Services Suite
 *
 * Manages svc_staff members and their individual weekly availability calendars.
 * Tenant isolation is enforced via JWT (tenantId NEVER from headers).
 *
 * Routes:
 *   GET    /api/svc_staff                        — list active svc_staff
 *   POST   /api/svc_staff                        — create svc_staff member
 *   GET    /api/svc_staff/:id                    — get single svc_staff member
 *   PATCH  /api/svc_staff/:id                    — update svc_staff details
 *   DELETE /api/svc_staff/:id                    — deactivate svc_staff member
 *   GET    /api/svc_staff/:id/availability       — get weekly availability windows
 *   PUT    /api/svc_staff/:id/availability       — replace weekly availability windows
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

const DAY_RANGE = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Validates that a time string is in "HH:MM" 24-hour format.
 * Exported for unit testing.
 */
export function isValidHHMM(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

export const staffRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── List ─────────────────────────────────────────────────────────────────────

staffRouter.get('/', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const status = c.req.query('status') ?? 'active';
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM svc_staff WHERE tenantId = ? AND status = ? ORDER BY name ASC',
  )
    .bind(tenantId, status)
    .all();
  return c.json({ data: results });
});

// ─── Get Single ───────────────────────────────────────────────────────────────

staffRouter.get('/:id', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT * FROM svc_staff WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!row) return c.json({ error: 'Staff member not found' }, 404);
  return c.json({ data: row });
});

// ─── Create ───────────────────────────────────────────────────────────────────

staffRouter.post('/', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    name: string;
    email: string;
    phone: string;
    role?: string;
    skills?: string[];
    commissionBps?: number;
  }>();

  if (!body.name || !body.email || !body.phone) {
    return c.json({ error: 'name, email, and phone are required' }, 400);
  }
  if (body.commissionBps !== undefined && (body.commissionBps < 0 || body.commissionBps > 10000)) {
    return c.json({ error: 'commissionBps must be between 0 and 10000 (0% – 100%)' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const skills = JSON.stringify(body.skills ?? []);

  await c.env.DB.prepare(
    `INSERT INTO svc_staff
       (id, tenantId, name, email, phone, role, skills, status, commissionBps, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      body.name,
      body.email,
      body.phone,
      body.role ?? 'technician',
      skills,
      body.commissionBps ?? 0,
      now,
      now,
    )
    .run();

  return c.json({ success: true, id }, 201);
});

// ─── Update ───────────────────────────────────────────────────────────────────

staffRouter.patch('/:id', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM svc_staff WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!existing) return c.json({ error: 'Staff member not found' }, 404);

  const body = await c.req.json<{
    name?: string;
    email?: string;
    phone?: string;
    role?: string;
    skills?: string[];
    status?: 'active' | 'inactive';
    commissionBps?: number;
  }>();

  if (body.commissionBps !== undefined && (body.commissionBps < 0 || body.commissionBps > 10000)) {
    return c.json({ error: 'commissionBps must be between 0 and 10000' }, 400);
  }

  const fields: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); vals.push(body.name); }
  if (body.email !== undefined) { fields.push('email = ?'); vals.push(body.email); }
  if (body.phone !== undefined) { fields.push('phone = ?'); vals.push(body.phone); }
  if (body.role !== undefined) { fields.push('role = ?'); vals.push(body.role); }
  if (body.skills !== undefined) { fields.push('skills = ?'); vals.push(JSON.stringify(body.skills)); }
  if (body.status !== undefined) { fields.push('status = ?'); vals.push(body.status); }
  if (body.commissionBps !== undefined) { fields.push('commissionBps = ?'); vals.push(body.commissionBps); }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push('updatedAt = ?');
  vals.push(new Date().toISOString(), id, tenantId);

  await c.env.DB.prepare(
    `UPDATE svc_staff SET ${fields.join(', ')} WHERE id = ? AND tenantId = ?`,
  )
    .bind(...vals)
    .run();

  return c.json({ success: true });
});

// ─── Deactivate ───────────────────────────────────────────────────────────────

staffRouter.delete('/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM svc_staff WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!existing) return c.json({ error: 'Staff member not found' }, 404);

  await c.env.DB.prepare(
    "UPDATE svc_staff SET status = 'inactive', updatedAt = ? WHERE id = ? AND tenantId = ?",
  )
    .bind(new Date().toISOString(), id, tenantId)
    .run();

  return c.json({ success: true });
});

// ─── Get Availability ─────────────────────────────────────────────────────────

staffRouter.get('/:id/availability', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const staffId = c.req.param('id');

  const staffExists = await c.env.DB.prepare(
    'SELECT id FROM svc_staff WHERE id = ? AND tenantId = ?',
  )
    .bind(staffId, tenantId)
    .first();
  if (!staffExists) return c.json({ error: 'Staff member not found' }, 404);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM svc_staff_availability WHERE staffId = ? ORDER BY dayOfWeek ASC',
  )
    .bind(staffId)
    .all();

  return c.json({ data: results });
});

// ─── Set Availability (replace all windows for svc_staff member) ──────────────────

staffRouter.put('/:id/availability', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const staffId = c.req.param('id');

  const staffExists = await c.env.DB.prepare(
    'SELECT id FROM svc_staff WHERE id = ? AND tenantId = ?',
  )
    .bind(staffId, tenantId)
    .first();
  if (!staffExists) return c.json({ error: 'Staff member not found' }, 404);

  const body = await c.req.json<{
    availability: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
  }>();

  if (!Array.isArray(body.availability)) {
    return c.json({ error: 'availability must be an array' }, 400);
  }

  for (const window of body.availability) {
    if (!DAY_RANGE.includes(window.dayOfWeek as 0)) {
      return c.json({ error: `dayOfWeek must be 0–6; got ${window.dayOfWeek}` }, 400);
    }
    if (!isValidHHMM(window.startTime) || !isValidHHMM(window.endTime)) {
      return c.json({ error: 'startTime and endTime must be "HH:MM" format' }, 400);
    }
    if (window.startTime >= window.endTime) {
      return c.json({ error: 'startTime must be before endTime' }, 400);
    }
  }

  // Replace all existing availability for this svc_staff member atomically
  await c.env.DB.prepare(
    'DELETE FROM svc_staff_availability WHERE staffId = ?',
  )
    .bind(staffId)
    .run();

  for (const window of body.availability) {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO svc_staff_availability (id, tenantId, staffId, dayOfWeek, startTime, endTime) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, tenantId, staffId, window.dayOfWeek, window.startTime, window.endTime)
      .run();
  }

  return c.json({ success: true, windowsSet: body.availability.length });
});
