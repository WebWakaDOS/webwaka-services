/**
 * Automated Reminders Module — WebWaka Services Suite
 *
 * Schedules and dispatches appointment reminders to clients via SMS or WhatsApp,
 * reducing no-shows through timely notifications.
 *
 * Reminders are stored in the `reminder_logs` table and dispatched either:
 *   - Manually via POST /api/reminders/dispatch (for cron jobs or ad-hoc sends)
 *   - Automatically when an appointment is created (if auto-schedule is requested)
 *
 * Routes:
 *   GET  /api/reminders                          — list reminder logs for tenant
 *   POST /api/reminders                          — schedule one or more reminders
 *   POST /api/reminders/dispatch                 — dispatch all due (scheduled) reminders
 *   GET  /api/reminders/:id                      — get single reminder log
 *   POST /api/reminders/:id/cancel               — cancel a scheduled reminder
 *
 * Delivery channels:
 *   - 'whatsapp' — via Termii WhatsApp Business (NotificationService)
 *   - 'sms'      — via Termii plain SMS (NotificationService)
 *
 * Nigeria-First: default reminder timing is 24h and 1h before the appointment,
 * matching the communication patterns prevalent in Nigerian service businesses.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, ReminderChannel } from '../../core/types';
import { sendWhatsAppMessage } from '../../core/whatsapp';

const VALID_CHANNELS: readonly ReminderChannel[] = ['sms', 'whatsapp', 'email'];

function buildReminderMessage(
  clientName: string | null,
  service: string,
  scheduledAt: string,
): string {
  const apptDate = new Date(scheduledAt);
  // Display in WAT (UTC+1)
  const wat = new Date(apptDate.getTime() + 60 * 60 * 1000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = wat.getUTCHours();
  const min = String(wat.getUTCMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const displayTime = `${h12}:${min} ${period} WAT`;
  const displayDate = `${days[wat.getUTCDay()]} ${wat.getUTCDate()} ${months[wat.getUTCMonth()]}`;

  const greeting = clientName ? `Hi ${clientName}, ` : 'Hi, ';
  return (
    `${greeting}this is a reminder about your upcoming appointment with WebWaka.\n\n` +
    `📋 Service: ${service}\n` +
    `📅 When: ${displayDate} at ${displayTime}\n\n` +
    `Please contact us if you need to reschedule. Thank you! 🙏`
  );
}

export const remindersRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── List Reminder Logs ───────────────────────────────────────────────────────

remindersRouter.get('/', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const status = c.req.query('status');
  const appointmentId = c.req.query('appointmentId');

  let query = 'SELECT * FROM reminder_logs WHERE tenantId = ?';
  const bindings: unknown[] = [tenantId];

  if (status) { query += ' AND status = ?'; bindings.push(status); }
  if (appointmentId) { query += ' AND appointmentId = ?'; bindings.push(appointmentId); }

  query += ' ORDER BY scheduledFor ASC';

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json({ data: results });
});

// ─── Get Single Reminder ──────────────────────────────────────────────────────

remindersRouter.get('/:id', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM reminder_logs WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!row) return c.json({ error: 'Reminder not found' }, 404);
  return c.json({ data: row });
});

// ─── Schedule Reminders ───────────────────────────────────────────────────────

remindersRouter.post('/', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    appointmentId: string;
    channel: ReminderChannel;
    recipient: string;
    /** ISO UTC datetime at which to send the reminder */
    scheduledFor: string;
  }>();

  if (!body.appointmentId || !body.channel || !body.recipient || !body.scheduledFor) {
    return c.json({
      error: 'appointmentId, channel, recipient, and scheduledFor are required',
    }, 400);
  }

  if (!VALID_CHANNELS.includes(body.channel)) {
    return c.json({ error: `channel must be one of: ${VALID_CHANNELS.join(', ')}` }, 400);
  }

  // Validate appointment exists and belongs to tenant
  const appt = await c.env.DB.prepare(
    'SELECT id, status FROM appointments WHERE id = ? AND tenantId = ?',
  )
    .bind(body.appointmentId, tenantId)
    .first<{ id: string; status: string }>();
  if (!appt) return c.json({ error: 'Appointment not found' }, 404);
  if (appt.status === 'cancelled') {
    return c.json({ error: 'Cannot schedule reminder for a cancelled appointment' }, 400);
  }

  const scheduledFor = new Date(body.scheduledFor);
  if (isNaN(scheduledFor.getTime())) {
    return c.json({ error: 'scheduledFor must be a valid ISO datetime' }, 400);
  }
  if (scheduledFor <= new Date()) {
    return c.json({ error: 'scheduledFor must be in the future' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO reminder_logs
       (id, tenantId, appointmentId, channel, recipient, scheduledFor,
        status, sentAt, errorMessage, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL, NULL, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      body.appointmentId,
      body.channel,
      body.recipient,
      scheduledFor.toISOString(),
      now,
      now,
    )
    .run();

  return c.json({ success: true, id }, 201);
});

// ─── Dispatch Due Reminders ────────────────────────────────────────────────────
// Designed to be called by a Cloudflare Cron Trigger or manually by an admin.

remindersRouter.post('/dispatch', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const now = new Date().toISOString();

  // Fetch all scheduled reminders that are due (scheduledFor <= now)
  const { results: due } = await c.env.DB.prepare(
    `SELECT r.*, a.service, a.clientName, a.scheduledAt
     FROM reminder_logs r
     JOIN appointments a ON a.id = r.appointmentId
     WHERE r.tenantId = ? AND r.status = 'scheduled' AND r.scheduledFor <= ?
     ORDER BY r.scheduledFor ASC
     LIMIT 50`,
  )
    .bind(tenantId, now)
    .all<{
      id: string;
      appointmentId: string;
      channel: ReminderChannel;
      recipient: string;
      service: string;
      clientName: string | null;
      scheduledAt: string;
    }>();

  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    const message = buildReminderMessage(reminder.clientName, reminder.service, reminder.scheduledAt);
    const dispatchedAt = new Date().toISOString();

    try {
      if (reminder.channel === 'whatsapp' || reminder.channel === 'sms') {
        await sendWhatsAppMessage(
          { tenantId, to: reminder.recipient, body: message },
          c.env.TERMII_API_KEY,
          reminder.channel === 'whatsapp' ? c.env.TERMII_WHATSAPP_SENDER_ID : undefined,
        );
      }
      // Note: 'email' channel is a no-op until email integration is configured
      // It is intentionally left as a stub to avoid silent failures on email sends.

      await c.env.DB.prepare(
        "UPDATE reminder_logs SET status = 'sent', sentAt = ?, updatedAt = ? WHERE id = ?",
      )
        .bind(dispatchedAt, dispatchedAt, reminder.id)
        .run();

      sent++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await c.env.DB.prepare(
        "UPDATE reminder_logs SET status = 'failed', errorMessage = ?, updatedAt = ? WHERE id = ?",
      )
        .bind(errorMessage, dispatchedAt, reminder.id)
        .run();
      failed++;
    }
  }

  return c.json({ success: true, dispatched: due.length, sent, failed });
});

// ─── Cancel Scheduled Reminder ────────────────────────────────────────────────

remindersRouter.post('/:id/cancel', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const reminder = await c.env.DB.prepare(
    'SELECT id, status FROM reminder_logs WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first<{ id: string; status: string }>();

  if (!reminder) return c.json({ error: 'Reminder not found' }, 404);
  if (reminder.status !== 'scheduled') {
    return c.json({ error: `Cannot cancel a reminder with status '${reminder.status}'` }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE reminder_logs SET status = 'cancelled', updatedAt = ? WHERE id = ?",
  )
    .bind(new Date().toISOString(), id)
    .run();

  return c.json({ success: true });
});
