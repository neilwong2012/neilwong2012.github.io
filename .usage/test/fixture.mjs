import { ALL_TOKENS, hash, ZONE } from '../src/core.mjs';
import { statusDigest } from '../src/contract.mjs';
export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const EPOCH = '33333333-3333-4333-8333-333333333333';
export const ROOT_ID = '44444444-4444-4444-8444-444444444444';
export const stamp = '2026-11-01T00:00:00Z';
export function day(n = 100, date = '2026-10-31') {
  const tokens = Object.fromEntries(ALL_TOKENS.map(k => [k, k === 'inputTokens' || k === 'totalTokens' ? n : 0]));
  return { date, dayRevision: 1, ...tokens, estimatedCostUSD: n / 1000, pricingStatus: n ? 'estimated' : 'not-applicable',
    models: n ? { example: { ...tokens, isFallback: false, missingPricing: false } } : {},
    quality: { coverage: 'observed', suspect: false, flags: [] }, observedAt: stamp,
    provenance: { ccusageVersion: '20.0.46', collectorVersion: '0.1.0', pricingSource: 'ccusage', pricingRevision: null, pricingMode: 'offline' } };
}
export function month(id = A, n = 100, date = '2026-10-31') { return { schemaVersion: 1, deviceId: id, agent: 'codex', month: date.slice(0, 7), timezone: ZONE, monthRevision: 1, days: [day(n, date)] }; }
export function status(id, months, sequence = 1) {
  const s = { schemaVersion: 1, deviceId: id, deviceEpoch: EPOCH, sequence, createdAt: stamp, collectedThrough: '2026-10-31',
    qualitySummary: { state: 'ok', suspectDates: [], uncollectedRanges: [], lastCollectionError: null }, monthDigests: Object.fromEntries(Object.entries(months).map(([k, m]) => [k, hash(m)])), payloadDigest: '' };
  s.payloadDigest = statusDigest(s); return s;
}
export function device(id = A, activeFrom = '2026-10-31') { return { deviceId: id, deviceEpoch: EPOCH, alias: id === A ? 'mac-01' : 'mac-02', activeFrom, inactiveAfter: null, sourceIndependence: 'confirmed', agents: ['codex'] }; }
export function archive({ second = true, waiting = false } = {}) {
  const monthsA = { '2026-10': month(A) }, monthsB = { '2026-10': month(B, 200) };
  return { registry: { schemaVersion: 1, timezone: ZONE, devices: [device(A), ...(second ? [device(B)] : [])] }, records: {
    [A]: { status: status(A, monthsA), months: monthsA }, ...(second ? { [B]: waiting ? { status: null, months: {} } : { status: status(B, monthsB), months: monthsB } } : {}) } };
}
export function raw(n = 100, date = '2026-10-31') { const d = day(n, date); return { daily: [{ date, ...Object.fromEntries(ALL_TOKENS.map(k => [k, d[k]])), costUSD: d.estimatedCostUSD,
  models: d.models }], totals: {} }; }
