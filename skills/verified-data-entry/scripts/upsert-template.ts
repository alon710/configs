/**
 * upsert-template: validate, apply and verify one researched entity in the app's database.
 *
 * Copy this file into the project's scratch dir (for example .context/verified-data-entry/upsert.ts),
 * edit the three EDIT blocks, and run it from the app's repo root, so Bun loads `.env` and the
 * app's own schema module resolves with the app's dependencies:
 *
 *   bun .context/verified-data-entry/upsert.ts validate <payload.json>   # no database access
 *   bun .context/verified-data-entry/upsert.ts verify   <key>            # does it exist? what is stored?
 *   CONFIRM_DB_HOST=<host> bun .context/verified-data-entry/upsert.ts apply <payload.json>
 *
 * `apply` validates first, prints the target host, refuses production hosts, refuses unless
 * CONFIRM_DB_HOST equals the target host, writes in one transaction, then runs `verify`.
 * It is idempotent: re-running the same payload converges on the same rows.
 */
import { SQL } from 'bun';
import { resolve } from 'node:path';

// ---------------------------------------------------------------- EDIT 1: app schema + target
/** Module (relative to the repo root) exporting the schema the app itself parses this data with. */
const SCHEMA_MODULE: string | null = 'src/features/libraries/schema.ts';
/** Export name. Zod-style `safeParse` and Standard Schema (`~standard`) are both supported. */
const SCHEMA_EXPORT = 'librarySchema';
/** Environment variable holding the connection string. Bun auto-loads `.env` from the cwd. */
const DB_URL_ENV = 'DATABASE_URL';
/** Hosts that must never be written to. PROD_DB_HOSTS (comma-separated) is added at runtime. */
const PROD_HOST_PATTERNS: RegExp[] = [/prod/i];
/** Natural key format, used as the upsert conflict target. */
const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// ---------------------------------------------------------------------------------------------

interface Provenance {
  url: string;
  quote: string;
  note?: string;
  retrieved?: string;
}

interface Payload {
  key: string;
  verified: boolean;
  allowedSourceHosts: string[];
  internal?: string[];
  record: Record<string, unknown>;
  provenance: Record<string, Provenance>;
}

type Db = InstanceType<typeof SQL>;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const join = (path: string, key: string | number) => (path ? `${path}.${key}` : String(key));
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** The value appears in the quote as a whole token, so 1 does not match "10 am". */
function quoteContains(quote: string, value: unknown): boolean {
  if (value === null || typeof value === 'object') return false;
  const needle = norm(String(value)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return needle !== '' && new RegExp(`(^|[^\\p{L}\\p{N}])${needle}($|[^\\p{L}\\p{N}])`, 'u').test(norm(quote));
}

function leaves(value: unknown, path = ''): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.length ? value.flatMap((v, i) => leaves(v, join(path, i))) : [[path, value]];
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    return entries.length ? entries.flatMap(([k, v]) => leaves(v, join(path, k))) : [[path, value]];
  }
  return [[path, value]];
}

/** The most specific listed path that is the leaf itself or one of its ancestors. */
function covering(leaf: string, listed: Iterable<string>): string | undefined {
  let best: string | undefined;
  for (const p of listed) {
    if ((leaf === p || leaf.startsWith(`${p}.`)) && (!best || p.length > best.length)) best = p;
  }
  return best;
}

function hostAllowed(url: string, allowed: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return allowed.some((h) => {
    const suffix = h.toLowerCase().replace(/^\./, '');
    return host === suffix || host.endsWith(`.${suffix}`);
  });
}

/** Paths the app's schema dropped (an error: the UI will never see them) or changed (a warning). */
function compare(input: unknown, parsed: unknown, path: string, out: { removed: string[]; changed: string[]; added: string[] }) {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    if (input.length !== parsed.length) out.changed.push(path || '(root)');
    else input.forEach((v, i) => compare(v, parsed[i], join(path, i), out));
    return;
  }
  if (isObject(input) && isObject(parsed)) {
    for (const k of Object.keys(input)) {
      if (!(k in parsed)) out.removed.push(join(path, k));
      else compare(input[k], parsed[k], join(path, k), out);
    }
    for (const k of Object.keys(parsed)) if (!(k in input)) out.added.push(join(path, k));
    return;
  }
  if (JSON.stringify(input) !== JSON.stringify(parsed)) out.changed.push(path || '(root)');
}

async function parseWithAppSchema(value: unknown): Promise<{ data: unknown } | { issues: unknown[] }> {
  if (!SCHEMA_MODULE) return { data: value };
  const mod = (await import(resolve(process.cwd(), SCHEMA_MODULE))) as Record<string, unknown>;
  const schema = mod[SCHEMA_EXPORT] as
    | { '~standard'?: { validate: (v: unknown) => unknown }; safeParse?: (v: unknown) => unknown }
    | undefined;
  if (!schema) fail(`${SCHEMA_MODULE} has no export "${SCHEMA_EXPORT}"`);
  if (schema['~standard']) {
    const r = (await schema['~standard'].validate(value)) as { value?: unknown; issues?: unknown[] };
    return r.issues ? { issues: [...r.issues] } : { data: r.value };
  }
  if (typeof schema.safeParse === 'function') {
    const r = schema.safeParse(value) as { success: boolean; data?: unknown; error?: { issues: unknown[] } };
    return r.success ? { data: r.data } : { issues: r.error?.issues ?? [] };
  }
  fail(`"${SCHEMA_EXPORT}" has neither safeParse nor ~standard.validate`);
}

async function validate(p: Payload) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!KEY_PATTERN.test(p.key ?? '')) errors.push(`key "${p.key}" does not match ${KEY_PATTERN}`);
  if (typeof p.verified !== 'boolean') errors.push('verified must be true or false');
  if (!isObject(p.record)) fail('record must be an object');
  if (!isObject(p.provenance)) fail('provenance must be an object keyed by record path');
  if (!Array.isArray(p.allowedSourceHosts) || p.allowedSourceHosts.length === 0) {
    errors.push('allowedSourceHosts must list the official domains agreed with the user');
  }

  const parsed = await parseWithAppSchema(p.record);
  if ('issues' in parsed) {
    errors.push(`the app's schema rejects the record:\n${JSON.stringify(parsed.issues, null, 2)}`);
  } else if (SCHEMA_MODULE) {
    const d = { removed: [] as string[], changed: [] as string[], added: [] as string[] };
    compare(p.record, parsed.data, '', d);
    if (d.removed.length) errors.push(`the app's schema drops these paths, so the UI would never show them: ${d.removed.join(', ')}`);
    if (d.changed.length) warnings.push(`the app's schema transforms: ${d.changed.join(', ')}`);
    if (d.added.length) console.log(`  schema defaults fill: ${d.added.join(', ')}`);
  } else {
    warnings.push('SCHEMA_MODULE is null: nothing proves the app can read this record');
  }

  const leafPaths = leaves(p.record);
  const known = new Set(leafPaths.map(([path]) => path));
  for (const [path, entry] of Object.entries(p.provenance)) {
    if (![...known].some((leaf) => leaf === path || leaf.startsWith(`${path}.`))) {
      errors.push(`provenance for "${path}", which is not in the record`);
    }
    if (!entry?.quote?.trim()) errors.push(`provenance "${path}" has no verbatim quote`);
    if (!hostAllowed(entry?.url ?? '', p.allowedSourceHosts ?? [])) {
      errors.push(`provenance "${path}" source is not https on an allowed host: ${entry?.url}`);
    }
  }

  const rows: string[][] = [];
  for (const [path, value] of leafPaths) {
    const shown = JSON.stringify(value);
    if (covering(path, p.internal ?? [])) {
      rows.push([path, shown, 'INTERNAL', '']);
      continue;
    }
    const at = covering(path, Object.keys(p.provenance));
    const entry = at ? p.provenance[at] : undefined;
    let status: string;
    if (!entry) status = value === null ? 'NULL' : 'UNVERIFIED';
    else if (!hostAllowed(entry.url ?? '', p.allowedSourceHosts ?? [])) status = 'OFF-LIST';
    else if (quoteContains(entry.quote, value)) status = 'MATCH';
    else if (entry.note?.trim()) status = 'NORMALIZED';
    else status = 'CHECK';
    rows.push([path, shown, status, entry ? `${entry.url} "${entry.quote}"${entry.note ? ` (${entry.note})` : ''}` : '']);
    if (status === 'CHECK') errors.push(`"${path}" = ${shown} is not in its quote and has no note explaining the conversion`);
    if (status === 'UNVERIFIED' && p.verified) errors.push(`"${path}" has no official source, so verified cannot be true`);
    if (status === 'UNVERIFIED' && !p.verified) warnings.push(`"${path}" is UNVERIFIED and will be stored unverified`);
    if (status === 'NULL') warnings.push(`"${path}" is null: check how the app renders a missing value before storing it`);
  }

  console.log('\n| path | value | status | source |\n|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`);
  console.log('');
  for (const w of warnings) console.log(`! ${w}`);
  if (errors.length) fail(`payload is not valid:\n  - ${errors.join('\n  - ')}`);
  console.log('✓ payload is valid');
}

function connect(): { db: Db; host: string } {
  const url = process.env[DB_URL_ENV];
  if (!url) fail(`${DB_URL_ENV} is not set`);
  const parsed = new URL(url);
  const host = parsed.hostname;
  console.log(`target database: ${host}${parsed.pathname} (from ${DB_URL_ENV})`);
  return { db: new SQL(url), host };
}

function assertWritable(host: string) {
  const extra = (process.env.PROD_DB_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  if (PROD_HOST_PATTERNS.some((re) => re.test(host)) || extra.includes(host)) {
    fail(`${host} looks like production. This script never writes there.`);
  }
  if (PROD_HOST_PATTERNS.length === 0 && extra.length === 0) {
    console.log('! no production host patterns configured; relying only on CONFIRM_DB_HOST');
  }
  if (process.env.CONFIRM_DB_HOST !== host) {
    fail(`refusing to write. Confirm ${host} is the dev database, then re-run with CONFIRM_DB_HOST=${host}`);
  }
}

// ---------------------------------------------------------------- EDIT 2: the idempotent write
// Upsert on natural keys only, never on generated ids. If the scope is a subset of fields, drop
// the other columns from each UPDATE SET list so a fix does not null them. Bind JSON and arrays
// as text and cast in SQL (`::text::jsonb`): a bare `::jsonb` makes some drivers JSON-encode the
// already-encoded string, which stores a string scalar instead of an array.
interface LibraryRecord {
  name: string;
  websiteUrl?: string | null;
  isActive?: boolean;
  hours?: Array<{ weekday: number; opens: string | null; closes: string | null }>;
}

async function upsert(tx: Db, p: Payload) {
  const r = p.record as unknown as LibraryRecord;
  const sources = [...new Set(Object.values(p.provenance).map((e) => e.url))];

  const [row] = (await tx`
    insert into libraries (slug, name, website_url, sources, verified, is_active, updated_at)
    values (${p.key}, ${r.name}, ${r.websiteUrl ?? null}, ${JSON.stringify(sources)}::text::jsonb,
            ${p.verified}, ${r.isActive ?? false}, now())
    on conflict (slug) do update set
      name = excluded.name, website_url = excluded.website_url, sources = excluded.sources,
      verified = excluded.verified, is_active = excluded.is_active, updated_at = now()
    returning id`) as Array<{ id: string }>;
  console.log(`✓ libraries ${p.key} -> ${row.id}`);

  if (r.hours === undefined) return; // not in scope: keep the stored hours as they are
  for (const h of r.hours) {
    await tx`
      insert into library_hours (library_id, weekday, opens, closes)
      values (${row.id}, ${h.weekday}, ${h.opens}, ${h.closes})
      on conflict (library_id, weekday) do update set opens = excluded.opens, closes = excluded.closes`;
  }
  // A fix must also remove rows the source no longer lists, or stale values survive the re-run.
  const keep = `{${r.hours.map((h) => h.weekday).join(',')}}`;
  await tx`delete from library_hours where library_id = ${row.id} and weekday <> all(${keep}::text::int[])`;
  console.log(`  ✓ library_hours: ${r.hours.length} rows`);
}
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------- EDIT 3: read back
async function verify(db: Db, key: string) {
  const rows = await db`
    select l.slug, l.name, l.verified, l.is_active, jsonb_array_length(l.sources) as sources, l.updated_at,
           (select count(*) from library_hours h where h.library_id = l.id)::int as hours
    from libraries l where l.slug = ${key}`;
  console.log(rows.length ? JSON.stringify(rows, null, 2) : `not found: ${key}`);
}
// ---------------------------------------------------------------------------------------------

const [command, argument] = Bun.argv.slice(2);

if (command === 'validate' || command === 'apply') {
  if (!argument) fail(`usage: ${command} <payload.json>`);
  const payload = (await Bun.file(argument).json()) as Payload;
  await validate(payload);
  if (command === 'apply') {
    const { db, host } = connect();
    assertWritable(host);
    await db.begin(async (tx) => upsert(tx as unknown as Db, payload));
    await verify(db, payload.key);
    await db.close();
  }
} else if (command === 'verify') {
  if (!argument) fail('usage: verify <key>');
  const { db } = connect();
  await verify(db, argument);
  await db.close();
} else {
  fail('usage: upsert-template.ts <validate|apply|verify> <payload.json|key>');
}
