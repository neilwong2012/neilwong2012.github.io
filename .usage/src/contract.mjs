import Ajv from 'ajv';
import { BUCKETS, ALL_TOKENS, canonical, hash, sum, ZONE } from './core.mjs';

const obj = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const text = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[^\\u0000-\\u001f\\u007f]+$' };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const month = { type: 'string', pattern: '^\\d{4}-\\d{2}$' };
const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const time = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const revision = { ...integer, minimum: 1 };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const enumeration = values => ({ enum: values });
const bool = { type: 'boolean' };
const version = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' };
const flags = ['inventory_lost', 'inventory_shrunk', 'inventory_ambiguous', 'counter_decrease', 'repair', 'pricing_unknown'];
const reasons = ['source_missing', 'source_unreadable', 'cli_failed', 'schema_mismatch', 'inventory_uncertain', 'counter_decrease'];
const arr = items => ({ type: 'array', items, uniqueItems: true });
const tokens = Object.fromEntries(BUCKETS.map(k => [k, integer]));
const model = obj({ ...tokens, reasoningOutputTokens: nullable(integer), isFallback: nullable(bool), missingPricing: nullable(bool) });
const models = { type: 'object', propertyNames: { ...text, not: { enum: ['__proto__', 'constructor', 'prototype'] } }, additionalProperties: model };
const quality = obj({ coverage: enumeration(['observed', 'historical_observed']), suspect: bool, flags: arr(enumeration(flags)) });
const provenance = obj({ ccusageVersion: version, collectorVersion: version, pricingSource: { const: 'ccusage' }, pricingRevision: nullable(text), pricingMode: enumeration(['online', 'offline', 'unknown']) });
export const daySchema = obj({ date, dayRevision: revision, ...tokens, reasoningOutputTokens: nullable(integer),
  estimatedCostUSD: nullable({ type: 'number', minimum: 0 }), pricingStatus: enumeration(['not-applicable', 'unpriced', 'fallback', 'estimated', 'unknown']), models, quality, observedAt: time, provenance });
const monthSchema = obj({ schemaVersion: { const: 1 }, deviceId: uuid, agent: { const: 'codex' }, month, timezone: { const: ZONE }, monthRevision: revision, days: { type: 'array', items: daySchema } });
const range = obj({ since: date, until: date, reason: enumeration(reasons) });
const qualitySummary = obj({ state: enumeration(['ok', 'attention']), suspectDates: arr(date), uncollectedRanges: arr(range), lastCollectionError: nullable(enumeration(reasons)) });
const statusSchema = obj({ schemaVersion: { const: 1 }, deviceId: uuid, deviceEpoch: uuid, sequence: revision, createdAt: time,
  collectedThrough: nullable(date), qualitySummary, monthDigests: { type: 'object', propertyNames: month, additionalProperties: digest }, payloadDigest: digest });
const device = obj({ deviceId: uuid, deviceEpoch: uuid, alias: { ...text, maxLength: 40 }, activeFrom: date, inactiveAfter: nullable(date), sourceIndependence: enumeration(['confirmed', 'unknown']), agents: { const: ['codex'] } });
const registrySchema = obj({ schemaVersion: { const: 1 }, timezone: { const: ZONE }, devices: { type: 'array', items: device } });
const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
const validators = Object.fromEntries(Object.entries({ day: daySchema, month: monthSchema, status: statusSchema, registry: registrySchema }).map(([k, v]) => [k, ajv.compile(v)]));
function assert(condition, message) { if (!condition) throw new Error('contract_' + message); }
function structural(kind, value) { assert(validators[kind](value), kind + '_' + ajv.errorsText(validators[kind].errors)); }
export function validDate(d) { assert(/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d, 'date'); }
function sortedUnique(values) { return values.every((x, i) => !i || values[i - 1] < x); }
function validTime(t) { assert(!Number.isNaN(Date.parse(t)) && new Date(t).toISOString().replace('.000Z', 'Z') === t, 'utc_time'); }
function tokenEquation(d) {
  assert(d.totalTokens === sum(BUCKETS.slice(0, 4).map(k => d[k])), 'token_equation');
  assert(d.reasoningOutputTokens === null || d.reasoningOutputTokens <= d.outputTokens, 'reasoning_subset');
}
export function validateDay(d) {
  structural('day', d); validDate(d.date); tokenEquation(d);
  validTime(d.observedAt);
  const ms = Object.values(d.models); ms.forEach(tokenEquation);
  for (const k of BUCKETS) assert(d[k] === sum(ms.map(m => m[k])), 'model_sum_' + k);
  const reasoning = ms.some(m => m.reasoningOutputTokens === null) ? null : sum(ms.map(m => m.reasoningOutputTokens));
  assert(d.reasoningOutputTokens === reasoning, 'reasoning_sum');
  assert(sortedUnique(d.quality.flags), 'flags_order');
  assert(!d.quality.flags.some(f => flags.slice(0, 4).includes(f)) || d.quality.suspect, 'suspect_flags');
  if (!d.totalTokens) assert(d.estimatedCostUSD === 0 && d.pricingStatus === 'not-applicable', 'zero_cost');
  if (d.pricingStatus === 'unpriced') assert(d.estimatedCostUSD === null, 'unpriced_cost');
  if (ms.some(m => m.missingPricing === true) && d.totalTokens) assert(d.pricingStatus === 'unpriced', 'missing_pricing_status');
  if (d.pricingStatus === 'fallback') assert(ms.some(m => m.isFallback === true), 'fallback_status');
  if (d.pricingStatus === 'estimated') assert(d.estimatedCostUSD !== null && ms.every(m => m.isFallback === false && m.missingPricing === false), 'estimated_status');
  if (['unknown', 'unpriced'].includes(d.pricingStatus)) assert(d.quality.flags.includes('pricing_unknown'), 'unknown_flag');
  return d;
}
export function validateMonth(m, deviceId = m.deviceId, monthName = m.month) {
  structural('month', m); assert(m.deviceId === deviceId && m.month === monthName, 'month_identity');
  validDate(m.month + '-01'); assert(sortedUnique(m.days.map(d => d.date)), 'days_order');
  for (const d of m.days) { validateDay(d); assert(d.date.startsWith(m.month + '-'), 'day_month'); }
  return m;
}
export function statusDigest(s) { const { payloadDigest, ...body } = s; return hash(body); }
export function validateStatus(s, id = s.deviceId, epoch = s.deviceEpoch) {
  structural('status', s); assert(s.deviceId === id && s.deviceEpoch === epoch, 'status_identity');
  validTime(s.createdAt);
  if (s.collectedThrough !== null) validDate(s.collectedThrough);
  assert(statusDigest(s) === s.payloadDigest, 'status_digest');
  assert(sortedUnique(s.qualitySummary.suspectDates), 'suspect_order'); s.qualitySummary.suspectDates.forEach(validDate);
  for (const r of s.qualitySummary.uncollectedRanges) { validDate(r.since); validDate(r.until); assert(r.since <= r.until, 'range'); }
  for (const m of Object.keys(s.monthDigests)) validDate(m + '-01');
  assert(s.qualitySummary.state === ((s.qualitySummary.suspectDates.length || s.qualitySummary.uncollectedRanges.length || s.qualitySummary.lastCollectionError) ? 'attention' : 'ok'), 'summary_state');
  return s;
}
export function validateRegistry(r) {
  structural('registry', r); const ids = r.devices.map(d => d.deviceId); assert(sortedUnique(ids), 'device_order');
  for (const d of r.devices) { validDate(d.activeFrom); if (d.inactiveAfter) { validDate(d.inactiveAfter); assert(d.inactiveAfter >= d.activeFrom, 'active_range'); } }
  return r;
}
export function semanticDay(d) { const { observedAt, dayRevision, ...body } = d; return canonical(body); }
export { ALL_TOKENS };
