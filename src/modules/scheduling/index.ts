/**
 * Scheduling Module — REST API for the Dynamic Scheduling Engine
 *
 * Exposes the scheduling engine to authenticated callers, enabling clients
 * and front-ends to discover available appointment slots in real time.
 *
 * Routes:
 *   GET /api/scheduling/slots
 *     Query params:
 *       - staffId (required)        — staff member UUID
 *       - date (required)           — ISO date in WAT, e.g. "2025-04-14"
 *       - duration (required)       — service duration in minutes
 *       - buffer (optional)         — buffer minutes between appointments (default: 15)
 *       - mobile (optional)         — "1" to enable travel-time calculation
 *       - clientLat/clientLng       — client GPS coordinates (required if mobile=1)
 *       - staffLat/staffLng         — staff home/base GPS coordinates (required if mobile=1)
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';
import { calculateAvailableSlots } from './engine';

export const schedulingRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

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
