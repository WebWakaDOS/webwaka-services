/**
 * Scheduling Module — REST API for the Dynamic Scheduling Engine
 *
 * Exposes the scheduling engine to authenticated callers, enabling svc_clients
 * and front-ends to discover available appointment slots in real time.
 *
 * Routes:
 *   GET /api/scheduling/slots
 *     Query params:
 *       - staffId (required)        — svc_staff member UUID
 *       - date (required)           — ISO date in WAT, e.g. "2025-04-14"
 *       - duration (required)       — service duration in minutes
 *       - buffer (optional)         — buffer minutes between svc_appointments (default: 15)
 *       - mobile (optional)         — "1" to enable travel-time calculation
 *       - clientLat/clientLng       — client GPS coordinates (required if mobile=1)
 *       - staffLat/staffLng         — svc_staff home/base GPS coordinates (required if mobile=1)
 *
 *   GET /api/scheduling/available-svc_staff
 *     WW-SVC-004: Find all svc_staff members who have open slots on a given date/duration.
 *     Query params:
 *       - date (required)       — ISO date in WAT, e.g. "2025-04-14"
 *       - duration (required)   — service duration in minutes
 *       - serviceId (optional)  — filter svc_staff by skill/service match
 *       - buffer (optional)     — buffer minutes between svc_appointments (default: 15)
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';
import { calculateAvailableSlots } from './engine';

export const schedulingRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Available Slots for a Staff Member ───────────────────────────────────────

schedulingRouter.get('/slots', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const tenantId = c.get('user').tenantId;

  const staffId = c.req.query('staffId');
  const date = c.req.query('date');
  const durationStr = c.req.query('duration');

  if (!staffId || !date || !durationStr) {
    return c.json({ error: 'staffId, date, and duration are required query params' }, 400);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'date must be in YYYY-MM-DD format' }, 400);
  }

  const serviceDurationMinutes = parseInt(durationStr, 10);
  if (isNaN(serviceDurationMinutes) || serviceDurationMinutes <= 0) {
    return c.json({ error: 'duration must be a positive integer (minutes)' }, 400);
  }

  const bufferStr = c.req.query('buffer');
  const bufferMinutes = bufferStr ? parseInt(bufferStr, 10) : 15;
  if (isNaN(bufferMinutes) || bufferMinutes < 0) {
    return c.json({ error: 'buffer must be a non-negative integer (minutes)' }, 400);
  }

  const isMobile = c.req.query('mobile') === '1';

  let clientLat: number | undefined;
  let clientLng: number | undefined;
  let staffLat: number | undefined;
  let staffLng: number | undefined;

  if (isMobile) {
    clientLat = parseFloat(c.req.query('clientLat') ?? '');
    clientLng = parseFloat(c.req.query('clientLng') ?? '');
    staffLat = parseFloat(c.req.query('staffLat') ?? '');
    staffLng = parseFloat(c.req.query('staffLng') ?? '');

    if ([clientLat, clientLng, staffLat, staffLng].some(isNaN)) {
      return c.json({
        error: 'clientLat, clientLng, staffLat, staffLng are required when mobile=1',
      }, 400);
    }
  }

  const slots = await calculateAvailableSlots({
    db: c.env.DB,
    tenantId,
    staffId,
    date,
    serviceDurationMinutes,
    bufferMinutes,
    isMobile,
    ...(clientLat !== undefined ? { clientLat } : {}),
    ...(clientLng !== undefined ? { clientLng } : {}),
    ...(staffLat !== undefined ? { staffLat } : {}),
    ...(staffLng !== undefined ? { staffLng } : {}),
  });

  return c.json({
    data: slots,
    meta: {
      date,
      staffId,
      serviceDurationMinutes,
      bufferMinutes,
      isMobile,
      totalSlots: slots.length,
    },
  });
});

// ─── Available Staff for a Date + Duration (WW-SVC-004) ───────────────────────
// Returns a list of active svc_staff members who have at least one open slot
// on the given date for the requested service duration.
// Optionally filters by service if a svc_services catalog entry is provided.

schedulingRouter.get('/available-svc_staff', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const tenantId = c.get('user').tenantId;

  const date = c.req.query('date');
  const durationStr = c.req.query('duration');
  const serviceId = c.req.query('serviceId');

  if (!date || !durationStr) {
    return c.json({ error: 'date and duration are required query params' }, 400);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'date must be in YYYY-MM-DD format' }, 400);
  }

  const serviceDurationMinutes = parseInt(durationStr, 10);
  if (isNaN(serviceDurationMinutes) || serviceDurationMinutes <= 0) {
    return c.json({ error: 'duration must be a positive integer (minutes)' }, 400);
  }

  const bufferStr = c.req.query('buffer');
  const bufferMinutes = bufferStr ? parseInt(bufferStr, 10) : 15;

  // If serviceId is provided, look up the service to verify it exists
  let resolvedDuration = serviceDurationMinutes;
  if (serviceId) {
    const service = await c.env.DB.prepare(
      'SELECT durationMinutes FROM svc_services WHERE id = ? AND tenantId = ? AND isActive = 1',
    )
      .bind(serviceId, tenantId)
      .first<{ durationMinutes: number }>();

    if (!service) return c.json({ error: 'Service not found or inactive' }, 404);
    // Use the service's configured duration if no override was passed
    resolvedDuration = serviceDurationMinutes || service.durationMinutes;
  }

  // Fetch all active svc_staff for this tenant
  const { results: allStaff } = await c.env.DB.prepare(
    "SELECT id, name, email, phone, role, skills FROM svc_staff WHERE tenantId = ? AND status = 'active' ORDER BY name ASC",
  )
    .bind(tenantId)
    .all<{ id: string; name: string; email: string; phone: string; role: string; skills: string }>();

  if (allStaff.length === 0) {
    return c.json({ data: [], meta: { date, duration: resolvedDuration, staffChecked: 0 } });
  }

  // For each svc_staff member, calculate their available slots and include those with at least 1
  const availableStaff: Array<{
    staffId: string;
    name: string;
    role: string;
    availableSlots: number;
    firstSlotUtc: string | null;
  }> = [];

  for (const svc_staff of allStaff) {
    try {
      const slots = await calculateAvailableSlots({
        db: c.env.DB,
        tenantId,
        staffId: svc_staff.id,
        date,
        serviceDurationMinutes: resolvedDuration,
        bufferMinutes,
        isMobile: false,
      });

      if (slots.length > 0) {
        availableStaff.push({
          staffId: svc_staff.id,
          name: svc_staff.name,
          role: svc_staff.role,
          availableSlots: slots.length,
          firstSlotUtc: slots[0]?.startUtc ?? null,
        });
      }
    } catch {
      // Skip svc_staff members with scheduling errors (e.g. no availability configured)
    }
  }

  return c.json({
    data: availableStaff,
    meta: {
      date,
      duration: resolvedDuration,
      bufferMinutes,
      serviceId: serviceId ?? null,
      staffChecked: allStaff.length,
      staffAvailable: availableStaff.length,
    },
  });
});
