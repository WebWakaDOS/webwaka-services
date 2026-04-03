import { describe, it, expect } from 'vitest';
import { transition, parseDate, parseTime, buildScheduledAt, KNOWN_SERVICES, MESSAGES } from './stateMachine';
import type { WhatsAppSession } from '../../core/types';

const makeSession = (overrides: Partial<WhatsAppSession> = {}): WhatsAppSession => ({
  id: 'tenant1:2348012345678',
  tenantId: 'tenant1',
  phone: '2348012345678',
  state: 'IDLE',
  collectedService: null,
  collectedDate: null,
  collectedTime: null,
  appointmentId: null,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('parseDate', () => {
  it('parses "tomorrow"', () => {
    const result = parseDate('tomorrow');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('parses "next monday"', () => {
    expect(parseDate('next monday')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('parses "15th April"', () => {
    expect(parseDate('15th April')).toMatch(/^\d{4}-04-15$/);
  });
  it('parses "April 15"', () => {
    expect(parseDate('April 15')).toMatch(/^\d{4}-04-15$/);
  });
  it('parses DD/MM numeric', () => {
    expect(parseDate('15/04')).toMatch(/^\d{4}-04-15$/);
  });
  it('returns null for invalid input', () => {
    expect(parseDate('banana')).toBeNull();
  });
});

describe('parseTime', () => {
  it('parses "3pm"', () => { expect(parseTime('3pm')).toBe('15:00'); });
  it('parses "3:30pm"', () => { expect(parseTime('3:30pm')).toBe('15:30'); });
  it('parses "14:00"', () => { expect(parseTime('14:00')).toBe('14:00'); });
  it("parses \"3 o'clock\"", () => { expect(parseTime("3 o'clock")).toBe('03:00'); });
  it('parses "10am"', () => { expect(parseTime('10am')).toBe('10:00'); });
  it('returns null for invalid input', () => { expect(parseTime('banana')).toBeNull(); });
});

describe('buildScheduledAt', () => {
  it('converts WAT to UTC correctly', () => {
    const result = buildScheduledAt('2025-04-15', '14:00');
    // WAT 14:00 = UTC 13:00
    expect(result).toBe('2025-04-15T13:00:00.000Z');
  });
});

describe('State Machine — Happy Path', () => {
  it('IDLE + "hi" → GREETING', () => {
    const s = makeSession({ state: 'IDLE' });
    const r = transition(s, 'hi');
    expect(r.nextState).toBe('GREETING');
  });

  it('GREETING + service number → COLLECT_DATE', () => {
    const s = makeSession({ state: 'GREETING' });
    const r = transition(s, '1');
    expect(r.nextState).toBe('COLLECT_DATE');
    expect(r.collectedService).toBe('Consultation');
  });

  it('COLLECT_SERVICE + service name → COLLECT_DATE', () => {
    const s = makeSession({ state: 'COLLECT_SERVICE' });
    const r = transition(s, 'consultation');
    expect(r.nextState).toBe('COLLECT_DATE');
    expect(r.collectedService).toBe('Consultation');
  });

  it('COLLECT_DATE + "tomorrow" → COLLECT_TIME', () => {
    const s = makeSession({ state: 'COLLECT_DATE', collectedService: 'Consultation' });
    const r = transition(s, 'tomorrow');
    expect(r.nextState).toBe('COLLECT_TIME');
    expect(r.collectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('COLLECT_TIME + "2pm" → CONFIRM', () => {
    const s = makeSession({ state: 'COLLECT_TIME', collectedService: 'Consultation', collectedDate: '2025-12-01' });
    const r = transition(s, '2pm');
    expect(r.nextState).toBe('CONFIRM');
    expect(r.collectedTime).toBe('14:00');
    expect(r.reply).toContain('confirm');
  });

  it('CONFIRM + "yes" → BOOKED', () => {
    const s = makeSession({ state: 'CONFIRM', collectedService: 'Consultation', collectedDate: '2025-12-01', collectedTime: '14:00' });
    const r = transition(s, 'yes');
    expect(r.nextState).toBe('BOOKED');
  });

  it('CONFIRM + "no" → CANCELLED', () => {
    const s = makeSession({ state: 'CONFIRM' });
    const r = transition(s, 'no');
    expect(r.nextState).toBe('CANCELLED');
  });
});

describe('State Machine — Error Recovery', () => {
  it('COLLECT_SERVICE + invalid → stays COLLECT_SERVICE', () => {
    const s = makeSession({ state: 'COLLECT_SERVICE' });
    const r = transition(s, 'blahblah');
    expect(r.nextState).toBe('COLLECT_SERVICE');
    expect(r.reply).toContain('didn\'t recognise');
  });

  it('COLLECT_DATE + invalid → stays COLLECT_DATE', () => {
    const s = makeSession({ state: 'COLLECT_DATE' });
    const r = transition(s, 'bananatime');
    expect(r.nextState).toBe('COLLECT_DATE');
  });

  it('COLLECT_TIME + invalid → stays COLLECT_TIME', () => {
    const s = makeSession({ state: 'COLLECT_TIME', collectedDate: '2025-12-01' });
    const r = transition(s, 'soon');
    expect(r.nextState).toBe('COLLECT_TIME');
  });

  it('any state + "cancel" → CANCELLED', () => {
    const s = makeSession({ state: 'COLLECT_DATE' });
    const r = transition(s, 'cancel');
    expect(r.nextState).toBe('CANCELLED');
  });

  it('all 5 services recognised by number', () => {
    KNOWN_SERVICES.forEach((service, i) => {
      const s = makeSession({ state: 'COLLECT_SERVICE' });
      const r = transition(s, String(i + 1));
      expect(r.collectedService).toBe(service);
    });
  });
});

// ─── Bug Fix Tests ─────────────────────────────────────────────────────────────

describe('Bug Fix #3 — parseDate: overflow dates rejected', () => {
  it('rejects "31st February" — does not silently roll to March', () => {
    expect(parseDate('31st February')).toBeNull();
  });
  it('rejects "31st April" — April has only 30 days', () => {
    expect(parseDate('31st April')).toBeNull();
  });
  it('rejects "30th February"', () => {
    expect(parseDate('30th February')).toBeNull();
  });
  it('accepts valid end-of-month date "30th April"', () => {
    expect(parseDate('30th April')).toMatch(/^\d{4}-04-30$/);
  });
  it('rejects DD/MM overflow like "32/01"', () => {
    expect(parseDate('32/01')).toBeNull();
  });
  it('rejects DD/MM overflow like "31/04"', () => {
    expect(parseDate('31/04')).toBeNull();
  });
  it('accepts valid numeric date "28/02"', () => {
    const result = parseDate('28/02');
    expect(result).toMatch(/^\d{4}-02-28$/);
  });
});

describe('Bug Fix #1 — session stale data cleared on GREETING restart', () => {
  it('BOOKED + "hi" → GREETING does not carry collectedService into result', () => {
    const s = makeSession({
      state: 'BOOKED',
      collectedService: 'Consultation',
      collectedDate: '2025-12-01',
      collectedTime: '14:00',
      appointmentId: 'appt-123',
    });
    const r = transition(s, 'hi');
    expect(r.nextState).toBe('GREETING');
    // The transition function itself does not return stale collected fields
    expect(r.collectedService).toBeUndefined();
    expect(r.collectedDate).toBeUndefined();
    expect(r.collectedTime).toBeUndefined();
  });

  it('CANCELLED + "book" → GREETING with no stale fields', () => {
    const s = makeSession({
      state: 'CANCELLED',
      collectedService: 'Strategy Session',
      collectedDate: '2025-11-01',
      collectedTime: '10:00',
    });
    const r = transition(s, 'book');
    expect(r.nextState).toBe('GREETING');
    expect(r.collectedService).toBeUndefined();
    expect(r.collectedDate).toBeUndefined();
  });

  it('global restart from COLLECT_DATE clears nothing at transition level but state resets', () => {
    const s = makeSession({ state: 'COLLECT_DATE', collectedService: 'Consultation' });
    const r = transition(s, 'hello');
    expect(r.nextState).toBe('GREETING');
  });
});

describe('Bug Fix #2 — PAST_APPOINTMENT message exists', () => {
  it('MESSAGES.PAST_APPOINTMENT is a non-empty string', () => {
    expect(typeof MESSAGES.PAST_APPOINTMENT).toBe('string');
    expect(MESSAGES.PAST_APPOINTMENT.length).toBeGreaterThan(0);
    expect(MESSAGES.PAST_APPOINTMENT).toContain('passed');
  });
});

describe('Bug Fix #3 — buildScheduledAt precision', () => {
  it('correctly converts WAT midnight to UTC 23:00 previous day', () => {
    expect(buildScheduledAt('2025-04-15', '00:00')).toBe('2025-04-14T23:00:00.000Z');
  });
  it('correctly converts WAT noon to UTC 11:00', () => {
    expect(buildScheduledAt('2025-04-15', '12:00')).toBe('2025-04-15T11:00:00.000Z');
  });
});

describe('parseDate — additional Nigeria-first formats', () => {
  it('parses bare weekday "friday"', () => {
    const result = parseDate('friday');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('parses "today"', () => {
    expect(parseDate('today')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('parses full date with year "15/04/2027"', () => {
    expect(parseDate('15/04/2027')).toBe('2027-04-15');
  });
  it('rejects empty string', () => {
    expect(parseDate('')).toBeNull();
  });
  it('rejects date-like but fully invalid "99/99"', () => {
    expect(parseDate('99/99')).toBeNull();
  });
});

describe('parseTime — edge cases', () => {
  it('parses "12pm" as noon (12:00)', () => {
    expect(parseTime('12pm')).toBe('12:00');
  });
  it('parses "12am" as midnight (00:00)', () => {
    expect(parseTime('12am')).toBe('00:00');
  });
  it('rejects hour 24 in 24h format', () => {
    expect(parseTime('24:00')).toBeNull();
  });
  it('parses "0pm" as noon (12:00) — consistent with resolveAmPm convention', () => {
    expect(parseTime('0pm')).toBe('12:00');
  });
  it('rejects out-of-range minutes "10:75"', () => {
    expect(parseTime('10:75')).toBeNull();
  });
});
