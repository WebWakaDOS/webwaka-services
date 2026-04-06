/**
 * AI Customer Support Bot — WebWaka Services Suite
 *
 * Handles inbound customer messages (from WhatsApp or a web widget) and
 * generates intelligent, contextual replies by calling getAICompletion()
 * from the centralised webwaka-ai-platform service.
 *
 * The bot is seeded with the tenant's service catalogue, FAQ, and business
 * context so it can answer booking enquiries, pricing questions, and
 * general FAQs without human intervention.
 *
 * Routes (UNAUTHENTICATED — secured by per-tenant URL obscurity + rate limit):
 *   GET  /webhook/support/:tenantId — verify challenge (Meta hub.challenge compatible)
 *   POST /webhook/support/:tenantId — receive message, return AI response
 *
 * AI Platform: uses capabilityId 'ai.svc_services.support' for entitlement routing.
 * Fallback: if AI platform is unreachable the bot replies with a polite error
 * message directing the customer to call — it never silently drops messages.
 *
 * Security: prompt injection is mitigated by keeping user content strictly in
 * the `prompt` field and the system instruction in a fixed `systemPrompt`.
 * The endpoint is rate-limited at the worker level (20 messages/min per tenant).
 */

import { Hono } from 'hono';
import type { Bindings, AppVariables } from '../../core/types';
import { getAICompletion } from '../../core/ai-platform-client';
import { sendWhatsAppMessage, verifyWebhookChallenge, parseTermiiInbound } from '../../core/whatsapp';
import { KNOWN_SERVICES } from '../svc_appointments/stateMachine';

export const chatbotRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Default FAQ context seeded into the AI system prompt ─────────────────────

export const BASE_FAQ = `
You are a friendly, professional customer support assistant for a local service business using WebWaka.
You help customers with:
- Booking enquiries (available svc_services, how to book, rescheduling, cancellations)
- Pricing and quote questions
- Business hours and location questions
- General FAQs about svc_services

Available svc_services: ${KNOWN_SERVICES.join(', ')}.

Key policies:
- Deposits may be required to confirm a booking.
- Cancellations within 24 hours may incur a cancellation fee.
- To book, customers can reply "book" or "hi" in WhatsApp, or visit the booking page.
- All prices are in Nigerian Naira (₦).

Always be concise (under 200 words), warm, and professional. If you cannot answer a question confidently,
direct the customer to contact the business directly or call us to book.
`.trim();

/**
 * The fallback message returned when the AI platform is unavailable (e.g. 503).
 * Explicitly directs the customer to call as per QA-SRV-3 requirements.
 */
export const AI_FALLBACK_MESSAGE =
  "I'm sorry, I'm having trouble answering right now. Please call us to book or get assistance, and we'll be happy to help!";

// ─── Supported inbound payload shapes ─────────────────────────────────────────

export interface WebWidgetPayload {
  message: string;
  sessionId: string | undefined;
}

/**
 * Parses and validates a web-widget inbound payload.
 * Returns null for any unrecognised or empty payload.
 *
 * Shape: { message: string, sessionId?: string }
 */
export function parseWebWidgetPayload(body: unknown): WebWidgetPayload | null {
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>)['message'] !== 'string'
  ) {
    return null;
  }
  const b = body as Record<string, unknown>;
  const message = String(b['message']).trim();
  if (message.length === 0) return null;
  return {
    message,
    sessionId: typeof b['sessionId'] === 'string' ? b['sessionId'] : undefined,
  };
}

// ─── GET /webhook/support/:tenantId — Verify Challenge ───────────────────────

chatbotRouter.get('/:tenantId', async (c) => {
  const mode = c.req.query('hub.mode') ?? null;
  const verifyToken = c.req.query('hub.verify_token') ?? null;
  const challenge = c.req.query('hub.challenge') ?? null;

  const expectedToken = c.env.WHATSAPP_VERIFY_TOKEN;
  const echo = verifyWebhookChallenge({ mode, verifyToken, challenge, expectedToken });

  if (echo) return c.text(echo, 200);
  return c.json({ error: 'Forbidden' }, 403);
});

// ─── POST /webhook/support/:tenantId — Handle Inbound Message ─────────────────

chatbotRouter.post('/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId');

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Support two inbound payload shapes:
  // 1. Termii WhatsApp inbound (for WhatsApp channel)
  // 2. Web widget payload { message, sessionId? }
  const termiiInbound = parseTermiiInbound(rawBody);
  const webPayload = termiiInbound ? null : parseWebWidgetPayload(rawBody);

  if (!termiiInbound && !webPayload) {
    return c.json({ error: 'Unrecognised payload shape' }, 400);
  }

  const userMessage = termiiInbound ? termiiInbound.message : (webPayload?.message ?? '');
  const senderPhone = termiiInbound?.sender ?? null;

  // ── Call AI platform ───────────────────────────────────────────────────────
  // Security: userMessage is placed only in the `prompt` field; the system
  // instruction is fixed in BASE_FAQ — this prevents prompt injection attacks.
  let aiReply: string;
  try {
    const aiResponse = await getAICompletion(
      {
        AI_PLATFORM_URL: c.env.AI_PLATFORM_URL,
        INTER_SERVICE_SECRET: c.env.INTER_SERVICE_SECRET,
        TENANT_ID: tenantId,
      },
      {
        systemPrompt: BASE_FAQ,
        prompt: userMessage,
        capabilityId: 'ai.svc_services.support',
        maxTokens: 300,
        temperature: 0.6,
      },
      tenantId,
    );
    aiReply = aiResponse.content.trim();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[chatbot] AI platform error for tenant ${tenantId}: ${errorMessage}`);
    // Graceful fallback — never drop the customer; explicitly direct them to call
    aiReply = AI_FALLBACK_MESSAGE;
  }

  // ── Deliver reply ──────────────────────────────────────────────────────────
  if (termiiInbound && senderPhone) {
    // WhatsApp channel — send via Termii
    await sendWhatsAppMessage(
      { tenantId, to: senderPhone, body: aiReply },
      c.env.TERMII_API_KEY,
      c.env.TERMII_WHATSAPP_SENDER_ID,
    );
    return c.json({ status: 'ok' }, 200);
  }

  // Web widget channel — return reply directly in response body
  return c.json({
    reply: aiReply,
    sessionId: webPayload?.sessionId ?? null,
  });
});
