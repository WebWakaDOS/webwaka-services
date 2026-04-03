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
