import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const VERSION = '0.1.0';
export const CCUSAGE_VERSION = '20.0.46';
export const ZONE = 'Asia/Shanghai';
export const BUCKETS = ['inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'totalTokens'];
export const ALL_TOKENS = [...BUCKETS, 'reasoningOutputTokens'];
export const PREFIX = 'tokens/data';
export const canonical = x => JSON.stringify(sortObject(x));
function sortObject(x) {
  if (Array.isArray(x)) return x.map(sortObject);
  if (x !== null && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, sortObject(x[k])]));
  if (typeof x === 'number' && !Number.isFinite(x)) throw new Error('nonfinite_number');
  if (x === undefined) throw new Error('undefined_value');
  return x;
}
export const hash = x => createHash('sha256').update(typeof x === 'string' ? x : canonical(x)).digest('hex');
export const nowUTC = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const today = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function addDays(d, n) { return new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
export function dates(since, until) {
  const out = [];
  for (let d = since; d <= until; d = addDays(d, 1)) { out.push(d); if (out.length > 20000) throw new Error('date_range_too_large'); }
  return out;
}
export function afterCutoff(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now) >= '03:17';
}
export function sum(values) {
  const n = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('unsafe_token_sum');
  return n;
}
export function privateDir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); }
export function atomicWrite(file, data) {
  privateDir(path.dirname(file));
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('linked_private_file');
  const tmp = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function saveState(file, body) {
  body.generation++;
  const data = canonical({ body, bodyChecksum: hash(body) });
  if (fs.existsSync(file)) { loadState(file); atomicWrite(file + '.prev', fs.readFileSync(file)); }
  atomicWrite(file, data + '\n');
}
export function loadState(file) {
  let v;
  try { v = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('state_corrupt_use_recover'); }
  if (v.bodyChecksum !== hash(v.body) || v.body?.formatVersion !== 1 || !Array.isArray(v.body.outbox) || !v.body.integrityIssues) throw new Error('state_corrupt_use_recover');
  return v.body;
}
export function newState(id, epoch, installationDate = today()) {
  return { formatVersion: 1, generation: 0, installationDate, deviceId: id, deviceEpoch: epoch, nextSequence: 1,
    ledger: {}, inventory: null, integrityIssues: {}, revisionHistory: [], outbox: [], lastCollectedThrough: null,
    lastUploadAck: null, lastErrorCategory: null, lastAttemptDate: null, lastAttemptAt: null };
}
function startId(pid) {
  try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim(); } catch { return ''; }
}
export function withLock(dir, task) {
  privateDir(path.dirname(dir));
  const owner = { pid: process.pid, start: startId(process.pid), nonce: randomUUID() };
  try { fs.mkdirSync(dir, { mode: 0o700 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let old; try { old = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'))); } catch { throw new Error('lock_owner_unknown'); }
    const current = startId(old.pid);
    if (current && current === old.start) throw new Error('collector_already_running');
    if (current || !old.start) throw new Error('lock_owner_unknown');
    fs.renameSync(dir, dir + '.stale-' + randomUUID());
    fs.mkdirSync(dir, { mode: 0o700 });
  }
  fs.writeFileSync(path.join(dir, 'owner.json'), canonical(owner), { mode: 0o600 });
  return Promise.resolve().then(task).finally(() => {
    const current = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json')));
    if (current.nonce === owner.nonce) fs.rmSync(dir, { recursive: true });
  });
}
export function compressRanges(entries) {
  const out = [];
  for (const reason of [...new Set(entries.map(x => x.reason))].sort()) {
    for (const date of [...new Set(entries.filter(x => x.reason === reason).map(x => x.date))].sort()) {
      const last = out.at(-1);
      if (last?.reason === reason && addDays(last.until, 1) === date) last.until = date;
      else out.push({ since: date, until: date, reason });
    }
  }
  return out.sort((a, b) => a.since.localeCompare(b.since) || a.until.localeCompare(b.until) || a.reason.localeCompare(b.reason));
}
