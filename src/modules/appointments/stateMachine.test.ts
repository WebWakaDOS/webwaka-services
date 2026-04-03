import { describe, it, expect } from 'vitest';
import { transition, parseDate, parseTime, buildScheduledAt, KNOWN_SERVICES } from './stateMachine';
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
