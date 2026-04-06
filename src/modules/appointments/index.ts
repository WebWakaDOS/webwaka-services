/**
 * Appointments Module — REST CRUD + Calendar Feed + Auto-Reminders
 *
 * Authenticated endpoints for internal management of booked appointments.
 * Tenant isolation is enforced via JWT (tenantId NEVER sourced from headers).
 *
 * Routes:
 *   GET  /api/appointments              — list appointments
 *   GET  /api/appointments/calendar.ics — iCalendar feed for external calendar sync
 *   GET  /api/appointments/:id          — get single appointment
 *   POST /api/appointments              — manually create an appointment
 *   PATCH /api/appointments/:id         — update status / notes / reschedule
 *   DELETE /api/appointments/:id        — cancel appointment
 *
 * WW-SVC-001: Calendar integration via iCal (RFC 5545) feed.
 * WW-SVC-005: Auto-schedules 24h + 1h SMS/WhatsApp reminders on appointment create.
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
 * Escapes special characters for iCalendar TEXT values (RFC 5545 §3.3.11).
 */
function icalEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Formats an ISO UTC date string as iCal DTSTART/DTEND value.
 * e.g. "2025-12-01T14:00:00.000Z" → "20251201T140000Z"
 */
function toICalDate(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace('Z', 'Z');
}

/**
 * Builds a valid RFC 5545 iCalendar feed from a list of appointments.
 * Each appointment becomes a VEVENT with UID, DTSTART, DTEND, SUMMARY, and DESCRIPTION.
 */
function buildICalFeed(
  tenantId: string,
  appointments: Array<{
    id: string;
    service: string;
    scheduledAt: string;
    durationMinutes: number;
    status: string;
    clientName: string | null;
    clientPhone: string;
    notes: string | null;
    calendarEventId: string | null;
  }>,
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WebWaka Services//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:WebWaka Appointments (${tenantId})`,
    'X-WR-TIMEZONE:Africa/Lagos',
  ];

  for (const appt of appointments) {
    if (appt.status === 'cancelled') continue;

    const startMs = new Date(appt.scheduledAt).getTime();
    const endMs = startMs + appt.durationMinutes * 60 * 1000;
    const dtStart = toICalDate(new Date(startMs).toISOString());
    const dtEnd = toICalDate(new Date(endMs).toISOString());
    const uid = appt.calendarEventId ?? `${appt.id}@webwaka-services`;
    const summary = icalEscape(`${appt.service}${appt.clientName ? ` — ${appt.clientName}` : ''}`);
    const description = icalEscape(
      [
        `Client: ${appt.clientName ?? 'Unknown'} (${appt.clientPhone})`,
        `Status: ${appt.status}`,
        appt.notes ? `Notes: ${appt.notes}` : '',
      ]
        .filter(Boolean)
        .join('\\n'),
    );

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      `STATUS:${appt.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`,
      `DTSTAMP:${toICalDate(new Date().toISOString())}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * Checks whether a new appointment for a specific staff member conflicts with
 * any existing confirmed or pending appointments.
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
    if (newStart < apptEnd && newEnd > apptStart) {
      return { hasConflict: true, conflictingId: appt.id };
    }
  }

  return { hasConflict: false };
}

/**
 * Auto-schedules reminders for a newly created appointment.
 * Creates two reminders: 24 hours before and 1 hour before.
 * Uses the clientPhone as the recipient; channel defaults to 'whatsapp'.
 * Silently skips if scheduledAt is less than 2h in the future.
 */
async function autoScheduleReminders(
  db: D1Database,
  tenantId: string,
  appointmentId: string,
  clientPhone: string,
  scheduledAt: string,
): Promise<void> {
  const apptMs = new Date(scheduledAt).getTime();
  const nowMs = Date.now();
  const now = new Date().toISOString();

  const reminderOffsets: Array<{ label: string; offsetMs: number }> = [
    { label: '24h', offsetMs: 24 * 60 * 60 * 1000 },
    { label: '1h', offsetMs: 60 * 60 * 1000 },
  ];

  for (const { offsetMs } of reminderOffsets) {
    const reminderMs = apptMs - offsetMs;
    // Only schedule if the reminder time is in the future
    if (reminderMs <= nowMs) continue;

    const reminderId = crypto.randomUUID();
    const scheduledFor = new Date(reminderMs).toISOString();

    await db
      .prepare(
        `INSERT INTO reminder_logs
           (id, tenantId, appointmentId, channel, recipient, scheduledFor,
            status, sentAt, errorMessage, createdAt, updatedAt)
         VALUES (?, ?, ?, 'whatsapp', ?, ?, 'scheduled', NULL, NULL, ?, ?)`,
      )
      .bind(reminderId, tenantId, appointmentId, clientPhone, scheduledFor, now, now)
      .run();
  }
}

export const appointmentsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── iCalendar Feed ────────────────────────────────────────────────────────────
// WW-SVC-001: Provides an RFC 5545 iCal feed for calendar app subscription.
// Route must appear before /:id to prevent "calendar.ics" being treated as an ID.

appointmentsRouter.get('/calendar.ics', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  // Fetch upcoming non-cancelled appointments (90-day window)
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const { results } = await c.env.DB.prepare(
    `SELECT id, service, scheduledAt, durationMinutes, status, clientName,
            clientPhone, notes, calendarEventId
     FROM appointments
     WHERE tenantId = ? AND scheduledAt >= ? AND scheduledAt <= ?
       AND status != 'cancelled'
     ORDER BY scheduledAt ASC
     LIMIT 200`,
  )
    .bind(tenantId, from, to)
    .all<{
      id: string;
      service: string;
      scheduledAt: string;
      durationMinutes: number;
      status: string;
      clientName: string | null;
      clientPhone: string;
      notes: string | null;
      calendarEventId: string | null;
    }>();

  const ical = buildICalFeed(tenantId, results);

  return new Response(ical, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="webwaka-appointments.ics"',
      'Cache-Control': 'no-cache, no-store',
    },
  });
});

// ─── List ─────────────────────────────────────────────────────────────────────

appointmentsRouter.get('/', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const status = c.req.query('status');
  const phone = c.req.query('phone');
  const staffId = c.req.query('staffId');
  const clientId = c.req.query('clientId');
  const from = c.req.query('from');
  const to = c.req.query('to');

  let query = 'SELECT * FROM appointments WHERE tenantId = ?';
  const bindings: unknown[] = [tenantId];

  if (status) { query += ' AND status = ?'; bindings.push(status); }
  if (phone) { query += ' AND clientPhone = ?'; bindings.push(phone); }
  if (staffId) { query += ' AND staffId = ?'; bindings.push(staffId); }
  if (clientId) { query += ' AND clientId = ?'; bindings.push(clientId); }
  if (from) { query += ' AND scheduledAt >= ?'; bindings.push(from); }
  if (to) { query += ' AND scheduledAt <= ?'; bindings.push(to); }

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
    'SELECT * FROM appointments WHERE id = ? AND tenantId = ?',
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
    clientId?: string;
    service: string;
    scheduledAt: string;
    durationMinutes?: number;
    notes?: string;
    staffId?: string;
    isMobile?: boolean;
    locationLat?: number;
    locationLng?: number;
    calendarEventId?: string;
    autoReminders?: boolean;
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
       (id, tenantId, clientPhone, clientName, clientId, service, scheduledAt,
        durationMinutes, status, notes, staffId, isMobile, locationLat, locationLng,
        calendarEventId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    tenantId,
    body.clientPhone,
    body.clientName ?? null,
    body.clientId ?? null,
    body.service,
    body.scheduledAt,
    durationMinutes,
    body.notes ?? null,
    body.staffId ?? null,
    body.isMobile ? 1 : 0,
    body.locationLat ?? null,
    body.locationLng ?? null,
    body.calendarEventId ?? null,
    now,
    now,
  ).run();

  // WW-SVC-005: Auto-schedule 24h + 1h reminders unless explicitly disabled
  if (body.autoReminders !== false) {
    await autoScheduleReminders(
      c.env.DB,
      tenantId,
      id,
      body.clientPhone,
      body.scheduledAt,
    );
  }

  return c.json({ success: true, id }, 201);
});

// ─── Update ───────────────────────────────────────────────────────────────────

appointmentsRouter.patch('/:id', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM appointments WHERE id = ? AND tenantId = ?',
  ).bind(id, tenantId).first();

  if (!existing) return c.json({ error: 'Appointment not found' }, 404);

  const body = await c.req.json<{
    status?: string;
    notes?: string;
    scheduledAt?: string;
    staffId?: string | null;
    calendarEventId?: string | null;
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
  if (body.staffId !== undefined) { fields.push('staffId = ?'); vals.push(body.staffId); }
  if (body.calendarEventId !== undefined) { fields.push('calendarEventId = ?'); vals.push(body.calendarEventId); }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push('updatedAt = ?');
  vals.push(now);
  vals.push(id);
  vals.push(tenantId);

  await c.env.DB.prepare(
    `UPDATE appointments SET ${fields.join(', ')} WHERE id = ? AND tenantId = ?`,
  ).bind(...vals).run();

  return c.json({ success: true });
});

// ─── Delete (cancel) ──────────────────────────────────────────────────────────

appointmentsRouter.delete('/:id', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM appointments WHERE id = ? AND tenantId = ?',
  ).bind(id, tenantId).first();

  if (!existing) return c.json({ error: 'Appointment not found' }, 404);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE appointments SET status = 'cancelled', updatedAt = ? WHERE id = ? AND tenantId = ?",
  ).bind(now, id, tenantId).run();

  // Cancel any scheduled reminders for this appointment
  await c.env.DB.prepare(
    "UPDATE reminder_logs SET status = 'cancelled', updatedAt = ? WHERE appointmentId = ? AND status = 'scheduled'",
  ).bind(now, id).run();

  return c.json({ success: true });
});
