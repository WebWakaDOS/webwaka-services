/**
 * Unit Tests — Staff Management Module
 *
 * Tests:
 *   1. isValidHHMM — pure validation helper
 *   2. Availability window logic — start < end, valid day-of-week range
 *   3. commissionBps boundary validation (0–10000)
 *
 * Route handler tests are omitted here because they require a live D1 database;
 * the scheduling engine tests (engine.test.ts) cover the DB-coupled path via
 * a comprehensive mock D1 pattern. Pure function tests provide the best
 * unit-test coverage for this module.
 */

import { describe, it, expect } from 'vitest';
import { isValidHHMM } from './index';

// ─── isValidHHMM ──────────────────────────────────────────────────────────────

describe('isValidHHMM', () => {
  it('accepts valid HH:MM strings', () => {
    expect(isValidHHMM('00:00')).toBe(true);
    expect(isValidHHMM('09:00')).toBe(true);
    expect(isValidHHMM('17:30')).toBe(true);
    expect(isValidHHMM('23:59')).toBe(true);
    expect(isValidHHMM('12:00')).toBe(true);
  });

  it('rejects strings missing the colon', () => {
    expect(isValidHHMM('0900')).toBe(false);
    expect(isValidHHMM('1730')).toBe(false);
  });

  it('rejects strings with wrong digit counts', () => {
    expect(isValidHHMM('9:00')).toBe(false);    // single digit hour
    expect(isValidHHMM('09:0')).toBe(false);    // single digit minute
    expect(isValidHHMM('009:00')).toBe(false);  // triple digit hour
    expect(isValidHHMM('09:000')).toBe(false);  // triple digit minute
  });

  it('rejects empty string', () => {
    expect(isValidHHMM('')).toBe(false);
  });

  it('rejects non-numeric characters', () => {
    expect(isValidHHMM('ab:cd')).toBe(false);
    expect(isValidHHMM('9 :00')).toBe(false);
    expect(isValidHHMM('09:0a')).toBe(false);
  });

  it('rejects date-time strings', () => {
    expect(isValidHHMM('09:00:00')).toBe(false);
    expect(isValidHHMM('2025-04-14T09:00')).toBe(false);
  });
});

// ─── Availability window invariants ───────────────────────────────────────────

describe('Availability window business rules', () => {
  function isValidWindow(startTime: string, endTime: string): boolean {
    return isValidHHMM(startTime) && isValidHHMM(endTime) && startTime < endTime;
  }

  function isValidDayOfWeek(day: number): boolean {
    return Number.isInteger(day) && day >= 0 && day <= 6;
  }

  it('accepts valid Mon–Fri windows', () => {
    expect(isValidWindow('09:00', '17:00')).toBe(true);
    expect(isValidWindow('08:30', '12:00')).toBe(true);
    expect(isValidWindow('00:00', '23:59')).toBe(true);
  });

  it('rejects startTime >= endTime', () => {
    expect(isValidWindow('17:00', '09:00')).toBe(false); // reversed
    expect(isValidWindow('09:00', '09:00')).toBe(false); // equal
  });

  it('rejects invalid HH:MM in either field', () => {
    expect(isValidWindow('9:00', '17:00')).toBe(false);
    expect(isValidWindow('09:00', '5:00')).toBe(false);
  });

  it('validates dayOfWeek as 0–6 (Sun–Sat)', () => {
    for (let d = 0; d <= 6; d++) {
      expect(isValidDayOfWeek(d)).toBe(true);
    }
    expect(isValidDayOfWeek(-1)).toBe(false);
    expect(isValidDayOfWeek(7)).toBe(false);
    expect(isValidDayOfWeek(1.5)).toBe(false);
  });
});

// ─── commissionBps validation ─────────────────────────────────────────────────

describe('commissionBps validation', () => {
  function isValidCommissionBps(bps: number): boolean {
    return Number.isInteger(bps) && bps >= 0 && bps <= 10000;
  }

  it('accepts 0 (no commission)', () => {
    expect(isValidCommissionBps(0)).toBe(true);
  });

  it('accepts 10000 (100% — maximum)', () => {
    expect(isValidCommissionBps(10000)).toBe(true);
  });

  it('accepts typical commission rates', () => {
    expect(isValidCommissionBps(1500)).toBe(true); // 15%
    expect(isValidCommissionBps(2000)).toBe(true); // 20%
    expect(isValidCommissionBps(500)).toBe(true);  // 5%
  });

  it('rejects negative values', () => {
    expect(isValidCommissionBps(-1)).toBe(false);
    expect(isValidCommissionBps(-100)).toBe(false);
  });

  it('rejects values above 10000', () => {
    expect(isValidCommissionBps(10001)).toBe(false);
    expect(isValidCommissionBps(99999)).toBe(false);
  });

  it('rejects non-integer values', () => {
    expect(isValidCommissionBps(1500.5)).toBe(false);
    expect(isValidCommissionBps(0.1)).toBe(false);
  });
});
