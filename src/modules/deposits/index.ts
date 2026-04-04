/**
 * Deposit & Cancellation Fees Module — WebWaka Services Suite
 *
 * Manages deposit charges linked to appointments and enforces configurable
 * cancellation fee policies. Integrates with Paystack for Nigerian payment
 * processing — all amounts in kobo, Invariant 5: Nigeria First.
 *
 * Routes:
 *   POST   /api/deposits                          — create a deposit record & initiate payment
 *   GET    /api/deposits                          — list deposits for the tenant
 *   GET    /api/deposits/:id                      — get single deposit
 *   POST   /api/deposits/:id/verify               — verify Paystack payment and mark as paid
 *   GET    /api/appointments/:appointmentId/deposit — get deposit for an appointment
 *   POST   /api/appointments/:appointmentId/cancel  — cancel appointment with fee enforcement
 *
 * Cancellation policy:
 *   - If a deposit exists and the appointment is cancelled, the cancellationFeeKobo
 *     is retained (marked 'forfeited'). The remainder is refunded.
 *   - If no deposit exists, the appointment is cancelled with no financial action.
 *   - The cancellationFeeKobo is set at deposit creation time and stored immutably.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';
import { initializePayment, verifyPayment, generatePaymentReference } from '../../core/paystack';

export const depositsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Create Deposit & Initiate Paystack Payment ───────────────────────────────

depositsRouter.post('/', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const body = await c.req.json<{
    appointmentId: string;
    amountKobo: number;
    cancellationFeeKobo?: number;
    customerEmail: string;
  }>();

  if (!body.appointmentId || !body.amountKobo || !body.customerEmail) {
    return c.json({
      error: 'appointmentId, amountKobo, and customerEmail are required',
    }, 400);
  }

  if (!Number.isInteger(body.amountKobo) || body.amountKobo <= 0) {
    return c.json({ error: 'amountKobo must be a positive integer (kobo)' }, 400);
  }

  const cancellationFeeKobo = body.cancellationFeeKobo ?? 0;
  if (!Number.isInteger(cancellationFeeKobo) || cancellationFeeKobo < 0) {
    return c.json({ error: 'cancellationFeeKobo must be a non-negative integer (kobo)' }, 400);
  }
  if (cancellationFeeKobo > body.amountKobo) {
    return c.json({ error: 'cancellationFeeKobo cannot exceed amountKobo' }, 400);
  }

  // Ensure appointment belongs to this tenant
  const appt = await c.env.DB.prepare(
    'SELECT id, status FROM appointments WHERE id = ? AND tenantId = ?',
  )
    .bind(body.appointmentId, tenantId)
    .first<{ id: string; status: string }>();
  if (!appt) return c.json({ error: 'Appointment not found' }, 404);
  if (appt.status === 'cancelled') {
    return c.json({ error: 'Cannot create deposit for a cancelled appointment' }, 400);
  }

  // Ensure no existing pending/paid deposit for this appointment
  const existingDeposit = await c.env.DB.prepare(
    "SELECT id FROM deposits WHERE appointmentId = ? AND status IN ('pending', 'paid')",
  )
    .bind(body.appointmentId)
    .first<{ id: string }>();
  if (existingDeposit) {
    return c.json({ error: 'An active deposit already exists for this appointment' }, 400);
  }

  // Initiate Paystack payment
  let paystackRef: string | null = null;
  let authorizationUrl: string | null = null;

  try {
    const reference = generatePaymentReference(tenantId);
    const payment = await initializePayment(c.env.PAYSTACK_SECRET_KEY, {
      emailAddress: body.customerEmail,
      amountKobo: body.amountKobo,
      reference,
      callbackUrl: `https://webwaka.com/pay/callback`,
      metadata: {
        appointmentId: body.appointmentId,
        tenantId,
        depositType: 'appointment_deposit',
      },
    });
    paystackRef = payment.data.reference;
    authorizationUrl = payment.data.authorization_url;
  } catch (err) {
    console.error('[deposits] Paystack init failed:', err);
    // Continue — record the deposit as pending even if Paystack call fails
    // so staff can manually mark it paid if needed
  }

  const depositId = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO deposits
       (id, tenantId, appointmentId, amountKobo, status, paystackReference, cancellationFeeKobo, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  )
    .bind(
      depositId,
      tenantId,
      body.appointmentId,
      body.amountKobo,
      paystackRef,
      cancellationFeeKobo,
      now,
      now,
    )
    .run();

  // Link deposit to appointment
  await c.env.DB.prepare(
    'UPDATE appointments SET depositId = ?, updatedAt = ? WHERE id = ? AND tenantId = ?',
  )
    .bind(depositId, now, body.appointmentId, tenantId)
    .run();

  return c.json({
    success: true,
    id: depositId,
    paystackReference: paystackRef,
    authorizationUrl,
  }, 201);
});

// ─── List Deposits ────────────────────────────────────────────────────────────

depositsRouter.get('/', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const status = c.req.query('status');

  let query = 'SELECT * FROM deposits WHERE tenantId = ?';
  const bindings: unknown[] = [tenantId];
  if (status) { query += ' AND status = ?'; bindings.push(status); }
  query += ' ORDER BY createdAt DESC';

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json({ data: results });
});

// ─── Get Single Deposit ───────────────────────────────────────────────────────

depositsRouter.get('/:id', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT * FROM deposits WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!row) return c.json({ error: 'Deposit not found' }, 404);
  return c.json({ data: row });
});

// ─── Verify Paystack Payment ──────────────────────────────────────────────────

depositsRouter.post('/:id/verify', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const deposit = await c.env.DB.prepare(
    'SELECT * FROM deposits WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first<{
      id: string;
      amountKobo: number;
      paystackReference: string | null;
      status: string;
      appointmentId: string;
    }>();

  if (!deposit) return c.json({ error: 'Deposit not found' }, 404);
  if (deposit.status === 'paid') return c.json({ success: true, alreadyPaid: true });
  if (!deposit.paystackReference) {
    return c.json({ error: 'No Paystack reference — cannot verify' }, 400);
  }

  let verified = false;
  let verifiedAmountKobo = 0;

  try {
    const result = await verifyPayment(c.env.PAYSTACK_SECRET_KEY, deposit.paystackReference);
    verified = result.data.status === 'success' && result.data.amount >= deposit.amountKobo;
    verifiedAmountKobo = result.data.amount;
  } catch (err) {
    console.error('[deposits] Paystack verify failed:', err);
    return c.json({ error: 'Paystack verification failed' }, 502);
  }

  if (verified) {
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      "UPDATE deposits SET status = 'paid', updatedAt = ? WHERE id = ?",
    )
      .bind(now, id)
      .run();

    // Auto-confirm the appointment when deposit is paid
    await c.env.DB.prepare(
      "UPDATE appointments SET status = 'confirmed', updatedAt = ? WHERE id = ? AND tenantId = ?",
    )
      .bind(now, deposit.appointmentId, tenantId)
      .run();
  }

  return c.json({ success: verified, verified, verifiedAmountKobo });
});

// ─── Get Deposit for Appointment ──────────────────────────────────────────────

depositsRouter.get('/appointment/:appointmentId', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const appointmentId = c.req.param('appointmentId');

  const row = await c.env.DB.prepare(
    'SELECT * FROM deposits WHERE appointmentId = ? AND tenantId = ? ORDER BY createdAt DESC LIMIT 1',
  )
    .bind(appointmentId, tenantId)
    .first();

  if (!row) return c.json({ error: 'No deposit found for this appointment' }, 404);
  return c.json({ data: row });
});

// ─── Cancel Appointment with Fee Enforcement ───────────────────────────────────

depositsRouter.post('/appointment/:appointmentId/cancel', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const appointmentId = c.req.param('appointmentId');

  const appt = await c.env.DB.prepare(
    'SELECT id, status FROM appointments WHERE id = ? AND tenantId = ?',
  )
    .bind(appointmentId, tenantId)
    .first<{ id: string; status: string }>();

  if (!appt) return c.json({ error: 'Appointment not found' }, 404);
  if (appt.status === 'cancelled') {
    return c.json({ error: 'Appointment is already cancelled' }, 400);
  }

  const now = new Date().toISOString();

  // Cancel the appointment
  await c.env.DB.prepare(
    "UPDATE appointments SET status = 'cancelled', updatedAt = ? WHERE id = ? AND tenantId = ?",
  )
    .bind(now, appointmentId, tenantId)
    .run();

  // Check for an active deposit
  const deposit = await c.env.DB.prepare(
    "SELECT * FROM deposits WHERE appointmentId = ? AND status IN ('pending', 'paid')",
  )
    .bind(appointmentId)
    .first<{
      id: string;
      amountKobo: number;
      status: string;
      cancellationFeeKobo: number;
    }>();

  if (!deposit) {
    return c.json({ success: true, depositAction: 'none', reason: 'No active deposit found' });
  }

  const refundKobo = deposit.amountKobo - deposit.cancellationFeeKobo;

  // Mark deposit as forfeited (cancellation fee retained)
  const newDepositStatus = deposit.cancellationFeeKobo > 0 ? 'forfeited' : 'refunded';
  await c.env.DB.prepare(
    'UPDATE deposits SET status = ?, updatedAt = ? WHERE id = ?',
  )
    .bind(newDepositStatus, now, deposit.id)
    .run();

  return c.json({
    success: true,
    depositAction: newDepositStatus,
    cancellationFeeKobo: deposit.cancellationFeeKobo,
    refundKobo: Math.max(0, refundKobo),
    note:
      deposit.cancellationFeeKobo > 0
        ? `Cancellation fee of ₦${(deposit.cancellationFeeKobo / 100).toFixed(2)} retained. Refund ₦${(Math.max(0, refundKobo) / 100).toFixed(2)} to be processed manually via Paystack dashboard.`
        : 'Full refund to be processed manually via Paystack dashboard.',
  });
});
