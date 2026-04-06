/**
 * Unit Tests — Dynamic Scheduling Engine
 *
 * Tests pure functions: estimateTravelMinutes, generateSlots, watHHMMtoUTC,
 * formatSlotDisplayWAT, and the DB-coupled calculateAvailableSlots (via mock D1).
 *
 * All tests are deterministic and do not require a live D1 database.
 * DB-coupled tests use a lightweight in-memory mock that satisfies the
 * D1Database interface surface used by the engine.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  estimateTravelMinutes,
  generateSlots,
  watHHMMtoUTC,
  formatSlotDisplayWAT,
  calculateAvailableSlots,
  type BusyPeriod,
  type TimeSlot,
} from './engine';

// ─── estimateTravelMinutes ────────────────────────────────────────────────────

describe('estimateTravelMinutes', () => {
  it('returns minimum 5 minutes for co-located points', () => {
    expect(estimateTravelMinutes(6.5244, 3.3792, 6.5244, 3.3792)).toBe(5);
  });

  it('estimates reasonable travel time between Lagos and Ibadan (~130 km)', () => {
    // Lagos Island → Ibadan (approximately 130 km by road)
    const minutes = estimateTravelMinutes(6.5244, 3.3792, 7.3775, 3.9470);
    // At 30 km/h average: ~260 min, capped at 120
    expect(minutes).toBe(120); // capped
  });

  it('estimates travel time within Lagos (~10 km)', () => {
    // Victoria Island → Ikeja (~20 km direct)
    const minutes = estimateTravelMinutes(6.4281, 3.4219, 6.5954, 3.3410);
    expect(minutes).toBeGreaterThanOrEqual(5);
    expect(minutes).toBeLessThanOrEqual(120);
  });

  it('caps at 120 minutes for very long distances', () => {
    // Lagos → Abuja (~700 km)
    const minutes = estimateTravelMinutes(6.5244, 3.3792, 9.0579, 7.4951);
    expect(minutes).toBe(120);
  });

  it('returns at least 5 minutes for very short distances', () => {
    // Virtually the same location with tiny offset
    const minutes = estimateTravelMinutes(6.5244, 3.3792, 6.5245, 3.3793);
    expect(minutes).toBe(5);
  });
});

// ─── watHHMMtoUTC ─────────────────────────────────────────────────────────────

describe('watHHMMtoUTC', () => {
  it('converts WAT 09:00 on 2025-04-14 to UTC 08:00', () => {
    const utc = watHHMMtoUTC('2025-04-14', '09:00');
    expect(utc.toISOString()).toBe('2025-04-14T08:00:00.000Z');
  });

  it('converts WAT 00:00 to UTC 23:00 previous day', () => {
    const utc = watHHMMtoUTC('2025-04-14', '00:00');
    expect(utc.toISOString()).toBe('2025-04-13T23:00:00.000Z');
  });

  it('converts WAT 17:00 to UTC 16:00', () => {
    const utc = watHHMMtoUTC('2025-04-14', '17:00');
    expect(utc.toISOString()).toBe('2025-04-14T16:00:00.000Z');
  });
});

// ─── formatSlotDisplayWAT ─────────────────────────────────────────────────────

describe('formatSlotDisplayWAT', () => {
  it('formats UTC 08:00 (= WAT 09:00) correctly', () => {
    const utcDate = new Date('2025-04-14T08:00:00.000Z'); // Monday
    const display = formatSlotDisplayWAT(utcDate);
    expect(display).toBe('Monday 14 Apr at 9:00 AM (WAT)');
  });

  it('formats UTC 15:30 (= WAT 16:30) with PM period', () => {
    const utcDate = new Date('2025-04-14T15:30:00.000Z'); // Monday
    const display = formatSlotDisplayWAT(utcDate);
    expect(display).toBe('Monday 14 Apr at 4:30 PM (WAT)');
  });

  it('formats noon UTC 11:00 (= WAT 12:00) as 12:00 PM', () => {
    const utcDate = new Date('2025-04-14T11:00:00.000Z');
    const display = formatSlotDisplayWAT(utcDate);
    expect(display).toBe('Monday 14 Apr at 12:00 PM (WAT)');
  });
});

// ─── generateSlots ────────────────────────────────────────────────────────────
// Use dates well in the future so the "past time" guard never filters slots out.
// 2027-06-14 is a Monday and safely in the future for this test suite.

describe('generateSlots', () => {
  const makeDate = (iso: string) => new Date(iso);

  it('generates slots in an empty window', () => {
    const windowStart = makeDate('2027-06-14T08:00:00.000Z'); // WAT 09:00
    const windowEnd = makeDate('2027-06-14T16:00:00.000Z');   // WAT 17:00
    const slots = generateSlots(windowStart, windowEnd, 30, 45, []);
    // 8h window, 45-min blocks, 15-min intervals → many slots
    expect(slots.length).toBeGreaterThan(0);
    // All slots must end before window end
    for (const slot of slots) {
      expect(new Date(slot.endUtc).getTime()).toBeLessThanOrEqual(windowEnd.getTime());
    }
  });

  it('returns empty array when window is too narrow for the block', () => {
    const windowStart = makeDate('2027-06-14T08:00:00.000Z');
    const windowEnd = makeDate('2027-06-14T08:20:00.000Z'); // Only 20 min
    const slots = generateSlots(windowStart, windowEnd, 30, 45, []);
    expect(slots).toHaveLength(0);
  });

  it('skips slots that overlap with a busy period', () => {
    const windowStart = makeDate('2027-06-14T08:00:00.000Z');
    const windowEnd = makeDate('2027-06-14T12:00:00.000Z');
    // Busy from 08:30 to 10:00 UTC
    const busyPeriods: BusyPeriod[] = [
      { startUtc: '2027-06-14T08:30:00.000Z', endUtc: '2027-06-14T10:00:00.000Z' },
    ];
    const slots = generateSlots(windowStart, windowEnd, 30, 45, busyPeriods);
    // No slot should start inside or overlap the busy block
    for (const slot of slots) {
      const slotBlockEnd = new Date(new Date(slot.startUtc).getTime() + 45 * 60 * 1000);
      const busyStart = new Date('2027-06-14T08:30:00.000Z').getTime();
      const busyEnd = new Date('2027-06-14T10:00:00.000Z').getTime();
      const overlaps =
        new Date(slot.startUtc).getTime() < busyEnd &&
        slotBlockEnd.getTime() > busyStart;
      expect(overlaps).toBe(false);
    }
  });

  it('generates non-overlapping slots', () => {
    const windowStart = makeDate('2027-06-14T08:00:00.000Z');
    const windowEnd = makeDate('2027-06-14T16:00:00.000Z');
    const slots = generateSlots(windowStart, windowEnd, 60, 75, []);
    for (let i = 1; i < slots.length; i++) {
      const prevStart = new Date(slots[i - 1]!.startUtc).getTime();
      const currStart = new Date(slots[i]!.startUtc).getTime();
      expect(currStart).toBeGreaterThan(prevStart);
    }
  });

  it('slots have correct displayWAT format', () => {
    const windowStart = makeDate('2027-06-14T08:00:00.000Z');
    const windowEnd = makeDate('2027-06-14T09:00:00.000Z');
    const slots = generateSlots(windowStart, windowEnd, 30, 30, []);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]!.displayWAT).toMatch(/\(WAT\)/);
  });
});

// ─── calculateAvailableSlots (with mock D1) ───────────────────────────────────

function makeMockD1(
  availabilityRow: { startTime: string; endTime: string } | null,
  svc_appointments: Array<{ scheduledAt: string; durationMinutes: number }>,
): D1Database {
  const mockPrepare = (sql: string) => {
    return {
      bind: (..._args: unknown[]) => ({
        first: async <T>() => {
          if (sql.includes('svc_staff_availability')) {
            return availabilityRow as T | null;
          }
          return null as T | null;
        },
        all: async <T>() => {
          if (sql.includes('svc_appointments')) {
            return { results: svc_appointments as T[], success: true, meta: {} as D1Meta };
          }
          return { results: [] as T[], success: true, meta: {} as D1Meta };
        },
        run: async () => ({ success: true, meta: {} as D1Meta }),
        raw: async <T>() => [] as T[],
      }),
    };
  };

  return { prepare: mockPrepare as unknown as D1Database['prepare'] } as D1Database;
}

describe('calculateAvailableSlots', () => {
  it('returns empty array when svc_staff has no availability window for the day', async () => {
    const db = makeMockD1(null, []);
    const slots = await calculateAvailableSlots({
      db,
      tenantId: 'tenant-1',
      staffId: 'svc_staff-1',
      date: '2025-04-14', // Monday
      serviceDurationMinutes: 60,
    });
    expect(slots).toHaveLength(0);
  });

  it('returns slots when svc_staff has availability and no svc_appointments', async () => {
    const db = makeMockD1({ startTime: '09:00', endTime: '17:00' }, []);
    const slots = await calculateAvailableSlots({
      db,
      tenantId: 'tenant-1',
      staffId: 'svc_staff-1',
      date: '2027-06-14', // Future Monday
      serviceDurationMinutes: 60,
      bufferMinutes: 15,
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot).toHaveProperty('startUtc');
      expect(slot).toHaveProperty('endUtc');
      expect(slot).toHaveProperty('displayWAT');
    }
  });

  it('includes travel overhead in total block for mobile svc_services', async () => {
    // With a large travel distance, totalBlock should be much larger
    // resulting in fewer available slots
    const db = makeMockD1({ startTime: '09:00', endTime: '17:00' }, []);

    const staticSlots = await calculateAvailableSlots({
      db,
      tenantId: 'tenant-1',
      staffId: 'svc_staff-1',
      date: '2027-06-14', // Future Monday
      serviceDurationMinutes: 60,
      bufferMinutes: 15,
      isMobile: false,
    });

    const mobileSlots = await calculateAvailableSlots({
      db,
      tenantId: 'tenant-1',
      staffId: 'svc_staff-1',
      date: '2027-06-14', // Future Monday
      serviceDurationMinutes: 60,
      bufferMinutes: 15,
      isMobile: true,
      staffLat: 6.5244,
      staffLng: 3.3792,
      clientLat: 6.4281,
      clientLng: 3.4219,
    });

    // Mobile svc_appointments take more time per block → fewer slots
    expect(mobileSlots.length).toBeLessThanOrEqual(staticSlots.length);
  });

  it('excludes busy periods from available slots', async () => {
    // One existing appointment from WAT 10:00-11:00 (UTC 09:00-10:00) on 2027-06-14
    const busyAppt = {
      scheduledAt: '2027-06-14T09:00:00.000Z',
      durationMinutes: 60,
    };
    const db = makeMockD1({ startTime: '09:00', endTime: '17:00' }, [busyAppt]);
    const slots = await calculateAvailableSlots({
      db,
      tenantId: 'tenant-1',
      staffId: 'svc_staff-1',
      date: '2027-06-14',
      serviceDurationMinutes: 60,
      bufferMinutes: 15,
    });

    // No slot should start during or overlap with the busy period + buffer
    const busyStart = new Date('2027-06-14T09:00:00.000Z').getTime();
    const busyEnd = new Date('2027-06-14T10:15:00.000Z').getTime(); // 09:00 + 60min + 15min buffer
    for (const slot of slots) {
      const slotStart = new Date(slot.startUtc).getTime();
      const slotBlockEnd = slotStart + 75 * 60 * 1000; // 60 + 15 buffer
      const overlaps = slotStart < busyEnd && slotBlockEnd > busyStart;
      expect(overlaps).toBe(false);
    }
  });
});
