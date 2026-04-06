/**
 * External Booking API — WebWaka Services Suite
 *
 * WW-SVC-008: Provides secure, authenticated API endpoints for external
 * service booking platforms to integrate with webwaka-svc_services.
 *
 * Authentication: API Key (not JWT). Partners supply their key as:
 *   Authorization: ApiKey <raw_api_key>
 * The raw key is SHA-256 hashed and compared against `svc_api_keys.keyHashSha256`.
 *
 * Routes (all under /external/):
 *   GET  /external/svc_services                — list available svc_services for a tenant
 *   GET  /external/availability            — get available slots for a service + date
 *   POST /external/svc_appointments            — book an appointment (returns booking ID)
 *   GET  /external/svc_appointments/:id        — retrieve booking status
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

/**
 * Hono context Variables for the external (API-key-authenticated) router.
 * Separate from AppVariables (JWT-based) — populated by the API key middleware below.
 */
interface ExternalVariables {
  /** Tenant ID resolved from the API key record */
  tenantId: string;
  /** Comma-separated scopes granted to the API key */
  keyScopes: string;
}

export const externalRouter = new Hono<{ Bindings: Bindings; Variables: ExternalVariables }>();

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
     FROM svc_api_keys
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
  c.env.DB.prepare('UPDATE svc_api_keys SET lastUsedAt = ? WHERE id = ?')
    .bind(new Date().toISOString(), keyRecord.id)
    .run()
    .catch(() => null);

  // Inject tenant context into properly typed Hono Variables
  c.set('tenantId', keyRecord.tenantId);
  c.set('keyScopes', keyRecord.scopes);

  return await next();
});

// ─── List Available Services ───────────────────────────────────────────────────

externalRouter.get('/svc_services', async (c) => {
  const tenantId = c.get('tenantId');

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, description, durationMinutes, basePriceKobo
     FROM svc_services
     WHERE tenantId = ? AND isActive = 1
     ORDER BY name ASC`,
  )
    .bind(tenantId)
    .all();

  // Format prices for display (kobo → naira with ₦ symbol)
  const svc_services = results.map((s) => {
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

  return c.json({ data: svc_services });
});

// ─── Get Available Slots ──────────────────────────────────────────────────────
// External partners query this to show time slots to their users.

externalRouter.get('/availability', async (c) => {
  const tenantId = c.get('tenantId');

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
    'SELECT id, name, durationMinutes, basePriceKobo FROM svc_services WHERE id = ? AND tenantId = ? AND isActive = 1',
  )
    .bind(serviceId, tenantId)
    .first<{ id: string; name: string; durationMinutes: number; basePriceKobo: number }>();

  if (!service) return c.json({ error: 'Service not found or inactive' }, 404);

  // If staffId is specified, get slots for that svc_staff only; otherwise get all available svc_staff
  if (staffId) {
    const staffExists = await c.env.DB.prepare(
      "SELECT id, name FROM svc_staff WHERE id = ? AND tenantId = ? AND status = 'active'",
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
        svc_staff: staffExists,
        date,
        slots,
      },
    });
  }

  // No staffId — fetch all available svc_staff slots
  const { results: allStaff } = await c.env.DB.prepare(
    "SELECT id, name FROM svc_staff WHERE tenantId = ? AND status = 'active' ORDER BY name ASC",
  )
    .bind(tenantId)
    .all<{ id: string; name: string }>();

  const availabilityByStaff: Array<{ staffId: string; staffName: string; slots: unknown[] }> = [];

  for (const svc_staff of allStaff) {
    try {
      const slots = await calculateAvailableSlots({
        db: c.env.DB,
        tenantId,
        staffId: svc_staff.id,
        date,
        serviceDurationMinutes: service.durationMinutes,
        bufferMinutes: 15,
        isMobile: false,
      });
      if (slots.length > 0) {
        availabilityByStaff.push({ staffId: svc_staff.id, staffName: svc_staff.name, slots });
      }
    } catch {
      // Skip svc_staff with no availability configured
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

externalRouter.post('/svc_appointments', async (c) => {
  const tenantId = c.get('tenantId');
  const scopes = c.get('keyScopes') ?? '';

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
    'SELECT id, name, durationMinutes FROM svc_services WHERE id = ? AND tenantId = ? AND isActive = 1',
  )
    .bind(body.serviceId, tenantId)
    .first<{ id: string; name: string; durationMinutes: number }>();

  if (!service) return c.json({ error: 'Service not found or inactive' }, 404);

  // Validate svc_staff if provided
  if (body.staffId) {
    const staffExists = await c.env.DB.prepare(
      "SELECT id FROM svc_staff WHERE id = ? AND tenantId = ? AND status = 'active'",
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
    `INSERT INTO svc_appointments
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

  // Auto-schedule 24h + 1h reminders (WW-SVC-005)
  const apptMs = scheduledDate.getTime();
  const nowMs = Date.now();
  for (const offsetMs of [24 * 60 * 60 * 1000, 60 * 60 * 1000]) {
    const reminderMs = apptMs - offsetMs;
    if (reminderMs > nowMs) {
      const reminderId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO svc_reminder_logs
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

externalRouter.get('/svc_appointments/:id', async (c) => {
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    `SELECT id, service, scheduledAt, durationMinutes, status, clientPhone, clientName, notes
     FROM svc_appointments WHERE id = ? AND tenantId = ?`,
  )
    .bind(id, tenantId)
    .first();

  if (!row) return c.json({ error: 'Booking not found' }, 404);
  return c.json({ data: row });
});
