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
