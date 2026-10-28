import { createHmac } from 'crypto';
import { verifySignature, webhookSlot } from './TriggerHelpers';

const secret = 'whsec_test';
const body = '{"event":"message.received","id":"evt_1"}';
const sign = (t: number, payload = body, key = secret) =>
  `t=${t},v1=${createHmac('sha256', key).update(`${t}.${payload}`).digest('hex')}`;

describe('verifySignature', () => {
  const now = 1_800_000_000;

  it('accepts a fresh signature over the exact body', () => {
    expect(verifySignature(sign(now), body, secret, now)).toBe(true);
    expect(verifySignature(sign(now - 60), body, secret, now)).toBe(true);
  });

  it('refuses a changed body, a wrong secret or a missing header', () => {
    expect(verifySignature(sign(now), body.replace('evt_1', 'evt_2'), secret, now)).toBe(false);
    expect(verifySignature(sign(now, body, 'other'), body, secret, now)).toBe(false);
    expect(verifySignature(undefined, body, secret, now)).toBe(false);
    expect(verifySignature('garbage', body, secret, now)).toBe(false);
  });

  it('refuses a signature older than five minutes (replay)', () => {
    expect(verifySignature(sign(now - 301), body, secret, now)).toBe(false);
  });
});

describe('webhookSlot', () => {
  const own = 'https://n8n.example.com/webhook/abc/webhook';

  it('is free when no webhook is set', () => {
    expect(webhookSlot(null, own)).toBe('free');
    expect(webhookSlot({}, own)).toBe('free');
  });

  it('is ours when the saved URL is this trigger', () => {
    expect(webhookSlot({ url: own }, own)).toBe('ours');
  });

  it('is taken by any other URL, which must never be overwritten', () => {
    expect(webhookSlot({ url: 'https://bot.example.com/hook' }, own)).toBe('taken');
  });
});
