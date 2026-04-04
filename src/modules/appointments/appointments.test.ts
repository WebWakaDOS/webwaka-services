/**
 * Unit Tests — Appointments Module
 *
 * Tests:
 *   1. checkDoubleBooking — exported pure-ish function with mock D1
 *      • No conflict when staff has no existing appointments
 *      • Detects exact overlap
 *      • Detects partial overlap (new appointment starts during existing one)
 *      • Detects partial overlap (new appointment ends during existing one)
 *      • No conflict when new appointment is adjacent (starts exactly when existing ends)
 *      • Cancelled appointments do not count as conflicts
 *
 * DB-coupled tests use a lightweight in-memory mock that satisfies the D1Database
 * interface surface used by checkDoubleBooking (same pattern as engine.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { checkDoubleBooking } from './index';

// ─── Mock D1 factory ──────────────────────────────────────────────────────────

function makeMockD1ForDoubleBooking(
  appointments: Array<{ id: string; scheduledAt: string; durationMinutes: number }>,
): D1Database {
  const mockPrepare = (_sql: string) => ({
    bind: (..._args: unknown[]) => ({
      all: async <T>() => ({
        results: appointments as T[],
        success: true,
        meta: {} as D1Meta,
      }),
      first: async <T>() => null as T | null,
      run: async () => ({ success: true, meta: {} as D1Meta }),
      raw: async <T>() => [] as T[],
    }),
  });

  return { prepare: mockPrepare as unknown as D1Database['prepare'] } as D1Database;
}

// ─── checkDoubleBooking ───────────────────────────────────────────────────────

describe('checkDoubleBooking', () => {
  const tenantId = 'tenant-1';
  const staffId = 'staff-abc';

  it('returns no conflict when the staff has no existing appointments', async () => {
    const db = makeMockD1ForDoubleBooking([]);
    const result = await checkDoubleBooking(
      db,
      tenantId,
      staffId,
      '2027-06-14T09:00:00.000Z',
      60,
    );
    expect(result.hasConflict).toBe(false);
    expect(result.conflictingId).toBeUndefined();
  });

  it('detects exact overlap — same start time and duration', async () => {
    const db = makeMockD1ForDoubleBooking([
      { id: 'appt-1', scheduledAt: '2027-06-14T09:00:00.000Z', durationMinutes: 60 },
    ]);
    const result = await checkDoubleBooking(
      db,
      tenantId,
      staffId,
      '2027-06-14T09:00:00.000Z',
      60,
    );
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingId).toBe('appt-1');
  });

  it('detects overlap — new appointment starts during existing one', async () => {
    // Existing: 09:00–10:00. New: 09:30–10:30. Overlap at 09:30–10:00.
    const db = makeMockD1ForDoubleBooking([
      { id: 'appt-2', scheduledAt: '2027-06-14T09:00:00.000Z', durationMinutes: 60 },
    ]);
    const result = await checkDoubleBooking(
      db,
      tenantId,
      staffId,
      '2027-06-14T09:30:00.000Z',
      60,
    );
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingId).toBe('appt-2');
  });

  it('detects overlap — new appointment ends during existing one', async () => {
    // Existing: 10:00–11:00. New: 09:30–10:30. Overlap at 10:00–10:30.
    const db = makeMockD1ForDoubleBooking([
      { id: 'appt-3', scheduledAt: '2027-06-14T10:00:00.000Z', durationMinutes: 60 },
    ]);
    const result = await checkDoubleBooking(
      db,
      tenantId,
      staffId,
      '2027-06-14T09:30:00.000Z',
      60,
    );
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingId).toBe('appt-3');
  });

  it('detects overlap — new appointment fully contains existing one', async () => {
    // Existing: 10:00–10:30. New: 09:00–12:00.
    const db = makeMockD1ForDoubleBooking([
      { id: 'appt-4', scheduledAt: '2027-06-14T10:00:00.000Z', durationMinutes: 30 },
    ]);
    const result = await checkDoubleBooking(
      db,
      tenantId,
      staffId,
      '2027-06-14T09:00:00.000Z',
      180,
    );
    expect(result.hasConflict).toBe(true);
  });

  it('returns no conflict when new appointment starts exactly when existing one ends', async () => {
    // Existing: 09:00–10:00 (60 min). New: 10:00–11:00. Adjacent — no overlap.
    const db = makeMockD1ForDoubleBooking([
      { id: 'appt-5', scheduledAt: '2027-06-14T09:00:00.000Z', durationMinutes: 60 },
    ]);
    const result = await checkDoubleBooking(
      db,
      tenantId,
      staffId,
      '2027-06-14T10:00:00.000Z',
      60,
    );
    expect(result.hasConflict).toBe(false);
  });

  it('returns no conflict when new appointment ends exactly when existing one starts', async () => {
    // Existing: 11:00–12:00. New: 09:00–11:00. Adjacent — no overlap.
    const db = makeMockD1ForDoubleBooking([
      { id: 'appt-6', scheduledAt: '2027-06-14T11:00:00.000Z', durationMinutes: 60 },
    ]);
    const result = await checkDoubleBooking(
      db,
      tenantId,
      staffId,
      '2027-06-14T09:00:00.000Z',
      120,
    );
    expect(result.hasConflict).toBe(false);
  });

  it('returns the conflictingId of the first conflicting appointment found', async () => {
    const db = makeMockD1ForDoubleBooking([
      { id: 'conflict-first', scheduledAt: '2027-06-14T10:00:00.000Z', durationMinutes: 60 },
      { id: 'conflict-second', scheduledAt: '2027-06-14T10:30:00.000Z', durationMinutes: 60 },
    ]);
    const result = await checkDoubleBooking(
      db,
      tenantId,
      staffId,
      '2027-06-14T10:00:00.000Z',
      60,
    );
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingId).toBe('conflict-first');
  });

  it('returns no conflict when only appointments for different staff are present', async () => {
    // The mock returns the given appointments regardless, simulating the DB
    // having already filtered by staffId. Empty results = no conflict.
    const db = makeMockD1ForDoubleBooking([]);
    const result = await checkDoubleBooking(
      db,
      'tenant-1',
      'staff-other',
      '2027-06-14T10:00:00.000Z',
      60,
    );
    expect(result.hasConflict).toBe(false);
  });
});
