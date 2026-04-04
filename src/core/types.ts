/**
 * Shared types for WebWaka Services Suite
 * All monetary values are in kobo (NGN × 100) — Invariant 5: Nigeria First
 */

import type { AuthUser } from '@webwaka/core';

export interface Bindings {
  DB: D1Database;
  SESSIONS_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  MEDIA_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  PAYSTACK_SECRET_KEY: string;
  OPENROUTER_API_KEY: string;
  TERMII_API_KEY: string;
  /** Shared secret used to verify inbound WhatsApp webhook challenges */
  WHATSAPP_VERIFY_TOKEN: string;
  /** Optional Termii sender ID for WhatsApp Business channel */
  TERMII_WHATSAPP_SENDER_ID?: string;
  /** URL of the centralised webwaka-ai-platform worker */
  AI_PLATFORM_URL: string;
  /** Inter-service secret for authenticating calls to webwaka-ai-platform */
  INTER_SERVICE_SECRET: string;
}

/**
 * Hono Variables — typed context values injected by jwtAuthMiddleware.
 * Use with Hono<{ Bindings: Bindings; Variables: AppVariables }>.
 */
export interface AppVariables {
  /** Authenticated user — set by jwtAuthMiddleware from @webwaka/core */
  user: AuthUser;
  /** Tenant ID — ALWAYS sourced from JWT payload, NEVER from headers */
  tenantId: string;
}

export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
export type DepositStatus = 'pending' | 'paid' | 'refunded' | 'forfeited';
export type ReminderStatus = 'scheduled' | 'sent' | 'failed' | 'cancelled';
export type ReminderChannel = 'sms' | 'whatsapp' | 'email';

/**
 * WhatsApp conversational state machine states.
 * Progression: IDLE → GREETING → COLLECT_SERVICE → COLLECT_DATE →
 *              COLLECT_TIME → CONFIRM → BOOKED | CANCELLED
 */
export type WhatsAppSessionState =
  | 'IDLE'
  | 'GREETING'
  | 'COLLECT_SERVICE'
  | 'COLLECT_DATE'
  | 'COLLECT_TIME'
  | 'CONFIRM'
  | 'BOOKED'
  | 'CANCELLED';

export interface Appointment {
  id: string;
  tenantId: string;
  clientPhone: string;
  clientName: string | null;
  service: string;
  scheduledAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  notes: string | null;
  staffId: string | null;
  isMobile: number; // 0 or 1 — SQLite boolean
  locationLat: number | null;
  locationLng: number | null;
  depositId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppSession {
  id: string;
  tenantId: string;
  phone: string;
  state: WhatsAppSessionState;
  collectedService: string | null;
  collectedDate: string | null;
  collectedTime: string | null;
  appointmentId: string | null;
  updatedAt: string;
}

export interface Client {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  tenantId: string;
  clientId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  budgetKobo: number; // ALWAYS kobo — Invariant 5
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  projectId: string;
  clientId: string;
  invoiceNumber: string;
  amountKobo: number; // ALWAYS kobo
  taxKobo: number; // ALWAYS kobo
  totalKobo: number; // ALWAYS kobo
  status: InvoiceStatus;
  dueDate: string;
  createdAt: string;
}

/**
 * Staff member — a technician, consultant, or field agent belonging to a tenant.
 * Skills are stored as a JSON-encoded string array in D1.
 */
export interface Staff {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  skills: string; // JSON-encoded string[]
  status: 'active' | 'inactive';
  /** Commission percentage multiplied by 100 to avoid floats (e.g. 1500 = 15.00%) */
  commissionBps: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Weekly recurring availability window for a staff member.
 * dayOfWeek: 0 (Sunday) – 6 (Saturday), matching JS Date.getDay().
 * startTime / endTime: "HH:MM" in WAT (UTC+1).
 */
export interface StaffAvailability {
  id: string;
  tenantId: string;
  staffId: string;
  dayOfWeek: number;
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
}

/**
 * A line item within a quote. priceKobo is always in kobo — Invariant 5.
 */
export interface QuoteLineItem {
  id: string;
  quoteId: string;
  description: string;
  quantity: number;
  unitPriceKobo: number; // ALWAYS kobo
  totalKobo: number;     // quantity × unitPriceKobo
}

/**
 * An automated or manually created service quote.
 * All monetary fields are in kobo — Invariant 5: Nigeria First.
 */
export interface Quote {
  id: string;
  tenantId: string;
  clientId: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  service: string;
  subtotalKobo: number; // ALWAYS kobo
  taxKobo: number;      // ALWAYS kobo
  totalKobo: number;    // ALWAYS kobo
  /** Deposit amount required to confirm (in kobo) */
  depositKobo: number;
  status: QuoteStatus;
  validUntil: string;  // ISO date
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A deposit charge linked to a booking.
 * amountKobo is always in kobo — Invariant 5.
 * paystackReference is the Paystack transaction reference for charge verification.
 */
export interface Deposit {
  id: string;
  tenantId: string;
  appointmentId: string;
  amountKobo: number; // ALWAYS kobo
  status: DepositStatus;
  paystackReference: string | null;
  cancellationFeeKobo: number; // ALWAYS kobo — fee to retain on cancellation
  createdAt: string;
  updatedAt: string;
}

/**
 * A scheduled or sent appointment reminder.
 */
export interface ReminderLog {
  id: string;
  tenantId: string;
  appointmentId: string;
  channel: ReminderChannel;
  recipient: string; // phone or email
  scheduledFor: string; // ISO datetime (UTC)
  status: ReminderStatus;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
