/**
 * WhatsApp Appointment Booking — Conversational State Machine
 *
 * States: IDLE → GREETING → COLLECT_SERVICE → COLLECT_DATE →
 *         COLLECT_TIME → CONFIRM → BOOKED | CANCELLED
 *
 * Nigeria-First: date parsing recognises Nigerian/West African informal formats
 * ("tomorrow", "next Monday", "15th April", "15/04", "April 15") and time
 * formats ("3pm", "15:00", "3 o'clock").  All ambiguous dates are resolved
 * in WAT (UTC+1) and stored as UTC ISO strings.
 *
 * Africa-Ready: state machine is locale-neutral; messages are English but
 * can be replaced with i18n keys in a future iteration.
 */

import type { WhatsAppSession, WhatsAppSessionState } from '../../core/types';

// ─── Known Services ───────────────────────────────────────────────────────────

export const KNOWN_SERVICES: readonly string[] = [
  'Consultation',
  'Project Review',
  'Financial Review',
  'Strategy Session',
  'Support Call',
];

const SERVICE_ALIASES: Record<string, string> = {
  consult: 'Consultation',
  consultation: 'Consultation',
  'project review': 'Project Review',
  project: 'Project Review',
  review: 'Project Review',
  financial: 'Financial Review',
  finance: 'Financial Review',
  strategy: 'Strategy Session',
  'strategy session': 'Strategy Session',
  support: 'Support Call',
  'support call': 'Support Call',
  call: 'Support Call',
  '1': 'Consultation',
  '2': 'Project Review',
  '3': 'Financial Review',
  '4': 'Strategy Session',
  '5': 'Support Call',
};

// ─── Date & Time Parsers ──────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** Returns current date in WAT (UTC+1) */
function nowWAT(): Date {
  const utc = new Date();
  utc.setMinutes(utc.getMinutes() + 60); // WAT = UTC+1
  return utc;
}

/**
 * Parses a natural language date string into an ISO date string (YYYY-MM-DD).
 * Returns null if the date cannot be parsed or is in the past.
 */
export function parseDate(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/[,]/g, '');
  const today = nowWAT();
  today.setHours(0, 0, 0, 0);

  // "today"
  if (raw === 'today') {
    return formatISODate(today);
  }

  // "tomorrow"
  if (raw === 'tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return formatISODate(d);
  }

  // "next <weekday>" e.g. "next monday"
  const nextDayMatch = raw.match(/^next\s+(\w+)$/);
  if (nextDayMatch) {
    const dayNum = DAY_NAMES[nextDayMatch[1] ?? ''];
    if (dayNum !== undefined) {
      const d = new Date(today);
      const diff = ((dayNum - d.getDay() + 7) % 7) || 7;
      d.setDate(d.getDate() + diff);
      return formatISODate(d);
    }
  }

  // "<weekday>" alone e.g. "monday" → nearest future weekday
  if (DAY_NAMES[raw] !== undefined) {
    const dayNum = DAY_NAMES[raw] as number;
    const d = new Date(today);
    const diff = ((dayNum - d.getDay() + 7) % 7) || 7;
    d.setDate(d.getDate() + diff);
    return formatISODate(d);
  }

  // "15th april", "april 15", "15 april"
  const wordDateMatch = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)$/) ??
                        raw.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (wordDateMatch) {
    let dayStr: string | undefined;
    let monthStr: string | undefined;
    const p1 = wordDateMatch[1] ?? '';
    const p2 = wordDateMatch[2] ?? '';
    if (/^\d+$/.test(p1)) {
      dayStr = p1;
      monthStr = p2;
    } else {
      monthStr = p1;
      dayStr = p2;
    }
    const monthIdx = MONTH_NAMES[monthStr.toLowerCase()];
    const dayNum = parseInt(dayStr, 10);
    if (monthIdx !== undefined && !isNaN(dayNum)) {
      const year = today.getFullYear();
      const d = new Date(year, monthIdx, dayNum);
      if (d < today) d.setFullYear(year + 1);
      if (d >= today) return formatISODate(d);
    }
  }

  // "15/04" or "15/04/2025" or "15-04-2025"
  const numericDateMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?$/);
  if (numericDateMatch) {
    const day = parseInt(numericDateMatch[1] ?? '0', 10);
    const month = parseInt(numericDateMatch[2] ?? '0', 10) - 1;
    const year = numericDateMatch[3] ? parseInt(numericDateMatch[3], 10) : today.getFullYear();
    const d = new Date(year, month, day);
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    if (d >= today) return formatISODate(d);
  }

  return null;
}

/**
 * Parses a time string into 24h "HH:MM".
 * Accepts: "3pm", "3:30pm", "15:00", "15", "3 pm", "3 o'clock"
 * Returns null if unparseable.
 */
export function parseTime(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/['\s]/g, '');

  // "3oclock", "3o'clock" etc
  const oclockMatch = raw.match(/^(\d{1,2})o?clock(am|pm)?$/);
  if (oclockMatch) {
    return resolveAmPm(parseInt(oclockMatch[1] ?? '0', 10), 0, oclockMatch[2] as 'am' | 'pm' | undefined);
  }

  // "3pm", "3:30pm", "3:30am"
  const amPmMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (amPmMatch) {
    const h = parseInt(amPmMatch[1] ?? '0', 10);
    const m = parseInt(amPmMatch[2] ?? '0', 10);
    return resolveAmPm(h, m, amPmMatch[3] as 'am' | 'pm');
  }

  // "15:00" or "15" (24h)
  const h24Match = raw.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (h24Match) {
    const h = parseInt(h24Match[1] ?? '0', 10);
    const m = parseInt(h24Match[2] ?? '0', 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  return null;
}

function resolveAmPm(h: number, m: number, period: 'am' | 'pm' | undefined): string | null {
  let hour = h;
  if (period === 'pm' && h !== 12) hour = h + 12;
  if (period === 'am' && h === 12) hour = 0;
  if (hour < 0 || hour > 23 || m < 0 || m > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Combines an ISO date and HH:MM time into a UTC ISO datetime string (assuming WAT = UTC+1). */
export function buildScheduledAt(isoDate: string, hhmm: string): string {
  const [h, mi] = hhmm.split(':').map(Number);
  const [y, mo, d] = isoDate.split('-').map(Number);
  const watMs = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0) - 60 * 60 * 1000;
  return new Date(watMs).toISOString();
}

/** Formats a scheduled ISO UTC datetime for display in WAT. */
export function formatScheduledForDisplay(isoUtc: string): string {
  const d = new Date(isoUtc);
  d.setMinutes(d.getMinutes() + 60); // WAT = UTC+1
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = days[d.getDay()] ?? '';
  const monthName = months[d.getMonth()] ?? '';
  const hour = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${dayName} ${d.getDate()} ${monthName} at ${h12}:${min} ${period} (WAT)`;
}

// ─── Service Parser ───────────────────────────────────────────────────────────

export function parseService(input: string): string | null {
  const raw = input.trim().toLowerCase();
  return SERVICE_ALIASES[raw] ?? null;
}

// ─── Bot Messages ─────────────────────────────────────────────────────────────

export const MESSAGES = {
  GREETING: (name?: string) =>
    `👋 Hello${name ? ` ${name}` : ''}! Welcome to WebWaka.\n\nI can help you book an appointment. Which service do you need?\n\n` +
    KNOWN_SERVICES.map((s, i) => `${i + 1}. ${s}`).join('\n') +
    `\n\nReply with a number or the service name.`,

  ASK_DATE: (service: string) =>
    `Great! You chose *${service}*.\n\nWhat date works for you?\nExamples: "tomorrow", "next Monday", "15th April"`,

  ASK_TIME: (date: string) =>
    `Got it — *${date}*.\n\nWhat time? (e.g. "10am", "2:30pm", "14:00")`,

  CONFIRM: (service: string, display: string) =>
    `Please confirm your appointment:\n\n📋 *Service:* ${service}\n📅 *When:* ${display}\n\nReply *YES* to confirm or *NO* to cancel.`,

  BOOKED: (display: string, id: string) =>
    `✅ Your appointment has been booked!\n\n📅 ${display}\n\nBooking ref: *${id.slice(0, 8).toUpperCase()}*\n\nWe'll send a reminder before your appointment. Thank you!`,

  CANCELLED:
    `❌ Booking cancelled. Send "book" or "hi" any time to start again.`,

  INVALID_SERVICE:
    `I didn't recognise that service. Please reply with a number (1-5) or the service name:\n\n` +
    KNOWN_SERVICES.map((s, i) => `${i + 1}. ${s}`).join('\n'),

  INVALID_DATE:
    `I couldn't parse that date. Please try formats like:\n- "tomorrow"\n- "next Monday"\n- "15th April"\n- "15/04"`,

  INVALID_TIME:
    `I couldn't parse that time. Please try formats like:\n- "10am"\n- "2:30pm"\n- "14:00"`,

  ERROR:
    `Something went wrong on our end. Please try again or contact us directly.`,

  ALREADY_BOOKED: (display: string) =>
    `You already have an appointment booked for *${display}*. Send "cancel" to cancel it or "book" to start a new one.`,
};

// ─── Transition Function ──────────────────────────────────────────────────────

export interface TransitionResult {
  nextState: WhatsAppSessionState;
  reply: string;
  collectedService?: string;
  collectedDate?: string;
  collectedTime?: string;
}

/**
 * Pure function: given the current session state and the user's message,
 * returns the next state and reply message.  No side effects.
 */
export function transition(session: WhatsAppSession, userMessage: string): TransitionResult {
  const text = userMessage.trim();
  const lower = text.toLowerCase();

  // Global cancel intent — works from any state
  if (['no', 'cancel', 'stop', 'quit', 'exit'].includes(lower)) {
    return { nextState: 'CANCELLED', reply: MESSAGES.CANCELLED };
  }

  // Global restart intent
  if (['book', 'hi', 'hello', 'start', 'hey'].includes(lower) || session.state === 'IDLE') {
    return { nextState: 'GREETING', reply: MESSAGES.GREETING() };
  }

  switch (session.state) {
    case 'GREETING':
    case 'COLLECT_SERVICE': {
      const service = parseService(lower);
      if (!service) {
        return { nextState: 'COLLECT_SERVICE', reply: MESSAGES.INVALID_SERVICE };
      }
      return {
        nextState: 'COLLECT_DATE',
        reply: MESSAGES.ASK_DATE(service),
        collectedService: service,
      };
    }

    case 'COLLECT_DATE': {
      const date = parseDate(text);
      if (!date) {
        return { nextState: 'COLLECT_DATE', reply: MESSAGES.INVALID_DATE };
      }
      return {
        nextState: 'COLLECT_TIME',
        reply: MESSAGES.ASK_TIME(date),
        collectedDate: date,
      };
    }

    case 'COLLECT_TIME': {
      const time = parseTime(text);
      if (!time) {
        return { nextState: 'COLLECT_TIME', reply: MESSAGES.INVALID_TIME };
      }
      const service = session.collectedService ?? '';
      const date = session.collectedDate ?? '';
      const scheduledAt = buildScheduledAt(date, time);
      const display = formatScheduledForDisplay(scheduledAt);
      return {
        nextState: 'CONFIRM',
        reply: MESSAGES.CONFIRM(service, display),
        collectedTime: time,
      };
    }

    case 'CONFIRM': {
      if (['yes', 'y', 'confirm', 'ok', 'okay', 'sure', 'yep', 'yeah'].includes(lower)) {
        return { nextState: 'BOOKED', reply: '' };
      }
      return { nextState: 'CANCELLED', reply: MESSAGES.CANCELLED };
    }

    case 'BOOKED':
    case 'CANCELLED':
      return { nextState: 'GREETING', reply: MESSAGES.GREETING() };

    default:
      return { nextState: 'GREETING', reply: MESSAGES.GREETING() };
  }
}
