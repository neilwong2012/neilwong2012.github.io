const $ = id => document.getElementById(id);
const number = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US').format(n);
const short = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
const money = n => n === null || n === undefined ? '—' : '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
let report, selected = 'all', range = '30', rows = [], showAll = false;
function element(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
function addDays(d, n) { return new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function coverage(d) { return d.coverage.expected ? `${d.coverage.received}/${d.coverage.expected}` + (d.coverage.extraHistorical ? ` +${d.coverage.extraHistorical} 历史` : '') : d.hasData ? '历史记录' : '未上报'; }
function total(ds, key) { const ns = ds.map(d => d[key]).filter(n => n !== null); return ns.length ? ns.reduce((a, b) => a + b, 0) : null; }
function update() {
  const view = report.views[selected];
  rows = view.daily.filter(d => d.date >= $('since').value && d.date <= $('until').value);
  const y = view.daily.find(d => d.date === report.until);
  $('yesterday-date').textContent = report.until.slice(5);
  $('yesterday').textContent = short(y?.totalTokens);
  $('yesterday-meta').textContent = y ? `${number(y.totalTokens)} Token · ${coverage(y)}` : '暂无上报';
  $('period-tokens').textContent = short(total(rows, 'totalTokens'));
  const complete = rows.filter(d => d.coverage.complete).length;
  $('tokens-meta').textContent = `${number(total(rows, 'totalTokens'))} Token · ${rows.filter(d => d.hasData).length} 天有记录`;
  const partialCost = rows.some(d => d.estimatedCostUSD === null && d.hasData);
  $('period-cost').textContent = money(total(rows, partialCost ? 'knownCostSubtotalUSD' : 'estimatedCostUSD'));
  $('cost-meta').textContent = partialCost ? '已知金额小计，部分模型缺价' : rows.some(d => d.pricingStatuses.includes('fallback')) ? '含模型回退价格 · 非实际账单' : 'API 等价估算 · 非实际账单';
  $('coverage').textContent = rows.length ? `${complete} / ${rows.length}` : '—';
  $('coverage-meta').textContent = '数据全齐天数 / 所选天数';
  $('period-label').textContent = `${$('since').value.slice(5)} — ${$('until').value.slice(5)}`;
  const unknownSource = rows.some(d => d.hasData && !d.aggregationAllowed);
  const notices = [];
  if (unknownSource) notices.push('部分设备尚未确认日志来源独立，跨设备合计暂不可用。请选择单台设备查看。');
  if (rows.some(d => d.hasData && !d.coverage.complete)) notices.push('部分日期上报不全或仅有历史记录，当前数字为已上报用量。');
  if (rows.some(d => d.suspect)) notices.push('存在日志变化待核对的日期，已保留上次可信值。');
  if (!report.devices.length) notices.push('等待第一台设备接入。设备登记并上传后，这里会自动显示汇总。');
  $('notice').hidden = !notices.length; $('notice').textContent = notices.join(' ');
  drawChart(); drawModels(); drawTable();
}
function svgNode(tag, attrs, text) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text !== undefined) e.textContent = text; return e; }
function drawChart() {
  const host = $('chart'); host.replaceChildren();
  const usable = rows.filter(d => d.totalTokens !== null);
  if (!usable.length) { host.append(element('div', '尚无可汇总的用量数据', 'empty')); return; }
  const svg = svgNode('svg', { viewBox: '0 0 720 225', role: 'img', 'aria-label': '每日输入、缓存和输出 Token 柱形图' });
  const max = Math.max(...usable.map(d => d.totalTokens), 1), left = 52, width = 650, top = 15, height = 170;
  for (let i = 0; i <= 4; i++) { const y = top + height * i / 4; svg.append(svgNode('line', { x1: left, y1: y, x2: 710, y2: y })); svg.append(svgNode('text', { x: left - 9, y: y + 3, 'text-anchor': 'end' }, short(max * (1 - i / 4)))); }
  const w = width / Math.max(rows.length, 1), barWidth = Math.max(w * .65, .4);
  rows.forEach((d, i) => {
    const g = svgNode('g', { class: 'bar', tabindex: '0', role: 'button', 'aria-label': `${d.date}: ${number(d.totalTokens)} Token, ${coverage(d)}` });
    const desc = `${d.date} · ${short(d.totalTokens)} Token（${number(d.totalTokens)}） · ${money(d.estimatedCostUSD)} · 覆盖 ${coverage(d)}`;
    g.append(svgNode('title', {}, desc));
    let y = top + height;
    for (const [value, color] of [[d.inputTokens, '#355e5d'], [d.cacheReadTokens === null ? null : d.cacheReadTokens + d.cacheCreationTokens, '#58b59e'], [d.outputTokens, '#bedbd1']]) {
      const h = value === null ? 0 : value / max * height; y -= h;
      g.append(svgNode('rect', { x: left + i * w + (w - barWidth) / 2, y, width: barWidth, height: Math.max(0, h), fill: color, rx: Math.min(2, barWidth / 4) }));
    }
    if (d.totalTokens === null || d.totalTokens === 0) g.append(svgNode('rect', { x: left + i * w, y: top + height - 2, width: Math.max(w - 1, 1), height: 2, fill: d.totalTokens === null ? '#dae3de' : '#58b59e' }));
    const detail = () => { $('chart-detail').textContent = desc; };
    g.addEventListener('mouseenter', detail); g.addEventListener('click', detail); g.addEventListener('focus', detail); svg.append(g);
    const every = Math.max(1, Math.ceil(rows.length / 6));
    if (i % every === 0 || i === rows.length - 1) svg.append(svgNode('text', { x: left + i * w + w / 2, y: 211, 'text-anchor': 'middle' }, d.date.slice(5)));
  });
  host.append(svg); $('chart-hint').textContent = `${rows.length} 天`;
}
function drawModels() {
  const list = $('model-list'); list.replaceChildren(); const models = new Map();
  for (const d of rows) for (const [name, m] of Object.entries(d.models)) models.set(name, (models.get(name) || 0) + m.totalTokens);
  const sum = [...models.values()].reduce((a, b) => a + b, 0);
  if (!sum) { list.append(element('div', '暂无模型用量', 'empty')); return; }
  for (const [name, value] of [...models].sort((a, b) => b[1] - a[1])) {
    const row = element('div', undefined, 'model-row'), labels = element('div', undefined, 'labels');
    labels.append(element('span', name), element('span', `${(value / sum * 100).toFixed(1)}% · ${short(value)}`));
    const track = element('div', undefined, 'track'), bar = element('div'); bar.style.width = `${value / sum * 100}%`; track.append(bar); row.append(labels, track); list.append(row);
  }
}
function drawTable() {
  $('daily-rows').replaceChildren(); const ds = [...rows].reverse();
  for (const d of (showAll ? ds : ds.slice(0, 14))) {
    const tr = element('tr');
    const cache = d.cacheReadTokens === null ? null : d.cacheReadTokens + d.cacheCreationTokens;
    tr.append(element('td', d.date));
    for (const value of [d.inputTokens, cache, d.outputTokens, d.totalTokens]) {
      const cell = element('td', short(value)); cell.title = `${number(value)} Token`; tr.append(cell);
    }
    tr.append(element('td', d.estimatedCostUSD === null ? '—' : money(d.estimatedCostUSD).slice(1)));
    const cell = element('td'), tag = element('span', coverage(d) + (d.suspect ? ' 待核对' : d.pricingStatuses.includes('fallback') ? ' 回退估价' : ''), 'tag' + (d.coverage.complete ? '' : d.hasData ? ' warn' : ' muted'));
    cell.append(tag); tr.append(cell); $('daily-rows').append(tr);
  }
  if (!ds.length) { const tr = element('tr'), td = element('td', '所选期间暂无数据'); td.colSpan = 7; tr.append(td); $('daily-rows').append(tr); }
  $('more').hidden = showAll || ds.length <= 14;
  $('table-meta').textContent = `${rows.length} 天 · ${report.views[selected].label} · 缺失保留为空，健康无事件记为 0`;
}
function drawDevices() {
  $('devices').replaceChildren();
  for (const d of report.devices) {
    const card = element('article', undefined, 'device-card'), head = element('div', undefined, 'device-state');
    head.append(element('strong', d.alias), element('span', d.status.state === 'awaiting_first_upload' ? '等待首传' : d.status.state === 'ok' ? '已上报' : '需核对', 'tag' + (d.status.state === 'ok' ? '' : ' warn')));
    card.append(head, element('small', `数据截至 ${d.status.collectedThrough || '—'} · 批次 ${d.status.sequence || '—'}`), element('small', `启用 ${d.activeFrom} · 来源${d.sourceIndependence === 'confirmed' ? '已确认独立' : '待确认'}`)); $('devices').append(card);
  }
}
function setRange(value) {
  range = value; const last = report.until, first = report.views[selected].daily[0]?.date || last;
  $('until').value = last; $('since').value = range === 'all' ? first : [addDays(last, 1 - Number(range)), first].sort().at(-1);
  document.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('active', b.dataset.range === range)); showAll = false; update();
}
$('csv').addEventListener('click', () => {
  const quote = value => '"' + String(/^[=+\-@]/.test(String(value)) ? "'" + value : value ?? '').replaceAll('"', '""') + '"';
  const csv = [['date', 'device', 'input_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'output_tokens', 'total_tokens', 'estimated_cost_usd', 'known_cost_subtotal_usd', 'coverage_received', 'coverage_expected', 'suspect', 'pricing_status'], ...rows.map(d => [d.date, report.views[selected].label, d.inputTokens, d.cacheReadTokens, d.cacheCreationTokens, d.outputTokens, d.totalTokens, d.estimatedCostUSD, d.knownCostSubtotalUSD, d.coverage.received, d.coverage.expected, d.suspect, d.pricingStatuses.join(';')])].map(r => r.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })), a = element('a'); a.href = url; a.download = 'token-usage.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('more').addEventListener('click', () => { showAll = true; drawTable(); });
$('device').addEventListener('change', () => { selected = $('device').value; showAll = false; update(); });
document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => setRange(b.dataset.range)));
for (const name of ['since', 'until']) $(name).addEventListener('change', () => { range = 'custom'; document.querySelectorAll('[data-range]').forEach(b => b.classList.remove('active')); showAll = false; update(); });
try {
  const res = await fetch('./report.json', { cache: 'no-store' }); if (!res.ok) throw new Error('load'); report = await res.json();
  if (report.schemaVersion !== 1) throw new Error('version');
  for (const d of report.devices) { const option = element('option', d.alias); option.value = d.deviceId; $('device').append(option); }
  const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(report.generatedAt));
  $('freshness').textContent = `更新于 ${time} · ${report.devices.length} 台设备 · 截至昨日`;
  $('cutoff').textContent = report.until; $('source-link').href = `https://github.com/neilwong2012/neilwong2012.github.io/commit/${encodeURIComponent(report.sourceCommit)}`;
  drawDevices(); setRange('30');
} catch { $('freshness').textContent = '数据暂不可用'; $('notice').hidden = false; $('notice').textContent = '暂时无法读取汇总数据，请稍后刷新。'; }
