import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aggregateDay, buildReport, loadArchive } from '../src/report.mjs';
import { validateMonth, validateStatus, validateRegistry, validateDay } from '../src/contract.mjs';
import { hash, canonical } from '../src/core.mjs';
import { A, B, archive, day, month, status } from './fixture.mjs';
const D = '2026-10-31';
test('two devices: 100+200=300, repeat is stable, replacing A with120 gives320', () => {
  const a = archive();
  const get = () => aggregateDay(D, a.registry.devices, a.records);
  assert.equal(get().totalTokens, 300); assert.equal(get().totalTokens, 300);
  assert.deepEqual(get().coverage, { expected: 2, received: 2, extraHistorical: 0, complete: true });
  a.records[A].months['2026-10'] = month(A, 120); assert.equal(get().totalTokens, 320);
});
test('registry-only device waits for upload, contributes neither zero nor price', () => {
  const a = archive({ waiting: true }), r = aggregateDay(D, a.registry.devices, a.records);
  assert.equal(r.totalTokens, 100); assert.equal(r.coverage.received, 1); assert.equal(r.coverage.expected, 2); assert.equal(r.coverage.complete, false);
  const report = buildReport(a, { until: D }); assert.equal(report.devices[1].status.state, 'awaiting_first_upload');
});
test('historical extras do not inflate coverage numerator', () => {
  const a = archive(); a.registry.devices[1].activeFrom = '2026-11-01';
  const r = aggregateDay(D, a.registry.devices, a.records);
  assert.equal(r.totalTokens, 300); assert.equal(r.coverage.received, 1); assert.equal(r.coverage.expected, 1); assert.equal(r.coverage.extraHistorical, 1);
});
test('unknown source blocks global sums, preserves single-device data', () => {
  const a = archive(); a.registry.devices[1].sourceIndependence = 'unknown';
  const r = aggregateDay(D, a.registry.devices, a.records); assert.equal(r.totalTokens, null); assert.equal(r.estimatedCostUSD, null); assert.deepEqual(r.models, {});
  assert.equal(aggregateDay(D, [a.registry.devices[1]], a.records).totalTokens, 200);
});
test('null fee is not free, no day is not zero, reasoning is a subset', () => {
  const a = archive(); a.records[A].months['2026-10'].days[0].estimatedCostUSD = null;
  const r = aggregateDay(D, a.registry.devices, a.records); assert.equal(r.estimatedCostUSD, null); assert.equal(r.knownCostSubtotalUSD, .2);
  const empty = aggregateDay('2026-11-01', a.registry.devices, a.records); assert.equal(empty.totalTokens, null); assert.equal(empty.estimatedCostUSD, null);
  const d = day(); d.reasoningOutputTokens = 1; assert.throws(() => validateDay(d));
});
test('closed schema, real dates, duplicate days and invalid totals reject', () => {
  const m = month(); validateMonth(m); m.secret = 'PRIVATE'; assert.throws(() => validateMonth(m)); delete m.secret;
  m.days.push(day()); assert.throws(() => validateMonth(m));
  const d = day(); d.totalTokens++; assert.throws(() => validateDay(d));
  d.date = '2026-02-30'; assert.throws(() => validateDay(d));
});
test('canonical month digest agrees with reviewed v1 sample', () => {
  const m = month(A, 0); m.days[0].observedAt = '2026-11-01T03:20:00Z';
  assert.equal(hash(m), '20983706af8115ce1e929dae7713b02a30b38830f38ff8260758235f4b0ffc00');
  const s = status(A, { '2026-10': m }); s.payloadDigest = '0'.repeat(64); assert.throws(() => validateStatus(s));
});
test('archive enforces status-month manifest and identity and orphan rejection', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-report-')); t.after(() => fs.rmSync(root, { recursive: true }));
  const a = archive({ second: false }), dir = path.join(root, 'devices', A, 'codex'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, 'registry.json'), canonical(a.registry));
  const statusPath = path.join(root, 'devices', A, 'status.json'), monthPath = path.join(dir, '2026-10.json');
  fs.writeFileSync(monthPath, canonical(a.records[A].months['2026-10'])); assert.throws(() => loadArchive(root), /orphan_month/);
  fs.writeFileSync(statusPath, canonical(a.records[A].status)); assert.equal(loadArchive(root).registry.devices.length, 1);
  fs.unlinkSync(monthPath); assert.throws(() => loadArchive(root), /month_manifest/);
});
test('model text is data, aggregate does not create object prototype properties', () => {
  const d = day(); d.models = { '<img src=x onerror=alert(1)>': d.models.example }; validateDay(d);
  const a = archive({ second: false }); a.records[A].months['2026-10'].days = [d];
  const r = aggregateDay(D, a.registry.devices, a.records); assert.equal(Object.keys(r.models)[0], '<img src=x onerror=alert(1)>');
  d.models = JSON.parse('{"__proto__":{}}'); assert.throws(() => validateDay(d));
});
