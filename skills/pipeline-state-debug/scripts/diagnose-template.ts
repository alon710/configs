/**
 * Gate-by-gate diagnosis of why one record did or did not pass a pipeline step.
 *
 * Copy this file into a git-ignored directory of the target repo, then replace each `SWAP:` block.
 * The example gates model an invented "trial-ending reminder" job (see REFERENCE.md).
 * Run from the repo root:  env -u DATABASE_URL bun <copy>.ts --help
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// SWAP: KEEP IN SYNC with the engine. List every file whose logic this script mirrors and
// re-read them before trusting a verdict:
//   src/jobs/trial-reminder/audience.ts   conditions, activation anchor, dedup key
//   src/jobs/schedule.ts                  once-per-day gate and its time zone
//   src/jobs/constants.ts                 thresholds

// SWAP: configuration.
const DB_ENV_VAR = 'DATABASE_URL';
const ENV_FILES = ['.env', '.env.local']; // later files override earlier ones
const PROD_HOST_PATTERNS: RegExp[] = []; // e.g. [/prod/i]; writes to a matching host are refused
const BUSINESS_TIME_ZONE = 'UTC'; // the zone the engine uses to decide "already ran today"
const CONSTANTS_MODULE = 'src/jobs/constants.ts';
const JOB_TABLE = 'scheduled_jobs';
const RECORD_TABLE = 'accounts';
const RECORD_LABEL_SQL = 'r.email';

type Row = Record<string, unknown>;
type Query = (text: string, params?: unknown[]) => Promise<Row[]>;
interface Db { host: string; database: string; query: Query; end: () => Promise<void> }
interface Thresholds { reminderDaysBefore: number }
interface Ctx { job: Row; facts: Row; activatedAt: string; now: Date }
interface GateResult { pass: boolean; detail: string }
interface Gate {
  id: string;
  describe: string;
  check: (ctx: Ctx) => GateResult;
  sql?: string; // record predicate over alias `r`; `audience` ANDs these together
  value?: [label: string, sql: string]; // concrete value printed next to the verdict
  hint?: string;
}
interface Args { cmd: string; job?: string; record?: string; activatedAt?: string; limit: number; apply: boolean; confirmHost?: string; mermaid: boolean }

const USAGE = `Usage (run from the repo root):
  env -u ${DB_ENV_VAR} bun diagnose.ts diagnose <job-id-or-key> <record-id-or-email> [--activated-at <iso|now>] [--mermaid]
  env -u ${DB_ENV_VAR} bun diagnose.ts audience <job-id-or-key> [--activated-at <iso|now>] [--limit <n>]
  env -u ${DB_ENV_VAR} bun diagnose.ts reset    <job-id-or-key> <record-id-or-email> [--apply --confirm-host <host>]

diagnose and audience are read-only. reset previews its writes unless given --apply and the exact DB host.`;

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const fmt = (v: unknown): string => (v == null ? 'null' : v instanceof Date ? v.toISOString() : String(v));
const mark = (ok: boolean): string => (ok ? '✅' : '❌');

// Read the files directly instead of process.env, so a stray shell export can't redirect the script.
function readEnvFiles(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of ENV_FILES) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return env;
}

// SWAP: driver. Loaded from the target repo so the skill installs nothing of its own. Use a TCP
// driver: serverless HTTP drivers often fail outside the app and lack transactions.
async function connect(url: string): Promise<Db> {
  const { host, pathname } = new URL(url);
  const database = decodeURIComponent(pathname.slice(1));
  const load = createRequire(resolve(process.cwd(), 'package.json'));
  const missing = (e: unknown) => (e as { code?: string }).code === 'MODULE_NOT_FOUND';
  try {
    const { Client } = load('pg');
    const client = new Client({ connectionString: url });
    await client.connect();
    return { host, database, query: async (t, p) => (await client.query(t, p)).rows, end: () => client.end() };
  } catch (e) {
    if (!missing(e)) throw e;
  }
  try {
    const mod = load('postgres');
    const sql = (mod.default ?? mod)(url, { max: 1 }); // one connection keeps BEGIN/COMMIT together
    return { host, database, query: async (t, p) => [...(await sql.unsafe(t, p ?? []))], end: () => sql.end() };
  } catch (e) {
    if (!missing(e)) throw e;
  }
  fail('neither `pg` nor `postgres` is installed in this repo; add one as a dev dependency or swap connect()');
}

// SWAP: read every threshold from the engine's own constants. Never hardcode a fallback number.
async function loadThresholds(): Promise<Thresholds> {
  const mod = await import(pathToFileURL(resolve(process.cwd(), CONSTANTS_MODULE)).href).catch((e: unknown) =>
    fail(`cannot import ${CONSTANTS_MODULE}: ${e instanceof Error ? e.message : String(e)}`)
  );
  const days = mod.TRIAL_REMINDER_DAYS_BEFORE;
  if (!Number.isInteger(days)) fail(`${CONSTANTS_MODULE} must export TRIAL_REMINDER_DAYS_BEFORE as an integer`);
  return { reminderDaysBefore: days };
}

const sameDay = (a: Date, b: Date): boolean => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, dateStyle: 'short' });
  return f.format(a) === f.format(b);
};

function sqlGate(id: string, describe: string, sql: string, value?: [string, string], hint?: string): Gate {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) fail(`gate id must be snake_case: ${id}`);
  const check = ({ facts }: Ctx): GateResult => ({
    pass: facts[`ok_${id}`] === true,
    detail: value ? `${value[0]}=${fmt(facts[`val_${id}`])}` : '',
  });
  return { id, describe, check, sql, value, hint };
}

// SWAP: the pipeline's gates, in the order the engine applies them. Job-level gates read the job row.
const JOB_GATES: Gate[] = [
  { id: 'job_enabled', describe: 'job is enabled', check: ({ job }) => ({ pass: job.enabled === true, detail: `enabled=${fmt(job.enabled)}` }) },
  { id: 'job_has_content', describe: 'job has rendered content', check: ({ job }) => ({ pass: job.has_content === true, detail: `has_content=${fmt(job.has_content)}` }) },
  {
    id: 'job_due_today',
    describe: `job has not run yet today (${BUSINESS_TIME_ZONE})`,
    check: ({ job, now }) => ({ pass: !job.last_run_at || !sameDay(new Date(job.last_run_at as string | Date), now), detail: `last_run_at=${fmt(job.last_run_at)}` }),
    hint: 'reset clears last_run_at, which re-arms the job for EVERY record',
  },
];

// SWAP: record-level gates as SQL over alias r. Typed params: $1 record id (text), $2 activation
// timestamp (timestamptz), $3 job id (text). Compare ids with ::text casts.
function recordGates({ reminderDaysBefore: days }: Thresholds): Gate[] {
  const anchor = `greatest(r.trial_started_at, r.trial_ends_at - make_interval(days => ${days}))`;
  const sends = `job_sends s where s.job_id::text = $3 and s.account_id = r.id`;
  return [
    sqlGate('not_suppressed', 'email present and not unsubscribed', `coalesce(r.email, '') <> '' and not coalesce(r.unsubscribed, false)`, ['unsubscribed', 'r.unsubscribed']),
    sqlGate('on_trial', 'account is on an active trial', `r.plan = 'trial' and r.trial_ends_at > now()`, ['plan', 'r.plan']),
    sqlGate('in_window', `trial ends within ${days} days`, `r.trial_ends_at <= now() + make_interval(days => ${days})`, ['trial_ends_at', 'r.trial_ends_at']),
    sqlGate('after_activation', 'trigger fired at/after job activation', `${anchor} >= $2`, ['anchor', anchor], 'pre-activation backlog is excluded by design'),
    sqlGate('not_already_sent', "no 'once' dedup row", `not exists (select 1 from ${sends} and s.dedupe_key = 'once')`, ['send_rows', `(select count(*) from ${sends})`], 'reset deletes the dedup row (a write)'),
  ];
}

function factsQuery(gates: Gate[], filter: boolean, limit: number): string {
  const sqlGates = gates.filter(g => g.sql);
  const cols = sqlGates.flatMap(g => [`(${g.sql}) as ok_${g.id}`, ...(g.value ? [`(${g.value[1]}) as val_${g.id}`] : [])]);
  const where = ['($1::text is null or r.id::text = $1)', ...(filter ? sqlGates.map(g => `(${g.sql})`) : [])];
  return `select r.id::text as record_id, (${RECORD_LABEL_SQL})::text as label, count(*) over () as total,
            $2::timestamptz as activated_at, $3::text as job_id, ${cols.join(', ')}
          from ${RECORD_TABLE} r where ${where.join(' and ')} order by r.id limit ${limit}`;
}

function mermaid(title: string, gates: Gate[], results: GateResult[]): string {
  const esc = (s: string) => s.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
  const lines = ['flowchart TD', `  start(["${esc(title)}"]) --> g0`];
  for (const [i, g] of gates.entries()) {
    lines.push(`  g${i}{"${esc(g.describe)}"}`);
    if (!results[i].pass) {
      lines.push(`  g${i} -- no --> blocked["❌ ${esc(g.id)}: ${esc(results[i].detail)}"]`, `  class g${i},blocked fail`);
      break;
    }
    lines.push(`  g${i} -- yes --> ${i + 1 < gates.length ? `g${i + 1}` : 'ok["✅ would run"]'}`);
  }
  lines.push('  classDef fail stroke:#c00,stroke-width:3px');
  return lines.join('\n');
}

function parseArgs(argv: string[]): Args {
  const args: Args = { cmd: 'diagnose', limit: 50, apply: false, mermaid: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--mermaid') args.mermaid = true;
    else if (a === '--activated-at') args.activatedAt = argv[++i];
    else if (a === '--confirm-host') args.confirmHost = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a.startsWith('--')) fail(`unknown flag ${a}`);
    else positional.push(a);
  }
  if (['diagnose', 'audience', 'reset'].includes(positional[0])) args.cmd = positional.shift() as string;
  [args.job, args.record] = positional;
  if (!Number.isInteger(args.limit) || args.limit < 1) fail('--limit must be a positive integer');
  if (args.activatedAt === 'now') args.activatedAt = new Date().toISOString();
  if (args.activatedAt && Number.isNaN(Date.parse(args.activatedAt))) fail(`--activated-at is not a date: ${args.activatedAt}`);
  return args;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.length === 0) {
    console.log(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }
  const args = parseArgs(argv);
  if (!args.job || (args.cmd !== 'audience' && !args.record)) fail(`missing arguments\n${USAGE}`);

  const url = readEnvFiles()[DB_ENV_VAR];
  if (!url) fail(`${DB_ENV_VAR} not found in ${ENV_FILES.join(' / ')}`);
  const db = await connect(url);
  console.log(`DB host: ${db.host}  database: ${db.database}  (confirm this before trusting or writing anything)`);
  try {
    const [job] = await db.query(
      `select id::text as id, key, enabled, activated_at, created_at, last_run_at,
              coalesce(template_html, '') <> '' as has_content
         from ${JOB_TABLE} where id::text = $1 or key = $1`,
      [args.job]
    );
    if (!job) fail(`job "${args.job}" not found`);
    // Mirror the engine's fallback. Enabling usually stamps activated_at = now, which drops the backlog.
    const activatedAt = args.activatedAt ?? fmt(job.activated_at ?? job.created_at);
    const thresholds = await loadThresholds();
    const gates = [...JOB_GATES, ...recordGates(thresholds)];
    console.log(`job ${job.key} [${job.id}] enabled=${fmt(job.enabled)} last_run_at=${fmt(job.last_run_at)}`);
    console.log(`activation used: ${activatedAt}${args.activatedAt ? ' (override)' : ''}   thresholds: ${JSON.stringify(thresholds)}`);
    const now = new Date();

    if (args.cmd === 'audience') {
      const rows = await db.query(factsQuery(gates, true, args.limit), [null, activatedAt, job.id]);
      for (const g of JOB_GATES) {
        const r = g.check({ job, facts: {}, activatedAt, now });
        if (!r.pass) console.log(`NOTE: a live run now does nothing: ${g.id} fails (${r.detail})`);
      }
      console.log(`\nDRY RUN, read-only. Records passing every record gate: ${fmt(rows[0]?.total ?? 0)}`);
      for (const r of rows) console.log(`  -> ${r.record_id}  ${fmt(r.label)}`);
      console.log('\nWithout a recipient allowlist, a live run gives every record above the real effect.');
      return;
    }

    const [record] = await db.query(
      `select r.id::text as id, (${RECORD_LABEL_SQL})::text as label from ${RECORD_TABLE} r
        where r.id::text = $1 or lower(${RECORD_LABEL_SQL}) = lower($1)`,
      [args.record]
    );
    if (!record) fail(`record "${args.record}" not found`);

    if (args.cmd === 'reset') {
      const writes: [string, string, unknown[]][] = [
        ['clear last_run_at (job-wide: the next run processes every due record)', `update ${JOB_TABLE} set last_run_at = null where id::text = $1`, [job.id]],
        ["delete this record's 'once' dedup row", `delete from job_sends where job_id::text = $1 and account_id::text = $2 and dedupe_key = 'once'`, [job.id, record.id]],
      ];
      for (const [what] of writes) console.log(`WRITE: ${what}`);
      if (!args.apply) return void console.log('\nPreview only. activated_at is never touched. Re-run with --apply --confirm-host <host>.');
      if (PROD_HOST_PATTERNS.some(p => p.test(db.host))) fail(`refusing to write: ${db.host} matches PROD_HOST_PATTERNS`);
      if (!PROD_HOST_PATTERNS.length) console.warn('WARN: PROD_HOST_PATTERNS is empty; fill it in so writes can never reach production.');
      if (args.confirmHost !== db.host) fail(`writes need --confirm-host ${db.host} after the user confirms it is a dev database`);
      await db.query('begin');
      try {
        for (const [what, sql, params] of writes) console.log(`done: ${what} (${(await db.query(`${sql} returning 1`, params)).length} row(s))`);
        await db.query('commit');
      } catch (e) {
        await db.query('rollback');
        throw e;
      }
      return;
    }

    const [facts] = await db.query(factsQuery(gates, false, 1), [record.id, activatedAt, job.id]);
    const ctx: Ctx = { job, facts: facts ?? {}, activatedAt, now };
    const results = gates.map(g => {
      try {
        return g.check(ctx);
      } catch (e) {
        return { pass: false, detail: `check threw: ${e instanceof Error ? e.message : String(e)}` };
      }
    });
    console.log(`record ${fmt(record.label)} [${record.id}]\n\n=== GATES (engine order) ===`);
    gates.forEach((g, i) => {
      const r = results[i];
      console.log(`${mark(r.pass)} ${g.id.padEnd(18)} ${g.describe}${r.detail ? `  | ${r.detail}` : ''}${!r.pass && g.hint ? `  -> ${g.hint}` : ''}`);
    });
    const failing = gates.filter((_, i) => !results[i].pass).map(g => g.id);
    console.log(failing.length ? `\n>>> BLOCKED BY: ${failing[0]}${failing.length > 1 ? `  (also failing: ${failing.slice(1).join(', ')})` : ''}` : '\n>>> WOULD RUN for this record on the next job run.');
    if (!failing.length) console.log('Without a recipient allowlist, this is the real effect on a real record once the job is enabled.');
    if (args.mermaid) console.log(`\n${mermaid(`${job.key} / ${fmt(record.label)}`, gates, results)}`);
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
