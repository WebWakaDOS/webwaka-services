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
 * AI Platform: uses capabilityId 'ai.services.support' for entitlement routing.
 * Fallback: if AI platform is unreachable the bot replies with a polite error
 * message and logs the failure — it never silently drops messages.
 */

import { Hono } from 'hono';
import type { Bindings, AppVariables } from '../../core/types';
import { getAICompletion } from '../../core/ai-platform-client';
import { sendWhatsAppMessage, verifyWebhookChallenge, parseTermiiInbound } from '../../core/whatsapp';
import { KNOWN_SERVICES } from '../appointments/stateMachine';

export const chatbotRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── Default FAQ context seeded into the AI system prompt ─────────────────────

const BASE_FAQ = `
You are a friendly, professional customer support assistant for a local service business using WebWaka.
You help customers with:
- Booking enquiries (available services, how to book, rescheduling, cancellations)
- Pricing and quote questions
- Business hours and location questions
- General FAQs about services

Available services: ${KNOWN_SERVICES.join(', ')}.

Key policies:
- Deposits may be required to confirm a booking.
- Cancellations within 24 hours may incur a cancellation fee.
- To book, customers can reply "book" or "hi" in WhatsApp, or visit the booking page.
- All prices are in Nigerian Naira (₦).

Always be concise (under 200 words), warm, and professional. If you cannot answer a question confidently,
direct the customer to contact the business directly.
`.trim();

// ─── Supported inbound payload shapes ─────────────────────────────────────────

interface WebWidgetPayload {
  message: string;
  sessionId: string | undefined;
}

function parseWebWidgetPayload(body: unknown): WebWidgetPayload | null {
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
        capabilityId: 'ai.services.support',
        maxTokens: 300,
        temperature: 0.6,
      },
      tenantId,
    );
    aiReply = aiResponse.content.trim();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[chatbot] AI platform error for tenant ${tenantId}: ${errorMessage}`);
    aiReply =
      "I'm sorry, I'm having trouble answering right now. Please contact us directly or try again in a moment.";
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
