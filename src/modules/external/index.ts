/**
 * External Booking API — WebWaka Services Suite
 *
 * WW-SVC-008: Provides secure, authenticated API endpoints for external
 * service booking platforms to integrate with webwaka-services.
 *
 * Authentication: API Key (not JWT). Partners supply their key as:
 *   Authorization: ApiKey <raw_api_key>
 * The raw key is SHA-256 hashed and compared against `api_keys.keyHashSha256`.
 *
 * Routes (all under /external/):
 *   GET  /external/services                — list available services for a tenant
 *   GET  /external/availability            — get available slots for a service + date
 *   POST /external/appointments            — book an appointment (returns booking ID)
 *   GET  /external/appointments/:id        — retrieve booking status
 *
 * Tenant resolution: API keys are scoped to a tenant, so no tenantId is
 * required in the request body — it is resolved from the API key record.
 *
 * Rate limiting: applied at the worker level on /external/* routes (30 req/min).
 */

import { Hono } from 'hono';
import type { Bindings } from '../../core/types';
import { calculateAvailableSlots } from '../scheduling/engine';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiKeyRecord {
  id: string;
  tenantId: string;
  label: string;
  scopes: string;
  isActive: number;
  expiresAt: string | null;
}

export const externalRouter = new Hono<{ Bindings: Bindings }>();

// ─── API Key Authentication Middleware ────────────────────────────────────────

async function hashApiKey(rawKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

externalRouter.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization') ?? '';

  if (!authHeader.startsWith('ApiKey ')) {
    return c.json({ error: 'Authentication required. Use: Authorization: ApiKey <key>' }, 401);
  }

  const rawKey = authHeader.slice('ApiKey '.length).trim();
  if (!rawKey) {
    return c.json({ error: 'Empty API key' }, 401);
  }

  const keyHash = await hashApiKey(rawKey);

  const keyRecord = await c.env.DB.prepare(
    `SELECT id, tenantId, label, scopes, isActive, expiresAt
     FROM api_keys
     WHERE keyHashSha256 = ? AND isActive = 1`,
  )
    .bind(keyHash)
    .first<ApiKeyRecord>();

  if (!keyRecord) {
    return c.json({ error: 'Invalid or revoked API key' }, 401);
  }

  // Check expiry
  if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
    return c.json({ error: 'API key has expired' }, 401);
  }

  // Update last used timestamp (fire-and-forget)
  c.env.DB.prepare('UPDATE api_keys SET lastUsedAt = ? WHERE id = ?')
    .bind(new Date().toISOString(), keyRecord.id)
    .run()
    .catch(() => null);

  // Inject tenant context
  c.set('tenantId' as never, keyRecord.tenantId as never);
  c.set('keyScopes' as never, keyRecord.scopes as never);

  return await next();
});

// ─── List Available Services ───────────────────────────────────────────────────

externalRouter.get('/services', async (c) => {
  const tenantId = c.get('tenantId' as never) as string;

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, description, durationMinutes, basePriceKobo
     FROM services
     WHERE tenantId = ? AND isActive = 1
     ORDER BY name ASC`,
  )
    .bind(tenantId)
    .all();

  // Format prices for display (kobo → naira with ₦ symbol)
  const services = results.map((s) => {
    const service = s as { id: string; name: string; description: string | null; durationMinutes: number; basePriceKobo: number };
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      basePriceKobo: service.basePriceKobo,
      basePriceDisplay: `₦${(service.basePriceKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
    };
  });

  return c.json({ data: services });
});

// ─── Get Available Slots ──────────────────────────────────────────────────────
// External partners query this to show time slots to their users.

externalRouter.get('/availability', async (c) => {
  const tenantId = c.get('tenantId' as never) as string;

  const serviceId = c.req.query('serviceId');
  const date = c.req.query('date');
  const staffId = c.req.query('staffId');

  if (!serviceId || !date) {
    return c.json({ error: 'serviceId and date are required' }, 400);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'date must be in YYYY-MM-DD format' }, 400);
  }

  // Resolve service duration from catalog
  const service = await c.env.DB.prepare(
    'SELECT id, name, durationMinutes, basePriceKobo FROM services WHERE id = ? AND tenantId = ? AND isActive = 1',
  )
    .bind(serviceId, tenantId)
    .first<{ id: string; name: string; durationMinutes: number; basePriceKobo: number }>();

  if (!service) return c.json({ error: 'Service not found or inactive' }, 404);

  // If staffId is specified, get slots for that staff only; otherwise get all available staff
  if (staffId) {
    const staffExists = await c.env.DB.prepare(
      "SELECT id, name FROM staff WHERE id = ? AND tenantId = ? AND status = 'active'",
    )
      .bind(staffId, tenantId)
      .first<{ id: string; name: string }>();

    if (!staffExists) return c.json({ error: 'Staff member not found or inactive' }, 404);

    const slots = await calculateAvailableSlots({
      db: c.env.DB,
      tenantId,
      staffId,
      date,
      serviceDurationMinutes: service.durationMinutes,
      bufferMinutes: 15,
      isMobile: false,
    });

    return c.json({
      data: {
        service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
        staff: staffExists,
        date,
        slots,
      },
    });
  }

  // No staffId — fetch all available staff slots
  const { results: allStaff } = await c.env.DB.prepare(
    "SELECT id, name FROM staff WHERE tenantId = ? AND status = 'active' ORDER BY name ASC",
  )
    .bind(tenantId)
    .all<{ id: string; name: string }>();

  const availabilityByStaff: Array<{ staffId: string; staffName: string; slots: unknown[] }> = [];

  for (const staff of allStaff) {
    try {
      const slots = await calculateAvailableSlots({
        db: c.env.DB,
        tenantId,
        staffId: staff.id,
        date,
        serviceDurationMinutes: service.durationMinutes,
        bufferMinutes: 15,
        isMobile: false,
      });
      if (slots.length > 0) {
        availabilityByStaff.push({ staffId: staff.id, staffName: staff.name, slots });
      }
    } catch {
      // Skip staff with no availability configured
    }
  }

  return c.json({
    data: {
      service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
      date,
      availability: availabilityByStaff,
    },
  });
});

// ─── Book an Appointment ──────────────────────────────────────────────────────

externalRouter.post('/appointments', async (c) => {
  const tenantId = c.get('tenantId' as never) as string;
  const scopes: string = c.get('keyScopes' as never) as string ?? '';

  if (!scopes.includes('bookings:write')) {
    return c.json({ error: 'Insufficient scope: bookings:write required' }, 403);
  }

  const body = await c.req.json<{
    serviceId: string;
    staffId?: string;
    scheduledAt: string;
    clientPhone: string;
    clientName?: string;
    clientEmail?: string;
    notes?: string;
  }>();

  if (!body.serviceId || !body.scheduledAt || !body.clientPhone) {
    return c.json({ error: 'serviceId, scheduledAt, and clientPhone are required' }, 400);
  }

  // Validate scheduled time is in future
  const scheduledDate = new Date(body.scheduledAt);
  if (isNaN(scheduledDate.getTime())) {
    return c.json({ error: 'scheduledAt must be a valid ISO 8601 datetime' }, 400);
  }
  if (scheduledDate <= new Date()) {
    return c.json({ error: 'scheduledAt must be in the future' }, 400);
  }

  // Resolve service
  const service = await c.env.DB.prepare(
    'SELECT id, name, durationMinutes FROM services WHERE id = ? AND tenantId = ? AND isActive = 1',
  )
    .bind(body.serviceId, tenantId)
    .first<{ id: string; name: string; durationMinutes: number }>();

  if (!service) return c.json({ error: 'Service not found or inactive' }, 404);

  // Validate staff if provided
  if (body.staffId) {
    const staffExists = await c.env.DB.prepare(
      "SELECT id FROM staff WHERE id = ? AND tenantId = ? AND status = 'active'",
    )
      .bind(body.staffId, tenantId)
      .first();

    if (!staffExists) return c.json({ error: 'Staff member not found or inactive' }, 404);

    // Double-booking check
    const { checkDoubleBooking } = await import('../appointments/index');
    const conflict = await checkDoubleBooking(
      c.env.DB,
      tenantId,
      body.staffId,
      body.scheduledAt,
      service.durationMinutes,
    );

    if (conflict.hasConflict) {
      return c.json({
        error: 'The selected time slot is no longer available',
        conflictingAppointmentId: conflict.conflictingId,
      }, 409);
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO appointments
       (id, tenantId, clientPhone, clientName, service, scheduledAt,
        durationMinutes, status, notes, staffId, isMobile, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      body.clientPhone,
      body.clientName ?? null,
      service.name,
      body.scheduledAt,
      service.durationMinutes,
      body.notes ?? null,
      body.staffId ?? null,
      now,
      now,
    )
    .run();

  // Auto-schedule 24h + 1h reminders
  const apptMs = scheduledDate.getTime();
  const nowMs = Date.now();
  for (const offsetMs of [24 * 60 * 60 * 1000, 60 * 60 * 1000]) {
    const reminderMs = apptMs - offsetMs;
    if (reminderMs > nowMs) {
      const reminderId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO reminder_logs
           (id, tenantId, appointmentId, channel, recipient, scheduledFor,
            status, sentAt, errorMessage, createdAt, updatedAt)
         VALUES (?, ?, ?, 'whatsapp', ?, ?, 'scheduled', NULL, NULL, ?, ?)`,
      )
        .bind(reminderId, tenantId, id, body.clientPhone, new Date(reminderMs).toISOString(), now, now)
        .run();
    }
  }

  return c.json({
    success: true,
    booking: {
      id,
      service: service.name,
      scheduledAt: body.scheduledAt,
      durationMinutes: service.durationMinutes,
      status: 'pending',
    },
  }, 201);
});

// ─── Get Booking Status ────────────────────────────────────────────────────────

externalRouter.get('/appointments/:id', async (c) => {
  const tenantId = c.get('tenantId' as never) as string;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    `SELECT id, service, scheduledAt, durationMinutes, status, clientPhone, clientName, notes
     FROM appointments WHERE id = ? AND tenantId = ?`,
  )
    .bind(id, tenantId)
    .first();

  if (!row) return c.json({ error: 'Booking not found' }, 404);
  return c.json({ data: row });
});
