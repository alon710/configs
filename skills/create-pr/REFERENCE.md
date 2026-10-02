# Reference

## Release notes

### Find the mechanism

```bash
git ls-files | grep -iE 'changelog|release-?notes|whats-?new|^\.changeset/'
```

Also check `AGENTS.md` / `CONTRIBUTING.md` for a rule. The common shapes are:

- **Changesets** (`.changeset/`): add one changeset file with the bump type and a user-facing summary, using the repo's script or the format of the existing files.
- **Keep a Changelog** (`CHANGELOG.md`): add the line under `## [Unreleased]` in the right group (Added / Changed / Fixed).
- **An in-app "What's New" data file** (JSON, YAML, or TS that a modal or page renders): follow the structure of the existing entries exactly, and find the component that renders it to learn how it orders and dates entries.

### Writing the entry

- Match the format, tone, and language of the existing entries. If users read the product in a language other than English, write the entry in that language. Name screens and buttons the way users see them.
- Leave out file names, ticket ids, and developer jargon.
- Write one item per user-facing change from step 3. If the format has a type, use `feature` for a new capability, `improvement` when something that already existed works better, and `fix` when something was broken.
- Give the entry a short headline that states the outcome, if the format has one.

### Entries keyed or dated by day

If entries are keyed by date, or the reader derives an entry's date from its key, take the key from what the default branch already has, never from the branch:

```bash
today=$(date +%F)   # prefix with TZ=<zone> if the project dates entries in a fixed timezone
git show origin/<default>:<entries-file> | grep -o "\"${today}[^\"]*\"" | sort -u   # keys the default branch already used today
```

- No output means the key is `$today`. Otherwise take the next free suffix, such as `$today-1` and `$today-2`, or whatever disambiguation the existing keys use.
- Put the entry where the reader expects the newest one, which is often the first key.
- **Never rename or remove a key that is already on the default branch.** Readers' "seen" state may be stored as a key from this list. If a reader's stored key disappears, that reader can stop being shown new entries.
- **Same-day collision:** if the default branch picks up the same key before this PR merges, renumber this branch's entry to the next free suffix and keep its position. If the key appears in more than one file (say, a data file and a code index), a collision can merge cleanly in one file and conflict only in the other. Fix every file, or one entry will silently point at the other's text.

## What local dev is connected to

Start with `AGENTS.md` / `CLAUDE.md` / the README, which often say outright. Then read the env files the dev script loads. These commands print only names, hosts, and key modes, never a secret value:

```bash
grep -hoE '^[A-Z0-9_]+=' .env* 2>/dev/null | sort -u   # variable names only
grep -hE '^[A-Z0-9_]*(DATABASE|POSTGRES|MYSQL|MONGO|REDIS)[A-Z0-9_]*URL=' .env* 2>/dev/null \
  | sed -nE 's#^([A-Z0-9_]+)="?[a-z0-9+]+://([^@/]*@)?([^/:?"]+).*#\1 -> \3#p'   # database hosts only
grep -hoE '^[A-Z0-9_]+="?(sk|pk|rk)_(live|test)' .env* 2>/dev/null   # live vs test mode, where the provider encodes it
```

- A database host other than `localhost` or a local container is probably shared, and possibly production. Treat it as production unless `AGENTS.md` says it's a disposable branch or test database.
- An email, SMS, or storage provider key that is set at all means real sends and real uploads, unless the provider has a sandbox mode and the key is a sandbox key.
- If the shell exports a variable the app also reads from `.env`, it can silently override the file. Check by name only (`env | cut -d= -f1 | grep -E 'DATABASE|_URL$'`), and start the server with `env -u <NAME>` so the branch uses the repo's config.

## Serving the branch

1. **Find the dev command and port.** Look at the `dev` script in `package.json` (a `--port` / `-p` flag), a `PORT` in `.env`, or the framework default (for example, Next.js 3000 and Vite 5173).
2. **Check who owns the port.** Another worktree's dev server serves different code:
   ```bash
   port=<port>; lsof -nP -iTCP:$port -sTCP:LISTEN -t | head -1 | xargs -I{} lsof -a -p {} -d cwd -Fn | sed -n 's/^n//p'
   ```
   - It prints this worktree's path: reuse `http://localhost:<port>`.
   - It prints nothing: start the repo's dev script in the background.
   - It prints another path: don't touch that server. Start one on the next free port:
     ```bash
     port=$((<port>+1)); while lsof -nP -iTCP:$port -sTCP:LISTEN -t >/dev/null; do port=$((port+1)); done; echo $port
     ```
3. **Starting on a non-default port:**
   - If the auth library trusts only a configured base URL as an origin (such as `BETTER_AUTH_URL`, `NEXTAUTH_URL`, or `AUTH_URL`), override it, and the public app-URL variable, with the new port. Otherwise logging in fails. Localhost cookies ignore the port, so a login made on the default port carries over.
   - Run the framework's local binary with its port flag, for example `./node_modules/.bin/next dev --port $port` or `./node_modules/.bin/vite --port $port`, run in the background. For a long-running server, prefer the local binary over `bunx` / `npx`. A package-runner wrapper has been seen exiting 0 right after its first request.
4. **One server per directory.** Some frameworks refuse a second dev server in the same directory. Next.js, for example, prints `Another next dev server is already running`. When that happens, reuse the URL it prints, which may be on another port.
5. **Wait for it to be ready**, then `curl` any route once and confirm the server is still listening before you open the browser.
