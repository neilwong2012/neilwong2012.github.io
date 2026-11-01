import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildReport, loadArchive } from '../src/report.mjs';

const root = process.cwd();
const output = path.resolve(process.argv[2] || 'dist');
const publicMode = fs.existsSync(path.join(root, '.usage/src/report.mjs'));
const dataDir = path.join(root, 'tokens/data');
if (!fs.existsSync(dataDir)) throw new Error('archive_missing');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const report = buildReport(loadArchive(dataDir), { sourceCommit });
fs.mkdirSync(output, { recursive: true });
if (!publicMode) throw new Error('export_to_site_checkout_first');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of files) {
  if (/^(?:\.git|\.github|\.usage|node_modules|dist)(?:\/|$)/.test(file) || /^package(?:-lock)?\.json$/.test(file)) continue;
  if (!fs.existsSync(path.join(root, file))) continue;
  if (fs.lstatSync(path.join(root, file)).isSymbolicLink()) throw new Error('linked_site_source');
  const target = path.join(output, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, file), target);
}
fs.mkdirSync(path.join(output, 'tokens'), { recursive: true });
fs.writeFileSync(path.join(output, 'tokens/report.json'), JSON.stringify(report));
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log(JSON.stringify({ built: true, devices: report.devices.length, sourceCommit, until: report.until }));
