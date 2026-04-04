/**
 * Appointments Module — REST CRUD
 *
 * Authenticated endpoints for internal management of booked appointments.
 * Tenant isolation is enforced via JWT (tenantId NEVER sourced from headers).
 *
 * Routes:
 *   GET  /api/appointments          — list appointments for tenant
 *   GET  /api/appointments/:id      — get single appointment
 *   POST /api/appointments          — manually create an appointment
 *   PATCH /api/appointments/:id     — update status / notes
 *   DELETE /api/appointments/:id    — cancel appointment
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, AppointmentStatus } from '../../core/types';

const VALID_STATUSES: readonly AppointmentStatus[] = ['pending', 'confirmed', 'cancelled', 'completed'];

/** ISO 8601 datetime pattern (basic check — full parse validation done via Date constructor) */
function isValidISODatetime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

/**
 * Checks whether a new appointment for a specific staff member conflicts with
 * any existing confirmed or pending appointments.
 *
 * Two appointments overlap if:
 *   newStart < existingEnd  AND  newEnd > existingStart
 *
 * @returns { hasConflict: true, conflictingId } if a double-booking is detected,
 *          { hasConflict: false } otherwise.
 */
export async function checkDoubleBooking(
  db: D1Database,
  tenantId: string,
  staffId: string,
  newStartUtc: string,
  newDurationMinutes: number,
): Promise<{ hasConflict: boolean; conflictingId?: string }> {
  const newStart = new Date(newStartUtc).getTime();
  const newEnd = newStart + newDurationMinutes * 60 * 1000;

  // Query within a ±24h window to avoid full-table scans
  const windowStart = new Date(newStart - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(newEnd + 24 * 60 * 60 * 1000).toISOString();

  const { results } = await db
    .prepare(
      `SELECT id, scheduledAt, durationMinutes FROM appointments
       WHERE tenantId = ? AND staffId = ?
         AND status IN ('confirmed', 'pending')
         AND scheduledAt >= ? AND scheduledAt <= ?`,
    )
    .bind(tenantId, staffId, windowStart, windowEnd)
    .all<{ id: string; scheduledAt: string; durationMinutes: number }>();

  for (const appt of results) {
    const apptStart = new Date(appt.scheduledAt).getTime();
    const apptEnd = apptStart + appt.durationMinutes * 60 * 1000;
    // Strict overlap check: [newStart, newEnd) overlaps [apptStart, apptEnd)
    if (newStart < apptEnd && newEnd > apptStart) {
      return { hasConflict: true, conflictingId: appt.id };
    }
  }

  return { hasConflict: false };
}

export const appointmentsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── List ─────────────────────────────────────────────────────────────────────

appointmentsRouter.get('/', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const status = c.req.query('status');
  const phone = c.req.query('phone');
  const staffId = c.req.query('staffId');

  let query = 'SELECT * FROM appointments WHERE tenantId = ?';
  const bindings: unknown[] = [tenantId];

  if (status) {
    query += ' AND status = ?';
    bindings.push(status);
  }
  if (phone) {
    query += ' AND clientPhone = ?';
    bindings.push(phone);
  }
  if (staffId) {
    query += ' AND staffId = ?';
    bindings.push(staffId);
  }

  query += ' ORDER BY scheduledAt ASC';

  const stmt = c.env.DB.prepare(query);
  const { results } = await stmt.bind(...bindings).all();

  return c.json({ data: results });
});

// ─── Get Single ───────────────────────────────────────────────────────────────

appointmentsRouter.get('/:id', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM appointments WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();

  if (!row) return c.json({ error: 'Appointment not found' }, 404);
  return c.json({ data: row });
});

// ─── Create (manual) ─────────────────────────────────────────────────────────

appointmentsRouter.post('/', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    clientPhone: string;
    clientName?: string;
    service: string;
    scheduledAt: string;
    durationMinutes?: number;
    notes?: string;
    /** Assign appointment to a specific staff member (enables double-booking check) */
    staffId?: string;
  }>();

  if (!body.clientPhone || !body.service || !body.scheduledAt) {
    return c.json({ error: 'clientPhone, service, and scheduledAt are required' }, 400);
  }

  if (!isValidISODatetime(body.scheduledAt)) {
    return c.json({ error: 'scheduledAt must be a valid ISO 8601 datetime (e.g. 2025-12-01T14:00:00.000Z)' }, 400);
  }

  if (body.scheduledAt <= new Date().toISOString()) {
    return c.json({ error: 'scheduledAt must be in the future' }, 400);
  }

  const durationMinutes = body.durationMinutes ?? 30;
  if (durationMinutes <= 0 || !Number.isInteger(durationMinutes)) {
    return c.json({ error: 'durationMinutes must be a positive integer' }, 400);
  }

  // ── Double-booking check ─────────────────────────────────────────────────
  if (body.staffId) {
    // Verify staff member exists and belongs to this tenant
    const staffExists = await c.env.DB.prepare(
      "SELECT id FROM staff WHERE id = ? AND tenantId = ? AND status = 'active'",
    )
      .bind(body.staffId, tenantId)
      .first<{ id: string }>();

    if (!staffExists) {
      return c.json({ error: 'Staff member not found or inactive' }, 404);
    }

    const conflict = await checkDoubleBooking(
      c.env.DB,
      tenantId,
      body.staffId,
      body.scheduledAt,
      durationMinutes,
    );

    if (conflict.hasConflict) {
      return c.json({
        error: 'Double-booking detected: staff member already has an appointment at this time',
        conflictingAppointmentId: conflict.conflictingId,
      }, 409);
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO appointments
       (id, tenantId, clientPhone, clientName, service, scheduledAt, durationMinutes,
        status, notes, staffId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).bind(
    id,
    tenantId,
    body.clientPhone,
    body.clientName ?? null,
    body.service,
    body.scheduledAt,
    durationMinutes,
    body.notes ?? null,
    body.staffId ?? null,
    now,
    now,
  ).run();

  return c.json({ success: true, id }, 201);
});

// ─── Update ───────────────────────────────────────────────────────────────────

appointmentsRouter.patch('/:id', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM appointments WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();

  if (!existing) return c.json({ error: 'Appointment not found' }, 404);

  const body = await c.req.json<{
    status?: string;
    notes?: string;
    scheduledAt?: string;
    staffId?: string | null;
  }>();

  const now = new Date().toISOString();
  const fields: string[] = [];
  const vals: unknown[] = [];

  if (body.status) {
    if (!VALID_STATUSES.includes(body.status as AppointmentStatus)) {
      return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    }
    fields.push('status = ?');
    vals.push(body.status);
  }
  if (body.notes !== undefined) { fields.push('notes = ?'); vals.push(body.notes); }
  if (body.scheduledAt) {
    if (!isValidISODatetime(body.scheduledAt)) {
      return c.json({ error: 'scheduledAt must be a valid ISO 8601 datetime' }, 400);
    }
    if (body.scheduledAt <= new Date().toISOString()) {
      return c.json({ error: 'scheduledAt must be in the future' }, 400);
    }
    fields.push('scheduledAt = ?');
    vals.push(body.scheduledAt);
  }
  if (body.staffId !== undefined) {
    fields.push('staffId = ?');
    vals.push(body.staffId);
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push('updatedAt = ?');
  vals.push(now);
  vals.push(id);
  vals.push(tenantId);

  await c.env.DB.prepare(
    `UPDATE appointments SET ${fields.join(', ')} WHERE id = ? AND tenantId = ?`
  ).bind(...vals).run();

  return c.json({ success: true });
});

// ─── Delete (cancel) ──────────────────────────────────────────────────────────

appointmentsRouter.delete('/:id', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM appointments WHERE id = ? AND tenantId = ?'
  ).bind(id, tenantId).first();

  if (!existing) return c.json({ error: 'Appointment not found' }, 404);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE appointments SET status = 'cancelled', updatedAt = ? WHERE id = ? AND tenantId = ?"
  ).bind(now, id, tenantId).run();

  return c.json({ success: true });
});
