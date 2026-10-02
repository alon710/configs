import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RISKS = ['none', 'local-write', 'db-read', 'external-read', 'db-write', 'external-write', 'mixed-write'] as const;
type Risk = (typeof RISKS)[number];
const DATABASE_RISKS: Risk[] = ['db-read', 'db-write', 'mixed-write'];
const WRITE_RISKS: Risk[] = ['db-write', 'external-write', 'mixed-write'];
// BASH_ENV is sourced by non-interactive bash, so it could re-export a production URL.
const ALWAYS_STRIPPED = ['DATABASE_URL', 'BASH_ENV'];
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface Effects {
  filesystem: string;
  database: string;
  external: string;
}

interface Step {
  id: string;
  title: string;
  risk: Risk;
  command: string;
  requiredEnv: string[];
  prerequisites: string[];
  effects: Effects;
  expected: string[];
  rollback?: string;
}

interface Plan {
  version: 1;
  title: string;
  base?: string;
  sessionLog?: string;
  stripEnv: string[];
  steps: Step[];
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function usage(): never {
  console.log(`Usage: run-plan.ts <plan.json> <list|show|run> [step-id] [--execute] [--confirm EXECUTE:<step-id>]

  list            Print every step with its risk.
  show <id>       Print one step's command, effects, expected results and rollback.
  run <id>        Same as show, then stop (dry run).
  run <id> --execute                              Execute a none/local-write/read step.
  run <id> --execute --confirm EXECUTE:<id>       Execute a db-write/external-write/mixed-write step.

Database-risk steps require TEST_DATABASE_URL and run with DATABASE_URL, BASH_ENV and the
plan's stripEnv names removed from the child environment.`);
  process.exit(0);
}

function capture(command: string, args: string[], cwd: string): { status: number | null; out: string } {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return { status: result.status, out: result.stdout?.trim() ?? '' };
}

function strings(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail(`${field} must be a string array`);
  return value;
}

function envNames(value: unknown, field: string): string[] {
  const names = strings(value, field);
  const bad = names.find(name => !ENV_NAME.test(name));
  if (bad) fail(`${field} has an invalid variable name: ${bad}`);
  return names;
}

function parsePlan(path: string): Plan {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object') fail('plan must be an object');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.title !== 'string' || !Array.isArray(raw.steps)) {
    fail('plan requires version 1, title, and steps');
  }
  const stripEnv = envNames(raw.stripEnv, 'stripEnv');
  if (stripEnv.includes('TEST_DATABASE_URL')) fail('stripEnv must not include TEST_DATABASE_URL');

  const ids = new Set<string>();
  const steps = raw.steps.map((item, index): Step => {
    if (!item || typeof item !== 'object') fail(`steps[${index}] must be an object`);
    const step = item as Record<string, unknown>;
    if (typeof step.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(step.id)) fail(`steps[${index}].id is invalid`);
    if (ids.has(step.id)) fail(`duplicate step id ${step.id}`);
    ids.add(step.id);
    if (typeof step.title !== 'string' || typeof step.command !== 'string') {
      fail(`${step.id} requires title and command`);
    }
    if (typeof step.risk !== 'string' || !RISKS.includes(step.risk as Risk)) fail(`${step.id}.risk is invalid`);
    const risk = step.risk as Risk;
    if (!step.effects || typeof step.effects !== 'object') fail(`${step.id}.effects is required`);
    const effects = step.effects as Record<string, unknown>;
    if (
      typeof effects.filesystem !== 'string' ||
      typeof effects.database !== 'string' ||
      typeof effects.external !== 'string'
    ) {
      fail(`${step.id}.effects requires filesystem, database, and external strings`);
    }
    const requiredEnv = envNames(step.requiredEnv, `${step.id}.requiredEnv`);
    if (DATABASE_RISKS.includes(risk) && !requiredEnv.includes('TEST_DATABASE_URL')) {
      fail(`${step.id}.requiredEnv must include TEST_DATABASE_URL for ${risk} steps`);
    }
    if (step.expected === undefined) fail(`${step.id}.expected is required`);
    if (WRITE_RISKS.includes(risk) && (typeof step.rollback !== 'string' || !step.rollback.trim())) {
      fail(`${step.id}.rollback is required for ${risk} steps (say "Irreversible: ..." when it cannot be undone)`);
    }
    return {
      id: step.id,
      title: step.title,
      risk,
      command: step.command,
      requiredEnv,
      prerequisites: strings(step.prerequisites, `${step.id}.prerequisites`),
      effects: effects as unknown as Effects,
      expected: strings(step.expected, `${step.id}.expected`),
      rollback: typeof step.rollback === 'string' ? step.rollback : undefined,
    };
  });
  return {
    version: 1,
    title: raw.title,
    base: typeof raw.base === 'string' ? raw.base : undefined,
    sessionLog: typeof raw.sessionLog === 'string' ? raw.sessionLog : undefined,
    stripEnv,
    steps,
  };
}

function strippedFor(plan: Plan, step: Step): string[] {
  return DATABASE_RISKS.includes(step.risk) ? [...ALWAYS_STRIPPED, ...plan.stripEnv] : [];
}

function printStep(plan: Plan, step: Step): void {
  console.log(`\n${step.id}: ${step.title}`);
  console.log(`Risk: ${step.risk}`);
  console.log(`Command: ${step.command}`);
  console.log(`Filesystem effect: ${step.effects.filesystem}`);
  console.log(`Database effect: ${step.effects.database}`);
  console.log(`External effect: ${step.effects.external}`);
  if (step.requiredEnv.length) console.log(`Required env names: ${step.requiredEnv.join(', ')}`);
  const stripped = strippedFor(plan, step);
  if (stripped.length) console.log(`Removed from child env: ${stripped.join(', ')}`);
  if (step.prerequisites.length) console.log(`Prerequisites:\n- ${step.prerequisites.join('\n- ')}`);
  console.log(`Expected:\n- ${step.expected.join('\n- ') || 'Not documented'}`);
  if (step.rollback) console.log(`Rollback: ${step.rollback}`);
  if (WRITE_RISKS.includes(step.risk)) console.log(`Confirmation: --execute --confirm EXECUTE:${step.id}`);
}

const argv = process.argv.slice(2);
if (argv.length < 2 || argv.includes('--help')) usage();

const rootResult = capture('git', ['rev-parse', '--show-toplevel'], process.cwd());
if (rootResult.status !== 0 || !rootResult.out) fail('run this command from inside a Git repository');
const repositoryRoot = rootResult.out;
const planPath = resolve(process.cwd(), argv[0]);
const action = argv[1];
const plan = parsePlan(planPath);

if (capture('git', ['check-ignore', '-q', planPath], repositoryRoot).status !== 0) {
  console.warn(`WARN: ${planPath} is not git-ignored. Session plans and scripts belong in an ignored directory.`);
}

if (action === 'list') {
  console.log(plan.title);
  if (plan.base) console.log(`Base: ${plan.base}`);
  for (const step of plan.steps) console.log(`${step.id.padEnd(24)} ${step.risk.padEnd(14)} ${step.title}`);
  process.exit(0);
}

const stepId = argv[2];
if (!stepId || stepId.startsWith('--')) fail(`${action} requires a step id`);
const step = plan.steps.find(candidate => candidate.id === stepId);
if (!step) fail(`unknown step ${stepId}`);
printStep(plan, step);
if (action === 'show') process.exit(0);
if (action !== 'run') fail(`unknown action ${action}`);

if (!argv.includes('--execute')) {
  console.log('\nDRY RUN ONLY: no command executed. Add --execute after reviewing every effect.');
  process.exit(0);
}

const missing = step.requiredEnv.filter(name => !process.env[name]);
if (missing.length) fail(`missing required environment variables: ${missing.join(', ')}`);

if (WRITE_RISKS.includes(step.risk)) {
  const confirmIndex = argv.indexOf('--confirm');
  const confirmation = confirmIndex >= 0 ? argv[confirmIndex + 1] : undefined;
  if (confirmation !== `EXECUTE:${step.id}`) fail(`write step requires --confirm EXECUTE:${step.id}`);
}

console.log('\nEXECUTING');
const childEnvironment = { ...process.env };
for (const name of strippedFor(plan, step)) delete childEnvironment[name];
// --noprofile --norc: shell startup files must not re-export variables the runner removed.
const child = spawnSync('bash', ['--noprofile', '--norc', '-c', step.command], {
  cwd: repositoryRoot,
  env: childEnvironment,
  stdio: 'inherit',
});
if (child.error) fail(`${step.id} could not start: ${child.error.message}`);
const exitCode = child.status ?? 1;
if (exitCode !== 0) fail(`${step.id} exited with code ${exitCode}`);
console.log(`PASS: ${step.id}`);
