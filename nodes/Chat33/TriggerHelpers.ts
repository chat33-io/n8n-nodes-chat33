import { createHmac, timingSafeEqual } from 'crypto';

/** Events Chat33 can send to a workspace webhook. */
export const TRIGGER_EVENTS = ['message.received', 'lead.captured'] as const;

/** A signature older than this is refused, so a captured request can't be replayed later. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Checks `X-Chat33-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`
 * (the shape Stripe uses) against the workspace webhook secret.
 */
export function verifySignature(
  header: string | undefined,
  rawBody: string,
  secret: string,
  nowSeconds: number,
): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const at = part.indexOf('=');
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const given = String(parts.v1);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * Chat33 has one webhook per workspace. Who holds it decides what activating
 * the trigger may do: take a free slot, keep its own, or refuse to overwrite
 * someone else's (a custom bot, another n8n workflow).
 */
export function webhookSlot(current: { url?: unknown } | null | undefined, ownUrl: string): 'free' | 'ours' | 'taken' {
  if (!current || typeof current.url !== 'string' || !current.url) return 'free';
  return current.url === ownUrl ? 'ours' : 'taken';
}
