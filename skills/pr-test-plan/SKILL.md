---
name: pr-test-plan
description: Builds and runs dry-run-first, effect-labeled test plans for a pull request (local checks, browser QA, database inspection, reversible fixtures, scheduled-job triggers, email, payments, and third-party APIs) from a git-ignored session directory. Every step declares its filesystem, database, and external effects before it runs. Writes need a per-step confirmation and a dedicated test database. Use when asked to test a PR or branch end to end, prepare a QA or debug session, explain what each test command will change before running it, create throwaway test scripts that must stay out of git, or work through test failures safely.
---

# PR Test Plan

Turn a PR into a reviewed, reproducible test session that states every side effect before it happens.

The helpers are `<skill-dir>/scripts/init-session.ts` and `<skill-dir>/scripts/run-plan.ts`, where `<skill-dir>` is the directory this file is in. Run them from the repository root with `bun`, `npx tsx`, or Node 22.18+ (`node <file>`). They use only erasable TypeScript syntax and `node:` modules. They need `git`, and `gh` for default-branch detection.

## Safety contract

1. Before planning, read the repo's agent guide (`AGENTS.md`, `CLAUDE.md`, or equivalent), the PR body and diff, and the code paths the diff touches.
2. Keep generated plans, snapshots, logs, and PR-specific scripts in a git-ignored session directory (default `.context/pr-tests/<slug>/`). `init-session.ts` creates the directory only after `git check-ignore` confirms it is ignored. This matters even more when hooks or editor tooling auto-stage files, because an un-ignored scratch script can end up in a commit.
3. Never put secret values in commands, plan files, output, screenshots, or notes. Refer to environment variables by name only.
4. Every step defaults to a dry run. `run-plan.ts run <id>` prints the step and stops. It executes only with `--execute`. Database and external writes also need `--confirm EXECUTE:<step-id>`.
5. Every step that touches a database lists `TEST_DATABASE_URL` in `requiredEnv`. The runner refuses the step without it and removes `DATABASE_URL` from the child environment. Identify the database before doing anything, target explicit record IDs, and snapshot rows before a reversible write.
6. Label each kind of effect separately: filesystem, database, network, messages (email, SMS, push), payments, vouchers or credits, webhooks, and other third-party state.
7. Treat these as irreversible even when a sandbox offers a compensating action: sent messages, payments, voucher or credit issuance, webhook delivery, and destructive data changes.
8. Some aggregate CI scripts mutate files (formatters with `--write`, `lint --fix`, comment strippers, codegen). If the repo's does, don't run it in an exploratory session. Read its definition and run its read-only checks one by one.

## Discover the project

Find these at runtime. Don't assume them.

- **Package manager**, from the lockfile: `bun.lock`/`bun.lockb` means bun, `pnpm-lock.yaml` means pnpm, `yarn.lock` means yarn, and `package-lock.json` means npm. Run scripts as `<pm> run <script>`. With Bun, bare `bun test`, `bun build`, and `bun ci` run Bun built-ins, not the package.json scripts of the same name.
- **Default branch**: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`. The diff base is `origin/<branch>` unless the user names another one.
- **Checks**: the `package.json` scripts (or Makefile/justfile targets) for typecheck, lint, unit, integration, and e2e. Note which ones write files.
- **Database wiring**: the variable the app reads (`DATABASE_URL`, `POSTGRES_URL`, ...) and whether the runtime auto-loads `.env` files (Bun, Next.js, Vite, and dotenv all do). Removing a variable from the environment does not stop a `.env` loader from filling it back in. Set it explicitly from `TEST_DATABASE_URL` in the step command, and add any other names to the plan's `stripEnv`.
- **Side-effect surfaces**: scheduled jobs and cron routes, webhooks, and email, SMS, and payment providers. For each one, check for a recipient allowlist, sandbox mode, or dry-run flag.

## Workflow

1. Fetch, then inspect the diff with `git fetch origin` and `git diff <base>...HEAD`.
2. Map each changed behavior to automated, browser, database, and integration checks, including regressions and negative paths.
3. Scaffold an ignored session:
   ```bash
   bun <skill-dir>/scripts/init-session.ts <pr-or-branch-slug> [--base origin/<branch>] [--root <ignored-dir>]
   ```
4. Replace the template step with exact commands, prerequisites, expected results, effects, rollback limits, and required environment variable names. See [REFERENCE.md](REFERENCE.md) for the plan format, effect vocabulary, and write-step design.
5. Validate and review without executing anything:
   ```bash
   bun <skill-dir>/scripts/run-plan.ts <session>/plan.json list
   bun <skill-dir>/scripts/run-plan.ts <session>/plan.json show <step-id>
   bun <skill-dir>/scripts/run-plan.ts <session>/plan.json run <step-id>
   ```
6. Execute the smallest step first, one at a time, and only after the user has reviewed that step's displayed effects:
   ```bash
   bun <skill-dir>/scripts/run-plan.ts <plan> run <step-id> --execute
   bun <skill-dir>/scripts/run-plan.ts <plan> run <write-step> --execute --confirm EXECUTE:<write-step>
   ```
7. Record actual versus expected results in the session log. When a step fails, inspect the evidence and change only the in-scope fixture, session script, or application fix. Rerun the smallest failed step before widening scope.
8. Finish with:
   - a passed/failed/skipped table
   - the external artifacts created
   - the exact database rows changed
   - the rollback status
   - any remaining blockers

## Review checklist

- Every user-facing change in the PR has a manual QA row.
- Every write has a bounded target, a preflight query, a confirmation, an expected row count, and a rollback or irreversibility statement.
- A scheduled job processes all due work, not just your fixture. Before triggering one, prove its full audience, including stale work the engine reclaims on its own (for example, rows stuck in `processing`). No unrelated due work may be claimed.
- Session scripts allowlist test recipients by exact address and refuse anyone else.
- Read-only third-party preflights pass before any external write.
- Generated files are git-ignored. Only reusable tooling belongs in git.
