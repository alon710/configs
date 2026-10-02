#!/usr/bin/env node
// Aggregate Vercel `--json` runtime logs into ranked issues.
// Usage: node aggregate-logs.mjs <path-to-jsonl>
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node aggregate-logs.mjs <path-to-jsonl>');
  process.exit(1);
}
const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);

// Normalize a message so distinct-but-same errors collapse into one bucket.
const norm = s =>
  (s || '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, '<uuid>')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '(empty)';

const byMsg = {};
const byPath = {};
const times = [];

for (const line of lines) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    continue;
  }
  let msg = o.message || '';
  if ((!msg || msg === '(no message)') && Array.isArray(o.logs)) {
    msg = o.logs.map(x => x.message || x.text || '').join(' ').trim();
  }
  byMsg[norm(msg)] = (byMsg[norm(msg)] || 0) + 1;
  const p = `${o.requestMethod || ''} ${(o.requestPath || '').split('?')[0]}`.trim();
  byPath[p] = (byPath[p] || 0) + 1;
  if (o.timestamp) times.push(o.timestamp);
}

const total = lines.length;
const top = obj =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
const pct = n => `${((n / total) * 100).toFixed(1)}%`;

if (times.length) {
  const min = Math.min(...times.map(t => new Date(t).getTime()));
  const max = Math.max(...times.map(t => new Date(t).getTime()));
  console.log(`window: ${new Date(min).toISOString()} → ${new Date(max).toISOString()}`);
}
console.log(`total events: ${total}${total >= 1000 ? '  (hit limit — likely a flood; raise --limit)' : ''}`);

console.log('\n=== TOP ERROR MESSAGES ===');
for (const [k, v] of top(byMsg)) console.log(`${String(v).padStart(5)}  ${pct(v).padStart(6)}  ${k}`);

console.log('\n=== TOP ROUTES (by error events) ===');
for (const [k, v] of top(byPath)) console.log(`${String(v).padStart(5)}  ${pct(v).padStart(6)}  ${k}`);
