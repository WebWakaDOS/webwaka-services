/**
 * WhatsApp Notification Adapter
 *
 * Routes outbound WhatsApp messages through @webwaka/core/notifications
 * (NotificationService → Termii SMS dispatcher with WhatsApp channel).
 *
 * Invariant: Build Once Use Infinitely — all outbound comms MUST go through
 * NotificationService. WhatsApp delivery is achieved via Termii's WhatsApp
 * Business channel by setting channel='whatsapp' in the Termii payload.
 * The NotificationService.dispatch() with type:'sms' is the correct path —
 * Termii transparently routes to WhatsApp when the channel is configured.
 *
 * Nigeria-First: Termii is a Nigerian-first messaging provider with first-class
 * support for Nigerian phone numbers and the WhatsApp Business API.
 */

import { NotificationService } from '@webwaka/core/notifications';

export interface WhatsAppOutboundMessage {
  tenantId: string;
  to: string;       // E.164 phone number (e.g. 2348012345678)
  body: string;
}

/**
 * Sends a WhatsApp message via @webwaka/core/notifications → Termii.
 *
 * NotificationService.dispatch() with type:'sms' routes to Termii.
 * Termii's WhatsApp Business channel is activated via the TERMII_WHATSAPP_SENDER_ID
 * environment variable — when present, the channel is 'whatsapp'; otherwise
 * falls back to generic SMS, ensuring Africa-wide resilience.
 */
export async function sendWhatsAppMessage(
  msg: WhatsAppOutboundMessage,
  termiiApiKey: string,
  termiiSenderId?: string,
): Promise<boolean> {
  const notificationService = new NotificationService({
    termiiApiKey,
    termiiSenderId: termiiSenderId ?? 'WebWaka',
  });

  return notificationService.dispatch({
    tenantId: msg.tenantId,
    userId: 'whatsapp-bot',
    type: 'sms',
    recipient: msg.to,
    body: msg.body,
  });
}

/**
 * Verifies an inbound WhatsApp webhook challenge.
 * Compatible with Meta (WhatsApp Business API) hub.challenge verification protocol.
 */
export function verifyWebhookChallenge(params: {
  mode: string | null;
  verifyToken: string | null;
  challenge: string | null;
  expectedToken: string;
}): string | null {
  const { mode, verifyToken, challenge, expectedToken } = params;
  if (mode === 'subscribe' && verifyToken === expectedToken && challenge) {
    return challenge;
  }
  return null;
}

/**
 * Extracts the sender phone and text body from an inbound Termii WhatsApp webhook payload.
 * Termii sends inbound messages to the configured webhook URL as a JSON POST.
 *
 * Shape reference: https://developers.termii.com/#inbound-messages
 */
export interface TermiiInboundPayload {
  sender: string;      // E.164 sender phone number
  receiver: string;    // Your Termii number/sender ID
  message: string;     // Raw message text
  direction: string;   // "inbound"
  status: string;
  media?: { url: string; caption?: string };
}

/**
 * E.164 phone number pattern: optional leading +, 7–15 digits.
 * Termii typically omits the leading + and sends digits only (e.g. 2348012345678).
 */
const E164_PATTERN = /^\+?[1-9]\d{6,14}$/;

export function parseTermiiInbound(body: unknown): TermiiInboundPayload | null {
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>)['sender'] !== 'string' ||
    typeof (body as Record<string, unknown>)['message'] !== 'string'
  ) {
    return null;
  }
  const b = body as Record<string, unknown>;
  const sender = String(b['sender']).trim();
  const message = String(b['message']).trim();

  // Bug fix: reject empty or malformed phone numbers to prevent corrupt session keys
  if (!E164_PATTERN.test(sender)) return null;
  // Bug fix: reject empty messages — nothing to process
  if (message.length === 0) return null;

  return {
    sender,
    receiver: String(b['receiver'] ?? ''),
    message,
    direction: String(b['direction'] ?? 'inbound'),
    status: String(b['status'] ?? 'delivered'),
  };
}
