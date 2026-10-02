import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const DEFAULT_ROOT = '.context/pr-tests';

function usage(code: number): never {
  console.log(`Usage: init-session.ts <pr-or-branch-slug> [--base <ref>] [--root <dir>]

Creates <root>/<slug>/ with plan.json, GUIDE.md, session-log.md, scripts/ and snapshots/.
  --base  Ref to diff against. Default: origin/<default branch>, detected with gh, then origin/HEAD.
  --root  Session root relative to the repository root. Default: ${DEFAULT_ROOT}.
          It must be git-ignored; the script refuses to create anything otherwise.`);
  process.exit(code);
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function capture(command: string, args: string[], cwd: string): string | undefined {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 15_000 });
  const out = result.stdout?.trim();
  return result.status === 0 && out ? out : undefined;
}

function defaultBase(root: string): string {
  const fromGh = capture('gh', ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'], root);
  if (fromGh) return `origin/${fromGh}`;
  const fromRemoteHead = capture('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root);
  if (fromRemoteHead) return fromRemoteHead;
  console.warn('WARN: could not detect the default branch; using origin/main. Pass --base to override.');
  return 'origin/main';
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) usage(0);

let slug: string | undefined;
let baseArg: string | undefined;
let rootArg = DEFAULT_ROOT;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--base' || arg === '--root') {
    const value = argv[++i];
    if (!value || value.startsWith('--')) fail(`${arg} needs a value`);
    if (arg === '--base') baseArg = value;
    else rootArg = value;
  } else if (arg.startsWith('--')) {
    fail(`unknown option ${arg}`);
  } else if (!slug) {
    slug = arg;
  } else {
    fail(`unexpected argument ${arg}`);
  }
}
if (!slug) usage(1);
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) fail('slug may contain only letters, digits, ".", "_" and "-"');

const repositoryRoot = capture('git', ['rev-parse', '--show-toplevel'], process.cwd());
if (!repositoryRoot) fail('run this command from inside a Git repository');

const sessionRoot = relative(repositoryRoot, resolve(repositoryRoot, rootArg));
if (!sessionRoot || sessionRoot.startsWith('..') || isAbsolute(sessionRoot)) {
  fail(`--root must be a directory inside the repository, got ${rootArg}`);
}

const base = baseArg ?? defaultBase(repositoryRoot);
// The base is interpolated into a shell command in plan.json, so keep it to ref characters.
if (!/^[A-Za-z0-9._/-]+$/.test(base)) fail(`base ref has unexpected characters: ${base}`);

const relativeDirectory = `${sessionRoot}/${slug}`;
const directory = resolve(repositoryRoot, relativeDirectory);
const ignored = spawnSync('git', ['check-ignore', '-q', relativeDirectory], { cwd: repositoryRoot }).status === 0;
if (!ignored) {
  const exclude = capture('git', ['rev-parse', '--git-path', 'info/exclude'], repositoryRoot) ?? '.git/info/exclude';
  fail(
    `git does not ignore ${relativeDirectory}. Add "${sessionRoot}/" to .gitignore, or to ${exclude} for a ` +
      'local-only ignore, then rerun.'
  );
}

mkdirSync(resolve(repositoryRoot, sessionRoot), { recursive: true });
try {
  mkdirSync(directory);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail(`refusing to overwrite existing session ${directory}`);
  throw error;
}
mkdirSync(resolve(directory, 'scripts'));
mkdirSync(resolve(directory, 'snapshots'));

const plan = {
  version: 1,
  title: `${slug} test session`,
  base,
  sessionLog: `${relativeDirectory}/session-log.md`,
  steps: [
    {
      id: 'inspect-scope',
      title: 'Inspect branch scope',
      risk: 'none',
      command: `git status --short --branch && git diff --stat ${base}...HEAD && git diff --name-only ${base}...HEAD`,
      requiredEnv: [],
      prerequisites: [`Run git fetch so ${base} is current before relying on the diff`],
      effects: {
        filesystem: 'None',
        database: 'None',
        external: 'None',
      },
      expected: ['The changed-file list matches the PR scope'],
      rollback: 'None required',
    },
  ],
};

writeFileSync(resolve(directory, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
writeFileSync(
  resolve(directory, 'GUIDE.md'),
  `# ${slug} test guide

## Scope
Base: ${base}. Changed behaviors and the checks that cover each one.

## Prerequisites
Services, accounts, fixtures, and environment variable NAMES (never values).

## Stop conditions
What makes you stop and ask before continuing (unexpected row counts, unknown recipients, wrong database).
`
);
writeFileSync(resolve(directory, 'session-log.md'), `# ${slug} session log\n`);

console.log(`Created ignored session: ${directory}`);
console.log(`Base: ${base}`);
