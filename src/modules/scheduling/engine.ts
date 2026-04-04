/**
 * Dynamic Scheduling Engine — WebWaka Services Suite
 *
 * Calculates available appointment time slots for a staff member on a given date.
 * Factors in:
 *   1. Staff's recurring weekly availability windows
 *   2. Existing confirmed/pending appointments (busy periods)
 *   3. Configurable buffer time between appointments
 *   4. Travel time for mobile (field-visit) services — estimated via Haversine
 *
 * Nigeria-First: all times are interpreted as WAT (UTC+1) and stored/returned
 * as UTC ISO strings to maintain the project's timezone invariant.
 *
 * Pure functions are exported for unit-testability; DB-coupled functions
 * accept a D1Database instance and are integration-tested separately.
 */

/** A candidate time slot returned by the scheduling engine. */
export interface TimeSlot {
  /** Start of slot — ISO 8601 UTC string */
  startUtc: string;
  /** End of slot (start + serviceDuration) — ISO 8601 UTC string */
  endUtc: string;
  /** WAT display string, e.g. "Monday 14 Apr at 10:00 AM (WAT)" */
  displayWAT: string;
}

export interface SchedulingRequest {
  /** D1 database instance */
  db: D1Database;
  tenantId: string;
  staffId: string;
  /** ISO date in WAT, e.g. "2025-04-14" */
  date: string;
  /** Total service duration in minutes */
  serviceDurationMinutes: number;
  /** Minutes of buffer to add after each appointment (default: 15) */
  bufferMinutes?: number;
  /** Whether this is a mobile / field-visit appointment */
  isMobile?: boolean;
  /** Client's location for travel time estimation (required when isMobile=true) */
  clientLat?: number;
  clientLng?: number;
  /** Staff base/home location for travel time estimation */
  staffLat?: number;
  staffLng?: number;
}

export interface BusyPeriod {
  startUtc: string;
  endUtc: string; // inclusive of buffer
}

// ─── Haversine Travel Estimator ───────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const AVG_SPEED_KM_PER_MIN = 0.5; // ~30 km/h — Nigerian urban traffic average

/**
 * Estimates one-way road travel time between two GPS coordinates.
 * Uses the Haversine great-circle distance with a fixed urban-traffic speed.
 *
 * @returns Travel time in whole minutes (minimum 5 min, capped at 120 min)
 */
export function estimateTravelMinutes(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(destLat - originLat);
  const dLng = toRad(destLng - originLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(originLat)) * Math.cos(toRad(destLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = EARTH_RADIUS_KM * c;

  const rawMinutes = Math.ceil(distanceKm / AVG_SPEED_KM_PER_MIN);
  return Math.min(120, Math.max(5, rawMinutes));
}

// ─── Slot Generation (pure) ───────────────────────────────────────────────────

/**
 * Converts an "HH:MM" WAT time on a given ISO date (WAT) to a UTC Date.
 * WAT = UTC+1, so we subtract 1 hour.
 */
export function watHHMMtoUTC(isoDateWAT: string, hhmm: string): Date {
  const [y, mo, d] = isoDateWAT.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  // Build as UTC, subtracting the 1-hour WAT offset
  return new Date(Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, (h ?? 0) - 1, m ?? 0));
}

/**
 * Formats a UTC Date as a human-readable WAT string.
 * Example: "Monday 14 Apr at 10:00 AM (WAT)"
 */
export function formatSlotDisplayWAT(utcDate: Date): string {
  const wat = new Date(utcDate.getTime() + 60 * 60 * 1000); // UTC+1
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = days[wat.getUTCDay()] ?? '';
  const monthName = months[wat.getUTCMonth()] ?? '';
  const h = wat.getUTCHours();
  const min = String(wat.getUTCMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${dayName} ${wat.getUTCDate()} ${monthName} at ${h12}:${min} ${period} (WAT)`;
}

/**
 * Generates candidate slots spaced every `slotIntervalMinutes` within a window,
 * then filters out any that overlap with busy periods.
 *
 * @param windowStartUtc  Start of staff availability window (UTC Date)
 * @param windowEndUtc    End of staff availability window (UTC Date)
 * @param totalBlockMinutes  serviceDuration + buffer + optional travel time
 * @param busyPeriods     Sorted list of busy periods to avoid
 * @param slotIntervalMinutes  Step between candidate slot starts (default: 15)
 * @returns Array of available TimeSlot objects
 */
export function generateSlots(
  windowStartUtc: Date,
  windowEndUtc: Date,
  serviceDurationMinutes: number,
  totalBlockMinutes: number,
  busyPeriods: BusyPeriod[],
  slotIntervalMinutes = 15,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const now = new Date();
  // Advance past current time if the window has already partially elapsed
  const effectiveStart = windowStartUtc < now ? now : windowStartUtc;

  let cursor = new Date(effectiveStart.getTime());
  // Align cursor to the next slot interval boundary
  const msInterval = slotIntervalMinutes * 60 * 1000;
  const remainder = cursor.getTime() % msInterval;
  if (remainder !== 0) cursor = new Date(cursor.getTime() + (msInterval - remainder));

  while (cursor.getTime() + totalBlockMinutes * 60 * 1000 <= windowEndUtc.getTime()) {
    const slotEnd = new Date(cursor.getTime() + serviceDurationMinutes * 60 * 1000);
    const blockEnd = new Date(cursor.getTime() + totalBlockMinutes * 60 * 1000);

    const overlaps = busyPeriods.some((busy) => {
      const busyStart = new Date(busy.startUtc).getTime();
      const busyEnd = new Date(busy.endUtc).getTime();
      return cursor.getTime() < busyEnd && blockEnd.getTime() > busyStart;
    });

    if (!overlaps) {
      slots.push({
        startUtc: cursor.toISOString(),
        endUtc: slotEnd.toISOString(),
        displayWAT: formatSlotDisplayWAT(cursor),
      });
    }

    cursor = new Date(cursor.getTime() + msInterval);
  }

  return slots;
}

// ─── DB-Coupled Functions ─────────────────────────────────────────────────────

/**
 * Fetches confirmed and pending appointments for a staff member on a given date,
 * returning them as BusyPeriod objects (inclusive of buffer time).
 */
export async function getStaffBusyPeriods(
  db: D1Database,
  tenantId: string,
  staffId: string,
  isoDateWAT: string,
  bufferMinutes: number,
): Promise<BusyPeriod[]> {
  // Query appointments that overlap with this WAT date.
  // WAT date starts at 23:00 previous UTC day, ends at 22:59 same UTC day.
  const watStart = watHHMMtoUTC(isoDateWAT, '00:00');
  const watEnd = new Date(watStart.getTime() + 24 * 60 * 60 * 1000);

  const { results } = await db
    .prepare(
      `SELECT scheduledAt, durationMinutes FROM appointments
       WHERE tenantId = ? AND staffId = ?
         AND status IN ('confirmed', 'pending')
         AND scheduledAt >= ? AND scheduledAt < ?
       ORDER BY scheduledAt ASC`,
    )
    .bind(tenantId, staffId, watStart.toISOString(), watEnd.toISOString())
    .all<{ scheduledAt: string; durationMinutes: number }>();

  return results.map((row) => {
    const start = new Date(row.scheduledAt);
    const end = new Date(start.getTime() + (row.durationMinutes + bufferMinutes) * 60 * 1000);
    return { startUtc: start.toISOString(), endUtc: end.toISOString() };
  });
}

/**
 * Fetches the staff member's availability window for a given day of week.
 * dayOfWeek: 0 (Sunday) – 6 (Saturday), matching JS Date.getUTCDay() on WAT date.
 */
async function getAvailabilityWindow(
  db: D1Database,
  staffId: string,
  dayOfWeek: number,
): Promise<{ startTime: string; endTime: string } | null> {
  const row = await db
    .prepare(
      'SELECT startTime, endTime FROM staff_availability WHERE staffId = ? AND dayOfWeek = ?',
    )
    .bind(staffId, dayOfWeek)
    .first<{ startTime: string; endTime: string }>();
  return row ?? null;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Calculates available time slots for a staff member on a given date.
 *
 * Returns an empty array if:
 *   - The staff member has no availability window for that day of week
 *   - The day is entirely blocked by existing appointments
 *
 * Travel time is added to the total block per slot (not just to the service
 * duration) so subsequent appointments are also protected from overlap.
 */
export async function calculateAvailableSlots(req: SchedulingRequest): Promise<TimeSlot[]> {
  const {
    db,
    tenantId,
    staffId,
    date,
    serviceDurationMinutes,
    bufferMinutes = 15,
    isMobile = false,
    clientLat,
    clientLng,
    staffLat,
    staffLng,
  } = req;

  // Determine day of week for the WAT date
  const [y, mo, d] = date.split('-').map(Number);
  const watMidnight = new Date(Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, -1, 0)); // UTC-1 = WAT 00:00
  const dayOfWeek = watMidnight.getUTCDay();

  // Load availability window
  const window = await getAvailabilityWindow(db, staffId, dayOfWeek);
  if (!window) return [];

  const windowStartUtc = watHHMMtoUTC(date, window.startTime);
  const windowEndUtc = watHHMMtoUTC(date, window.endTime);

  // Compute travel overhead for mobile services
  let travelMinutes = 0;
  if (
    isMobile &&
    clientLat !== undefined &&
    clientLng !== undefined &&
    staffLat !== undefined &&
    staffLng !== undefined
  ) {
    travelMinutes = estimateTravelMinutes(staffLat, staffLng, clientLat, clientLng);
  }

  // Total block = service + buffer + travel (both ways for mobile)
  const totalBlockMinutes =
    serviceDurationMinutes + bufferMinutes + (isMobile ? travelMinutes * 2 : 0);

  // Fetch existing busy periods
  const busyPeriods = await getStaffBusyPeriods(db, tenantId, staffId, date, bufferMinutes);

  return generateSlots(
    windowStartUtc,
    windowEndUtc,
    serviceDurationMinutes,
    totalBlockMinutes,
    busyPeriods,
  );
}
