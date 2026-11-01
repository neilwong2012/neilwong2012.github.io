import fs from 'node:fs';
import path from 'node:path';
import { ALL_TOKENS, BUCKETS, ZONE, VERSION, canonical, hash, sum, today, addDays, dates, nowUTC } from './core.mjs';
import { validateRegistry, validateMonth, validateStatus } from './contract.mjs';

function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function loadArchive(dataDir) {
  const registry = validateRegistry(json(path.join(dataDir, 'registry.json'))), records = {};
  const registered = new Set(registry.devices.map(d => d.deviceId));
  const devicesDir = path.join(dataDir, 'devices');
  if (fs.existsSync(devicesDir)) for (const ent of fs.readdirSync(devicesDir)) if (!registered.has(ent)) throw new Error('unregistered_device_directory');
  for (const d of registry.devices) {
    const dir = path.join(devicesDir, d.deviceId), statusFile = path.join(dir, 'status.json'), monthsDir = path.join(dir, 'codex');
    const files = fs.existsSync(monthsDir) ? fs.readdirSync(monthsDir) : [];
    if (!fs.existsSync(statusFile)) { if (files.length) throw new Error('orphan_month'); records[d.deviceId] = { status: null, months: {} }; continue; }
    const status = validateStatus(json(statusFile), d.deviceId, d.deviceEpoch), months = {};
    if (canonical(files.sort()) !== canonical(Object.keys(status.monthDigests).map(m => m + '.json').sort())) throw new Error('month_manifest_mismatch');
    for (const [m, digest] of Object.entries(status.monthDigests)) {
      months[m] = validateMonth(json(path.join(monthsDir, m + '.json')), d.deviceId, m);
      if (hash(months[m]) !== digest) throw new Error('month_digest_mismatch');
    }
    records[d.deviceId] = { status, months };
  }
  return { registry, records };
}
export function aggregateDay(date, selected, records) {
  const expected = selected.filter(d => d.activeFrom <= date && (!d.inactiveAfter || d.inactiveAfter >= date));
  const contributors = selected.flatMap(device => {
    const day = records[device.deviceId]?.months[date.slice(0, 7)]?.days.find(d => d.date === date);
    return day ? [{ device, day }] : [];
  });
  const expectedSet = new Set(expected.map(d => d.deviceId));
  const receivedExpected = contributors.filter(x => expectedSet.has(x.device.deviceId)).length;
  const independent = contributors.every(x => x.device.sourceIndependence === 'confirmed');
  const canSum = contributors.length > 0 && (selected.length === 1 || independent);
  const knownCosts = contributors.map(x => x.day.estimatedCostUSD).filter(x => x !== null);
  const knownCostSubtotalUSD = knownCosts.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(knownCostSubtotalUSD)) throw new Error('unsafe_cost_sum');
  const buckets = Object.fromEntries(ALL_TOKENS.map(k => [k, canSum && !contributors.some(x => x.day[k] === null) ? sum(contributors.map(x => x.day[k])) : null]));
  const models = {};
  if (canSum) {
    for (const { day } of contributors) for (const [name, m] of Object.entries(day.models)) {
      models[name] ||= Object.fromEntries(ALL_TOKENS.map(k => [k, 0]));
      for (const k of ALL_TOKENS) models[name][k] = models[name][k] === null || m[k] === null ? null : sum([models[name][k], m[k]]);
    }
  }
  const suspect = contributors.some(x => x.day.quality.suspect);
  const missingCost = contributors.some(x => x.day.estimatedCostUSD === null);
  return { date, ...buckets, estimatedCostUSD: canSum && !missingCost ? knownCostSubtotalUSD : null,
    knownCostSubtotalUSD: canSum && knownCosts.length ? knownCostSubtotalUSD : null, models,
    coverage: { expected: expected.length, received: receivedExpected, extraHistorical: contributors.length - receivedExpected,
      complete: expected.length > 0 && receivedExpected === expected.length && !suspect && independent },
    receivedDeviceIds: contributors.map(x => x.device.deviceId), aggregationAllowed: canSum, sourceIndependence: independent ? 'confirmed' : 'unknown', suspect,
    pricingStatuses: [...new Set(contributors.map(x => x.day.pricingStatus))].sort(),
    versions: [...new Set(contributors.map(x => x.day.provenance.ccusageVersion + '/' + x.day.provenance.collectorVersion))].sort(),
    unknownCost: missingCost, hasData: contributors.length > 0 };
}
export function buildReport(archive, { sourceCommit = 'local-preview', generatedAt = nowUTC(), until = addDays(today(), -1) } = {}) {
  const { registry, records } = archive; validateRegistry(registry);
  const actualDates = Object.values(records).flatMap(r => Object.values(r.months).flatMap(m => m.days.map(d => d.date)));
  const start = [...actualDates, ...registry.devices.map(d => d.activeFrom), until].sort()[0];
  const domain = dates(start, until), views = {};
  views.all = { label: '全部设备', daily: domain.map(date => aggregateDay(date, registry.devices, records)) };
  for (const d of registry.devices) views[d.deviceId] = { label: d.alias, daily: domain.map(date => aggregateDay(date, [d], records)) };
  const devices = registry.devices.map(d => ({ ...d, status: records[d.deviceId].status ? {
    state: records[d.deviceId].status.qualitySummary.state, sequence: records[d.deviceId].status.sequence,
    collectedThrough: records[d.deviceId].status.collectedThrough, createdAt: records[d.deviceId].status.createdAt,
    qualitySummary: records[d.deviceId].status.qualitySummary,
  } : { state: 'awaiting_first_upload', sequence: null, collectedThrough: null, createdAt: null, qualitySummary: null } }));
  return { schemaVersion: 1, timezone: ZONE, collectorVersion: VERSION, generatedAt, sourceCommit, until, devices, views };
}
