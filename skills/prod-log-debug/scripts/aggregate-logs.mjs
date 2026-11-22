#!/usr/bin/env node
// Aggregate production logs into ranked issues: top normalized messages and top routes.
// Reads any provider's output: JSON Lines (Vercel, Fly, Loki, ...), a JSON array or API
// response (Cloud Logging, CloudWatch, Datadog, Sentry, ...), pretty-printed JSON objects
// back to back (wrangler tail), or plain-text lines (Heroku, kubectl, docker compose, ...).
//
// Usage: node aggregate-logs.mjs [options] <file> [<file> ...]     ("-" reads stdin)
//   --errors          keep only error/fatal entries and 5xx responses
//   --level <l,...>   keep entries at these levels: error, warn, info, debug
//   --status <s,...>  keep entries with these HTTP statuses: 5xx, 4xx, 404, ...
//                     (with several filters, an entry is kept if it matches any of them)
//   --by <f,...>      extra breakdowns: level, status, deploy, service, or a field path (a.b.c)
//   --count <field>   add up this numeric field instead of counting entries (pre-grouped rows)
//   --top <n>         rows per section (default 15)
//   --limit <n>       the fetch limit you used; flags a likely flood when reached (default 1000, 0 = off)
import { readFileSync } from 'node:fs';

// ---------- options ----------
const usage = code => {
  const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1); // the header comment
  const help = lines.slice(0, lines.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, ''));
  (code ? console.error : console.log)(help.join('\n'));
  process.exit(code);
};
const die = msg => {
  console.error(`aggregate-logs: ${msg}`);
  process.exit(1);
};
const list = v => String(v).split(',').map(s => s.trim()).filter(Boolean);

const opts = { errors: false, levels: [], statuses: [], by: [], count: null, top: 15, limit: 1000 };
const files = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => (i + 1 < argv.length ? argv[++i] : die(`missing value for ${a}`));
  if (a === '-h' || a === '--help') usage(0);
  else if (a === '--errors') opts.errors = true;
  else if (a === '--level') opts.levels.push(...list(val()).map(l => l.toLowerCase()));
  else if (a === '--status') opts.statuses.push(...list(val()).map(s => s.toLowerCase()));
  else if (a === '--by') opts.by.push(...list(val()));
  else if (a === '--count') opts.count = val();
  else if (a === '--top') opts.top = Number(val()) || 15;
  else if (a === '--limit') opts.limit = Number(val()) || 0;
  else if (a.startsWith('--')) die(`unknown option ${a} (see --help)`);
  else files.push(a);
}
if (!files.length) usage(1);

// ---------- field lookup ----------
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v));
const nonEmptyStr = v => typeof v === 'string' && v.trim() !== '';

// Wrappers that hold the real fields: Cloud Logging, Datadog, ECS/Elastic, Axiom, ...
const scopes = o => [o, o.jsonPayload, o.attributes, o.attributes?.attributes, o.fields, o._source, o.payload, o.data].filter(isObj);

function getPath(o, path) {
  if (!isObj(o)) return undefined;
  if (Object.hasOwn(o, path)) return o[path]; // flat dotted keys ("http.status_code")
  let cur = o;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}
function pick(o, paths, ok) {
  const sc = scopes(o);
  for (const p of paths) for (const s of sc) {
    const v = getPath(s, p);
    if (v !== undefined && v !== null && v !== '' && ok(v, p)) return { v, p };
  }
  return null;
}

const MSG_PATHS = [
  'message', 'msg', 'textPayload', 'errorMessage', 'error.message', 'err.message', 'exception.message',
  'exception.values.0.value', 'title', 'metadata.value', 'protoPayload.status.message',
  'error', 'err', 'exception', 'event', 'text', 'body', 'log', 'line', 'MESSAGE', '@message', '_raw',
];
// Fields that carry a whole raw log line, which may hold its own timestamp, level or JSON.
const RAW_KEYS = new Set(['textPayload', 'log', 'line', 'MESSAGE', '@message', '_raw']);
const LEVEL_PATHS = [
  'level', 'severity', 'levelname', 'log.level', 'lvl', 'loglevel', 'log_level', '@level',
  'severityText', 'SeverityText', 'severityNumber', 'SeverityNumber', 'PRIORITY', 'status', 'at',
];
const STATUS_PATHS = [
  'statusCode', 'status_code', 'responseStatusCode', 'httpStatus', 'status', 'http.status_code',
  'http.response.status_code', 'httpRequest.status', 'res.statusCode', 'response.status',
  'response.statusCode', 'proxy.statusCode', 'event.response.status', 'elb_status_code',
];
const METHOD_PATHS = [
  'requestMethod', 'method', 'httpMethod', 'http.method', 'http.request.method', 'httpRequest.requestMethod',
  'req.method', 'request.method', 'event.request.method', 'proxy.method',
];
const PATH_PATHS = [
  'requestPath', 'path', 'route', 'http.route', 'http.target', 'url.path', 'http.url_details.path', 'http.url',
  'url', 'requestUrl', 'httpRequest.requestUrl', 'req.url', 'request.path', 'request.url', 'event.request.url', 'proxy.path',
];
const TS_PATHS = [
  'timestamp', 'time', 'ts', '@timestamp', 'eventTimestamp', 'datetime', 'date', '_time', 'dt',
  'Timestamp', '__REALTIME_TIMESTAMP', 'receiveTimestamp', 'lastSeen', 'createdAt',
];
const DEPLOY_PATHS = [
  'deploymentId', 'deployment_id', 'deployment', 'version', 'service.version', 'dd.version', 'release',
  'revision', 'resource.labels.revision_name', 'resource.labels.version_id', 'scriptVersion.id',
  'commit', 'commitSha', 'gitSha', 'git_sha', 'sha', 'image',
];
const SERVICE_PATHS = [
  'service', 'serviceName', 'service.name', 'resource.labels.service_name', 'resource.labels.function_name',
  'resource.labels.module_id', 'resource.labels.container_name', 'kubernetes.container_name', 'container_name',
  'fly.app.name', 'scriptName', 'logStreamName', '@logStream', 'app', 'source', 'logName',
];

const URL_ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

// ---------- levels, statuses, timestamps ----------
const LEVELS = {
  error: ['error', 'err', 'fatal', 'critical', 'crit', 'alert', 'emerg', 'emergency', 'panic', 'severe', 'exception'],
  warn: ['warn', 'warning'],
  info: ['info', 'information', 'informational', 'notice', 'log', 'default'],
  debug: ['debug', 'trace', 'verbose', 'fine', 'finer', 'finest'],
};
const LEVEL_OF = Object.fromEntries(Object.entries(LEVELS).flatMap(([k, ws]) => ws.map(w => [w, k])));

function canonLevel(v, key = '') {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    const k = key.toLowerCase();
    if (k === 'severitynumber') return n >= 17 ? 'error' : n >= 13 ? 'warn' : n >= 9 ? 'info' : 'debug'; // OpenTelemetry
    if (k !== 'level' && k !== 'lvl' && k !== 'priority') return null; // e.g. an HTTP `status`
    if (n >= 10) return n >= 50 ? 'error' : n >= 40 ? 'warn' : n >= 30 ? 'info' : 'debug'; // pino / bunyan
    return n <= 3 ? 'error' : n === 4 ? 'warn' : n <= 6 ? 'info' : 'debug'; // syslog / journald
  }
  return LEVEL_OF[String(v).toLowerCase().replace(/[^a-z]/g, '')] || null;
}

function toStatus(v) {
  const n = typeof v === 'number' ? v : /^\d{3}$/.test(String(v).trim()) ? Number(v) : NaN;
  return n >= 100 && n <= 599 ? n : null;
}

function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) {
    let n = Number(v);
    if (n < 1e11) n *= 1000; // seconds
    else if (n > 1e17) n /= 1e6; // nanoseconds
    else if (n > 1e14) n /= 1e3; // microseconds
    return Number.isFinite(n) ? n : null;
  }
  let s = String(v).trim().replace(/ UTC$/, 'Z').replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2').replace(/(:\d{2}),(\d+)/, '$1.$2');
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(s)) s += 'Z'; // no zone: assume UTC, as servers log
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// ---------- message normalization ----------
const TS = String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?`;
// Collapse ids, numbers, uuids, hex and timestamps so distinct-but-same errors land in one bucket.
const norm = s =>
  str(s)
    .replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, '<uuid>')
    .replace(new RegExp(TS, 'g'), '<ts>')
    .replace(/(?<![A-Za-z0-9])0x[0-9a-f]+(?![A-Za-z0-9])/gi, '<hex>')
    .replace(/(?<![A-Za-z0-9])[0-9a-f]{8,}(?![A-Za-z0-9])/gi, t => (/\d/.test(t) && /[a-f]/i.test(t) ? '<hex>' : t))
    .replace(/(?<![A-Za-z0-9])[A-Za-z0-9]{16,}(?![A-Za-z0-9])/g, t => (/\d[A-Za-z]+\d/.test(t) ? '<id>' : t))
    .replace(/(?<![A-Za-z0-9])[A-Z]{1,4}\d{1,5}(?![A-Za-z0-9])|\d+/g, t => (/^[A-Z]/.test(t) ? t : 'N')) // keep codes: H12, P2002
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '(empty)';

// ---------- plain-text lines ----------
const LEVEL_TOKEN =
  /^(?:\[(\w+)\]|\((\w+)\)|<(\w+)>|(FATAL|PANIC|CRITICAL|CRIT|ERROR|ERR|WARNING|WARN|INFO|NOTICE|DEBUG|TRACE)(?![\w-]))(?::\s*|\s+-\s+|\s+|$)/;
const LOGFMT = /^(?:[\w.@-]+=(?:"(?:[^"\\]|\\.)*"|[^\s"]*)(?:\s+|$)){2,}$/;

function parseLogfmt(s) {
  const o = {};
  for (const [, k, v] of s.matchAll(/([\w.@-]+)=("(?:[^"\\]|\\.)*"|[^\s"]*)/g)) {
    try {
      o[k] = v.startsWith('"') ? JSON.parse(v) : v;
    } catch {
      o[k] = v.slice(1, -1);
    }
  }
  return o;
}

// Strip transport prefixes (docker compose, kubectl --prefix, timestamps, syslog, Heroku/Fly
// source tags, Lambda request ids, level tokens) and find embedded JSON or logfmt.
// Prefixes are read from the first line only; a multi-line message keeps its other lines.
function parseText(input) {
  const nl = input.indexOf('\n');
  const tail = nl < 0 ? '' : input.slice(nl);
  const r = { ts: null, level: null, source: null, rest: nl < 0 ? input : input.slice(0, nl), obj: null, prefix: '' };
  let m;
  if ((m = r.rest.match(/^([A-Za-z0-9][\w.-]*)\s+\| ?(.*)$/))) [, r.source, r.rest] = m; // "web-1  | ..."
  else if ((m = r.rest.match(/^\[([^\]\s]+\/[^\]\s]+)\] (.*)$/))) [, r.source, r.rest] = m; // "[pod/x/c] ..."
  if ((m = r.rest.match(new RegExp(String.raw`^\[?(${TS}(?: UTC)?)\]?[ \t]?(.*)$`)))) [, r.ts, r.rest] = m;
  else if ((m = r.rest.match(/^[A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \S+ ([^\s:]+): (.*)$/))) [, r.source, r.rest] = m; // syslog
  if ((m = r.rest.match(/^([\w-]+\[[^\]]+\]):? (.*)$/))) {
    // Heroku "app[web.1]: ...", "heroku[router]: ...", Fly "app[id] iad [info] ..."
    r.source = r.source || m[1];
    r.rest = m[2];
    if ((m = r.rest.match(/^[a-z]{3} +\[(\w+)\] ?(.*)$/))) [, r.level, r.rest] = m;
  }
  r.indented = /^[ \t]+\S/.test(r.rest); // a stack-trace line under the previous entry
  if (r.indented) {
    r.rest += tail;
    return r;
  }
  if ((m = r.rest.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s+(.*)$/i))) r.rest = m[1]; // Lambda
  if ((m = r.rest.match(/^\[\d+\]\s+(.*)$/))) r.rest = m[1]; // "[pid] ERROR: ..." (Postgres)
  if (!r.level && (m = r.rest.match(LEVEL_TOKEN))) {
    const w = m[1] || m[2] || m[3] || m[4];
    if (canonLevel(w)) {
      r.level = w;
      r.rest = r.rest.slice(m[0].length);
    }
  }
  r.rest = (r.rest + tail).trimEnd();
  const brace = r.rest.indexOf('{');
  if (brace >= 0 && r.rest.endsWith('}')) {
    try {
      const o = JSON.parse(r.rest.slice(brace));
      if (isObj(o)) [r.obj, r.prefix] = [o, r.rest.slice(0, brace).trim()];
    } catch {}
  }
  if (!r.obj && LOGFMT.test(r.rest)) r.obj = parseLogfmt(r.rest);
  return r;
}

// ---------- JSON entries ----------
function levelOf(o) {
  for (const p of LEVEL_PATHS) for (const s of scopes(o)) {
    const v = getPath(s, p);
    const key = p.split('.').pop();
    const l = v == null || isObj(v) ? null : canonLevel(v, key);
    if (l) return l;
    if (typeof v === 'string' && v && p !== 'status' && p !== 'at') return v.toLowerCase();
  }
  if (Array.isArray(o.logs)) {
    // wrangler tail / Vercel: the worst level among the entry's own log lines
    const ls = o.logs.map(x => (isObj(x) ? canonLevel(x.level) : null));
    for (const l of ['error', 'warn', 'info', 'debug']) if (ls.includes(l)) return l;
  }
  return null;
}

function fromObject(o, depth = 0) {
  // Vercel CLI typed lines: {"type":"log","data":{...}}, ending with a summary line
  if (typeof o.type === 'string' && !('message' in o)) {
    if (o.type === 'summary') return null;
    if (isObj(o.data)) o = o.data;
  }
  const ev = { msg: '', level: null, status: null, method: '', path: '', ts: null, obj: o, trace: [] };

  // Vercel: `message`, else the entry's `logs[]`; wrangler: `exceptions[]`
  let msg = str(o.message);
  let raw = 'ingestionTime' in o || 'logStreamName' in o; // CloudWatch events carry the raw line in `message`
  if (!msg || msg === '(no message)') {
    if (Array.isArray(o.exceptions) && o.exceptions.length) {
      msg = o.exceptions.map(e => (isObj(e) ? [e.name, e.message].filter(Boolean).join(': ') : str(e))).join(' ').trim();
    } else if (Array.isArray(o.logs)) {
      msg = o.logs
        .map(x => (isObj(x) ? (Array.isArray(x.message) ? x.message.map(str).join(' ') : str(x.message || x.text || '')) : str(x)))
        .join(' ')
        .trim();
    }
  }
  if (!msg && nonEmptyStr(o.errorType) && nonEmptyStr(o.errorMessage)) msg = `${o.errorType}: ${o.errorMessage}`; // Lambda
  if (!msg) {
    const hit = pick(o, MSG_PATHS, nonEmptyStr);
    if (hit) [msg, raw] = [hit.v, RAW_KEYS.has(hit.p)];
  }
  if (!msg && nonEmptyStr(o.desc)) msg = [o.code, o.desc].filter(nonEmptyStr).join(' '); // Heroku router: H12 Request timeout
  ev.msg = msg;

  ev.level = levelOf(o);
  if (o.outcome && o.outcome !== 'ok') ev.level = 'error'; // wrangler: exception, exceededCpu, ...
  ev.status = toStatus(pick(o, STATUS_PATHS, v => toStatus(v) != null)?.v);
  ev.method = str(pick(o, METHOD_PATHS, nonEmptyStr)?.v);
  const url = str(pick(o, PATH_PATHS, nonEmptyStr)?.v);
  ev.path = url.replace(URL_ORIGIN, '') || (URL_ORIGIN.test(url) ? '/' : ''); // full URLs keep only the path
  if (!ev.msg && !('message' in o) && ev.status != null) ev.msg = ev.key = `HTTP ${ev.status}`; // request logs (Cloud Run, CDN): no message
  const t = pick(o, TS_PATHS, v => toMs(v) != null);
  ev.ts = t ? toMs(t.v) : null;
  ev.errorShape = ['exceptions', 'exception', 'err', 'error', 'stack', 'errorType'].some(k => {
    const v = o[k];
    return Array.isArray(v) ? v.length > 0 : v != null && v !== '' && v !== false;
  });

  // A message that is itself a log line or a JSON object: parse it and fill in what's missing.
  if (depth < 2 && typeof msg === 'string') {
    const trimmed = msg.trim();
    let inner = null;
    if (raw) {
      const p = parseText(trimmed);
      if (p.obj) inner = fromObject(p.obj, depth + 1);
      if (inner && !inner.msg) inner.msg = p.prefix || p.rest;
      if (!inner) {
        ev.msg = p.rest;
        ev.level = ev.level || canonLevel(p.level) || (p.level ? p.level.toLowerCase() : null);
        ev.ts = ev.ts ?? toMs(p.ts);
      } else {
        inner.level = inner.level || canonLevel(p.level);
        inner.ts = inner.ts ?? toMs(p.ts);
      }
    } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const j = JSON.parse(trimmed);
        if (isObj(j)) inner = fromObject(j, depth + 1);
      } catch {}
      if (inner && !inner.msg) inner = null;
    }
    if (inner) {
      for (const k of ['level', 'status', 'ts']) if (inner[k] == null) inner[k] = ev[k];
      for (const k of ['method', 'path']) if (!inner[k]) inner[k] = ev[k];
      inner.errorShape ||= ev.errorShape;
      inner.outer = o;
      return inner;
    }
  }
  return ev;
}

// ---------- reading input ----------
// Find where a JSON value that starts on line i ends (pretty-printed objects, e.g. wrangler tail).
function readMultiline(lines, i) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < lines.length && j < i + 5000; j++) {
    if (j > i && /^[{[]/.test(lines[j]) && depth > 0) return null; // a new value at column 0: line i was broken
    for (const ch of lines[j]) {
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
    }
    if (depth <= 0) {
      try {
        return { value: JSON.parse(lines.slice(i, j + 1).join('\n')), next: j + 1 };
      } catch {
        return null;
      }
    }
  }
  return null;
}

const CONTAINERS = ['events', 'entries', 'results', 'data', 'items', 'records', 'logs', 'hits', 'matches', 'rows', 'messages'];
const ENTRY_KEYS = ['message', 'msg', 'level', 'severity', 'textPayload', 'jsonPayload', 'requestPath', 'timestamp', 'log', 'line'];

// A whole-file JSON document: an array of entries, or an API response that wraps one.
function entriesOf(doc) {
  if (Array.isArray(doc)) return doc;
  if (!isObj(doc) || ENTRY_KEYS.some(k => k in doc)) return [doc];
  for (const k of CONTAINERS) {
    const v = doc[k];
    if (Array.isArray(v)) return v;
    if (isObj(v) && Array.isArray(v.hits)) return v.hits; // Elasticsearch / OpenSearch
  }
  return [doc];
}

// CloudWatch Logs Insights rows: [{field, value}, ...]
const fromFieldList = a =>
  a.every(x => isObj(x) && 'field' in x && 'value' in x) ? Object.fromEntries(a.map(x => [x.field, x.value])) : null;

function eventsFromItem(item, out) {
  if (Array.isArray(item)) {
    const o = fromFieldList(item);
    if (o) return eventsFromItem(o, out);
    for (const x of item) eventsFromItem(x, out);
    return;
  }
  if (isObj(item)) {
    const ev = fromObject(item);
    if (ev) out.push(ev);
  } else if (typeof item === 'string' && item.trim()) out.push(textEvent(parseText(item)));
}

function textEvent(t) {
  if (t.obj) {
    const ev = fromObject(t.obj);
    if (ev) {
      ev.msg = ev.msg || t.prefix || t.rest;
      ev.level = ev.level || canonLevel(t.level);
      ev.ts = ev.ts ?? toMs(t.ts);
      ev.source = t.source;
      return ev;
    }
  }
  const lvl = canonLevel(t.level) || (t.level ? t.level.toLowerCase() : null);
  return { msg: t.rest.trim(), level: lvl, status: null, method: '', path: '', ts: toMs(t.ts), obj: null, source: t.source, trace: [] };
}

function parseFile(text) {
  const out = [];
  const trimmed = text.trim();
  if (!trimmed) return out;
  if (/^[[{]/.test(trimmed)) {
    try {
      for (const e of entriesOf(JSON.parse(trimmed))) eventsFromItem(e, out);
      return out;
    } catch {}
  }
  const lines = text.split(/\r?\n/);
  const openBy = new Map(); // per source: the last text entry, so stack-trace lines attach to it
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t0 = line.trim();
    if (!t0) continue;
    if (t0[0] === '{' || t0[0] === '[') {
      let value;
      try {
        value = JSON.parse(t0);
      } catch {
        const ml = readMultiline(lines, i);
        if (ml) [value, i] = [ml.value, ml.next - 1];
      }
      if (value !== undefined) {
        eventsFromItem(value, out);
        openBy.delete(null);
        continue;
      }
    }
    const t = parseText(line);
    const open = openBy.get(t.source);
    if (open && (t.indented || /^(Caused by:|\^\s*$|\.\.\. \d+ more)/.test(t.rest))) {
      open.trace.push(t.rest.trim());
      continue;
    }
    if (/^Traceback \(most recent call last\):/.test(t.rest)) {
      // right after an error line (logger.exception), the traceback belongs to that line
      if (open && (open.level === 'error' || ERROR_WORDS.test(open.msg))) open.traceback = true;
      else {
        const ev = { ...textEvent(t), level: 'error', traceback: 'pending' };
        out.push(ev);
        openBy.set(t.source, ev);
      }
      continue;
    }
    if (open && open.traceback && !t.obj) {
      // Python: the first unindented line after the frames is the exception itself
      if (open.traceback === 'pending') open.msg = t.rest.trim();
      else open.trace.push(t.rest.trim());
      open.traceback = false;
      continue;
    }
    const ev = textEvent(t);
    out.push(ev);
    if (t.obj) openBy.delete(t.source);
    else openBy.set(t.source, ev);
  }
  return out;
}

// ---------- filters ----------
const ERROR_WORDS = /(error|exception)\b|\b(fatal|panic|traceback|uncaught|unhandled|failed|failure|crash(ed)?|timed out|timeout|killed|oom)\b/i;
const isErrorEvent = ev =>
  ev.level === 'error' ||
  (ev.status != null && ev.status >= 500) ||
  (!ev.level && ev.status == null && (ev.errorShape || ERROR_WORDS.test(`${ev.msg} ${ev.trace.join(' ')}`)));
const statusMatches = (s, pat) => s != null && (/^\dxx$/.test(pat) ? Math.floor(s / 100) === Number(pat[0]) : s === Number(pat));
opts.levels = opts.levels.map(l => canonLevel(l) || l);
const filtered = opts.errors || opts.levels.length || opts.statuses.length;
const keep = ev =>
  !filtered ||
  (opts.errors && isErrorEvent(ev)) ||
  opts.levels.includes(ev.level) ||
  opts.statuses.some(p => statusMatches(ev.status, p));

// ---------- breakdowns ----------
function byValue(ev, name) {
  const objs = [ev.obj, ev.outer].filter(isObj);
  const first = paths => {
    for (const o of objs) {
      const hit = pick(o, paths, v => !isObj(v) && !Array.isArray(v));
      if (hit) return str(hit.v);
    }
    return null;
  };
  if (name === 'level') return ev.level;
  if (name === 'status') return ev.status == null ? null : String(ev.status);
  if (name === 'deploy') return first(DEPLOY_PATHS);
  if (name === 'service') return ev.source || first(SERVICE_PATHS);
  return first([name]);
}

// ---------- main ----------
const all = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f === '-' ? 0 : f, 'utf8');
  } catch (e) {
    die(`cannot read ${f}: ${e.message}`);
  }
  for (const ev of parseFile(text)) all.push(ev); // no spread: large files overflow the call stack
}

const fetched = all.length;
const events = all.filter(keep);
const weight = ev => {
  if (!opts.count) return 1;
  const v = Number(byValue(ev, opts.count));
  return Number.isFinite(v) ? v : 1;
};

const byMsg = new Map();
const byPath = new Map();
const extra = opts.by.map(name => [name, new Map()]);
const bump = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
let total = 0;
let min = Infinity;
let max = -Infinity;
for (const ev of events) {
  const w = weight(ev);
  total += w;
  bump(byMsg, ev.key || norm(ev.msg), w);
  bump(byPath, `${ev.method || ''} ${(ev.path || '').split('?')[0]}`.trim(), w);
  for (const [name, m] of extra) bump(m, byValue(ev, name) ?? '(none)', w);
  if (ev.ts != null) [min, max] = [Math.min(min, ev.ts), Math.max(max, ev.ts)];
}

const top = m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.top);
const pct = n => `${((n / total) * 100).toFixed(1)}%`;
const rows = m => {
  for (const [k, v] of top(m)) console.log(`${String(v).padStart(5)}  ${pct(v).padStart(6)}  ${k}`);
};

if (min !== Infinity) console.log(`window: ${new Date(min).toISOString()} → ${new Date(max).toISOString()}`);
if (filtered) {
  const desc = [opts.errors && '--errors', opts.levels.length && `--level ${opts.levels}`, opts.statuses.length && `--status ${opts.statuses}`];
  console.log(`kept ${events.length} of ${fetched} entries (${desc.filter(Boolean).join(' or ')})`);
}
console.log(`total events: ${total}${opts.limit && fetched >= opts.limit ? '  (hit limit — likely a flood; raise --limit)' : ''}`);

console.log('\n=== TOP ERROR MESSAGES ===');
rows(byMsg);

console.log('\n=== TOP ROUTES (by error events) ===');
rows(byPath);

for (const [name, m] of extra) {
  console.log(`\n=== BY ${name.toUpperCase()} ===`);
  rows(m);
}
