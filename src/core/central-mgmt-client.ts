/**
 * WebWaka Central Management Ledger Client
 *
 * Emits financial events from webwaka-svc_services to the immutable financial ledger
 * managed by webwaka-central-mgmt. All transactions (svc_invoices, svc_quotes, svc_deposits)
 * MUST be recorded here per the platform governance rules.
 *
 * Invariant: webwaka-central-mgmt OWNS the immutable ledger. This vertical
 * MUST NOT maintain its own global ledger — only emit events and receive ACKs.
 *
 * Retry policy: Exponential backoff with 3 retries (500ms, 1s, 2s).
 * On permanent failure, the error is logged but does NOT block the local
 * operation — the DLQ in webwaka-central-mgmt handles eventual consistency.
 */

export type LedgerEventType =
  | 'invoice.created'
  | 'invoice.sent'
  | 'invoice.paid'
  | 'invoice.cancelled'
  | 'quote.created'
  | 'quote.accepted'
  | 'quote.rejected'
  | 'deposit.created'
  | 'deposit.paid'
  | 'deposit.refunded'
  | 'deposit.forfeited';

export interface LedgerEvent {
  eventType: LedgerEventType;
  tenantId: string;
  entityId: string;          // ID of the invoice/quote/deposit
  entityType: 'invoice' | 'quote' | 'deposit';
  amountKobo: number;        // ALWAYS kobo — Invariant 5: Nigeria First
  currency: 'NGN';           // Default currency — Nigeria First
  /** e.g. invoiceNumber or paystackReference */
  referenceNumber?: string | undefined;
  clientId?: string | undefined;
  projectId?: string | undefined;
  metadata?: Record<string, string | number | boolean> | undefined;
  occurredAt: string;        // ISO UTC datetime
}

export interface CentralMgmtEnv {
  /** URL of the webwaka-central-mgmt worker — undefined means ledger events are skipped */
  CENTRAL_MGMT_URL: string | undefined;
  /** Inter-service secret for authenticating calls to webwaka-central-mgmt */
  INTER_SERVICE_SECRET: string;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Emits a financial event to the webwaka-central-mgmt ledger with retry logic.
 *
 * @returns true if acknowledged, false if all retries exhausted.
 *          Failure does NOT throw — caller should log and continue.
 */
export async function emitLedgerEvent(
  env: CentralMgmtEnv,
  event: LedgerEvent,
): Promise<boolean> {
  const baseUrl = env.CENTRAL_MGMT_URL;
  if (!baseUrl) {
    console.warn('[central-mgmt] CENTRAL_MGMT_URL not configured — ledger event skipped', {
      eventType: event.eventType,
      entityId: event.entityId,
    });
    return false;
  }

  const url = `${baseUrl}/api/ledger/events`;
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Service': 'webwaka-svc_services',
    'X-Inter-Service-Secret': env.INTER_SERVICE_SECRET,
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        return true;
      }

      // 4xx errors are not retryable (malformed payload or auth issue)
      if (res.status >= 400 && res.status < 500) {
        console.error('[central-mgmt] Non-retryable error emitting ledger event', {
          status: res.status,
          eventType: event.eventType,
          entityId: event.entityId,
        });
        return false;
      }

      // 5xx — retryable
      console.warn(`[central-mgmt] Transient error (attempt ${attempt + 1}/${MAX_RETRIES})`, {
        status: res.status,
        eventType: event.eventType,
      });
    } catch (err) {
      console.warn(`[central-mgmt] Fetch error (attempt ${attempt + 1}/${MAX_RETRIES})`, err);
    }

    // Exponential backoff before next retry (skip delay after last attempt)
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt)));
    }
  }

  console.error('[central-mgmt] All retries exhausted — ledger event undelivered', {
    eventType: event.eventType,
    entityId: event.entityId,
    amountKobo: event.amountKobo,
  });
  return false;
}
