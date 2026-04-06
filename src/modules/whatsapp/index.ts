/**
 * WhatsApp Webhook Module
 *
 * Receives inbound WhatsApp messages via Termii, drives the conversational
 * state machine, persists session state in D1, and sends replies through
 * @webwaka/core/notifications (NotificationService → Termii SMS/WhatsApp).
 *
 * Routes (UNAUTHENTICATED — inbound from Termii / WhatsApp Business API):
 *   GET  /webhook/whatsapp/:tenantId — verify challenge (Meta-compatible hub.challenge)
 *   POST /webhook/whatsapp/:tenantId — receive inbound message & drive state machine
 *
 * Tenant routing: The webhook URL embeds the tenantId as a path param
 * (/webhook/whatsapp/:tenantId) so a single worker can serve all tenants.
 *
 * Security model:
 *   - GET: WHATSAPP_VERIFY_TOKEN matched before echoing hub.challenge
 *   - POST: No shared HMAC secret is provided by Termii for inbound webhooks.
 *     Defense-in-depth relies on: (a) obscure per-tenant URLs, (b) E.164 phone
 *     validation in parseTermiiInbound, and (c) rate limiting at the worker level
 *     (applied in worker.ts via RATE_LIMIT_KV).
 *   - tenantId comes from the URL path and is trusted only for session scoping;
 *     it does not bypass any auth on the authenticated /api/* routes.
 */

import { Hono } from 'hono';
import type { Bindings, AppVariables, WhatsAppSession, WhatsAppSessionState } from '../../core/types';
import { sendWhatsAppMessage, verifyWebhookChallenge, parseTermiiInbound } from '../../core/whatsapp';
import {
  transition,
  buildScheduledAt,
  formatScheduledForDisplay,
  MESSAGES,
} from '../appointments/stateMachine';

export const whatsappRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── GET /webhook/whatsapp/:tenantId — Verify Challenge ──────────────────────

whatsappRouter.get('/:tenantId', async (c) => {
  const mode = c.req.query('hub.mode') ?? null;
  const verifyToken = c.req.query('hub.verify_token') ?? null;
  const challenge = c.req.query('hub.challenge') ?? null;

  const expectedToken = c.env.WHATSAPP_VERIFY_TOKEN;
  const echo = verifyWebhookChallenge({ mode, verifyToken, challenge, expectedToken });

  if (echo) return c.text(echo, 200);
  return c.json({ error: 'Forbidden' }, 403);
});

// ─── POST /webhook/whatsapp/:tenantId — Receive Message ──────────────────────

whatsappRouter.post('/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId');

  // Parse Termii inbound payload
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const inbound = parseTermiiInbound(rawBody);
  if (!inbound) {
    return c.json({ error: 'Unrecognised payload shape' }, 400);
  }

  const { sender: phone, message: userMessage } = inbound;

  // ── Load or create session ─────────────────────────────────────────────────
  const sessionId = `${tenantId}:${phone}`;
  const existingRow = await c.env.DB.prepare(
    'SELECT * FROM svc_whatsapp_sessions WHERE id = ?'
  ).bind(sessionId).first<WhatsAppSession>();

  const session: WhatsAppSession = existingRow ?? {
    id: sessionId,
    tenantId,
    phone,
    state: 'IDLE' as WhatsAppSessionState,
    collectedService: null,
    collectedDate: null,
    collectedTime: null,
    appointmentId: null,
    updatedAt: new Date().toISOString(),
  };

  // ── Run state machine ──────────────────────────────────────────────────────
  const result = transition(session, userMessage);

  // Bug fix: when transitioning to GREETING (global restart, BOOKED→restart,
  // CANCELLED→restart), explicitly clear all accumulated booking data so stale
  // values from prior conversations do not persist in D1.
  const isRestartingToGreeting = result.nextState === 'GREETING';
  const updatedSession: WhatsAppSession = {
    ...session,
    state: result.nextState,
    collectedService: isRestartingToGreeting
      ? null
      : (result.collectedService ?? session.collectedService),
    collectedDate: isRestartingToGreeting
      ? null
      : (result.collectedDate ?? session.collectedDate),
    collectedTime: isRestartingToGreeting
      ? null
      : (result.collectedTime ?? session.collectedTime),
    appointmentId: isRestartingToGreeting ? null : session.appointmentId,
    updatedAt: new Date().toISOString(),
  };

  let replyBody = result.reply;

  // ── Handle BOOKED state — create appointment in DB ────────────────────────
  if (result.nextState === 'BOOKED') {
    const service = updatedSession.collectedService;
    const date = updatedSession.collectedDate;
    const time = updatedSession.collectedTime;

    if (!service || !date || !time) {
      replyBody = MESSAGES.ERROR;
      updatedSession.state = 'IDLE';
    } else {
      const scheduledAt = buildScheduledAt(date, time);

      // Bug fix: reject svc_appointments in the past — buildScheduledAt converts
      // WAT to UTC; compare against current UTC to guard against "today" at a
      // past time, or any clock-skew scenario.
      if (scheduledAt <= new Date().toISOString()) {
        replyBody = MESSAGES.PAST_APPOINTMENT;
        updatedSession.state = 'COLLECT_DATE';
        // Keep collectedService; clear date/time so user re-enters them
        updatedSession.collectedDate = null;
        updatedSession.collectedTime = null;
      } else {
        const display = formatScheduledForDisplay(scheduledAt);
        const appointmentId = crypto.randomUUID();
        const now = new Date().toISOString();

        try {
          await c.env.DB.prepare(
            `INSERT INTO svc_appointments
               (id, tenantId, clientPhone, clientName, service, scheduledAt, durationMinutes, status, notes, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, 30, 'confirmed', ?, ?, ?)`
          ).bind(
            appointmentId,
            tenantId,
            phone,
            null,
            service,
            scheduledAt,
            null,
            now,
            now,
          ).run();

          updatedSession.appointmentId = appointmentId;
          replyBody = MESSAGES.BOOKED(display, appointmentId);
        } catch {
          replyBody = MESSAGES.ERROR;
          updatedSession.state = 'IDLE';
        }
      }
    }
  }

  // ── Persist session ────────────────────────────────────────────────────────
  if (existingRow) {
    await c.env.DB.prepare(
      `UPDATE svc_whatsapp_sessions
       SET state = ?, collectedService = ?, collectedDate = ?, collectedTime = ?,
           appointmentId = ?, updatedAt = ?
       WHERE id = ?`
    ).bind(
      updatedSession.state,
      updatedSession.collectedService,
      updatedSession.collectedDate,
      updatedSession.collectedTime,
      updatedSession.appointmentId,
      updatedSession.updatedAt,
      sessionId,
    ).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO svc_whatsapp_sessions
         (id, tenantId, phone, state, collectedService, collectedDate, collectedTime, appointmentId, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sessionId,
      tenantId,
      phone,
      updatedSession.state,
      updatedSession.collectedService,
      updatedSession.collectedDate,
      updatedSession.collectedTime,
      updatedSession.appointmentId,
      updatedSession.updatedAt,
    ).run();
  }

  // ── Send outbound reply via @webwaka/core/notifications ───────────────────
  if (replyBody) {
    await sendWhatsAppMessage(
      { tenantId, to: phone, body: replyBody },
      c.env.TERMII_API_KEY,
      c.env.TERMII_WHATSAPP_SENDER_ID,
    );
  }

  // Acknowledge receipt to Termii (200 required to prevent retries)
  return c.json({ status: 'ok' }, 200);
});
