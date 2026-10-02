---
name: pipeline-state-debug
description: Explains, gate by gate, why one record did or did not move through a pipeline (a scheduled job, automation, notification, reward or payout queue, or status state machine). A read-only diagnose script prints every gate with its concrete values and the first blocking gate, and the answer includes a mermaid flowchart of the record's actual path. Also dry-runs a job's real audience before it is enabled, and drives dev-database state to reproduce a case behind explicit write flags. Use when asked why a user or record did or didn't get an email, reward, payout, or status change, why a cron job or automation did or didn't run for someone, who a job will affect once enabled, or to set up, reset, or advance a record's pipeline state for testing.
---

# Pipeline State Debug

Answer "why did (or didn't) record X get through pipeline Y" from the engine's own logic and real rows, not from guesses. The answer has four parts:

- a gate-by-gate verdict with concrete values
- the first blocking gate
- a mermaid diagram of the record's path
- the fix options

The scaffold is `<skill-dir>/scripts/diagnose-template.ts`, where `<skill-dir>` is the directory this file is in. It is a template. Copy it into a git-ignored directory of the target repo and replace its `SWAP:` blocks. It runs with `bun` or Node 22.18+, and it loads the repo's own `pg` or `postgres` package. Importing the engine's `.ts` constants needs Bun or Node type stripping. Path aliases such as `@/` won't resolve from a script run outside the app.

## Safety rules

1. **Print the target DB host and database name on every run.** Reads may target the database the question is about, if the project allows read access there. Writes run only on a dev or branch database whose host the user has confirmed. Never write to production.
2. **Run with `env -u DATABASE_URL`** (or the repo's own DB variable name) so a stray shell export can't override `.env`. The template reads the env files directly for the same reason.
3. **Reads come first, and writes sit behind an explicit flag.** Every command defaults to a read or a preview. A write needs `--apply` plus `--confirm-host <host>`, runs in one transaction, and prints its row counts.
4. **Adjust thresholds on rows that exist. Never create entities.** Shift timestamps, flags, and counters on existing rows. If a case needs an entity that doesn't exist (a subscription, an order, a completed milestone, child records), print `NEEDS ADMIN: <what to create>`, ask a human to create it through the app's UI, then re-run. A fabricated entity skips the side effects the real flow produces, so the test passes for the wrong reason.
5. **Reset and dedup clearing are writes.** Ask before running them. Scope deletes to exactly the dedup key the gate checks, and keep all other history. Never touch activation timestamps. Say so when a reset is job-wide: clearing a job's last-run marker re-arms it for every due record, not just yours.
6. **Enabling a job means going live.** Without a recipient allowlist, a passing verdict means real users get the real effect once the job is enabled and runs. State this in every answer with a passing verdict. Dry-run the real audience before anything is enabled or triggered.
7. **Activation timestamps exclude the backlog.** Many engines stamp `activated_at = now` when a job is enabled (and again on every re-enable), then act only on triggers at or after that moment. Records whose trigger predates activation are excluded by design, not by a bug. To preview a hypothetical activation, use `--activated-at <iso|now>`.
8. **Read thresholds from the source at run time.** Import the engine's constants, or read its config rows, while the script runs. Never hardcode day counts, amounts, or limits, and never quote a number in an answer without checking it against the source.
9. **Keep the script's SQL in sync with the engine.** List the mirrored source files in a `KEEP IN SYNC` header. Re-read them at the start of each session. If the engine changed, update the script before trusting its verdict.
10. **Never print secrets**: connection strings with passwords, bearer tokens, or provider keys. Print the host only.

## Workflow

1. **Discover.** Read `AGENTS.md` or `CLAUDE.md`. Find the package manager (from the lockfile), the DB env var, and the DB driver. Locate the pipeline: cron routes, job registries, queue workers, status enums, and the dedup or ledger table. Look for an existing debug script for this pipeline (`scripts/`, `.claude/skills/*/scripts/`, or an ignored scratch directory). Reuse one if it still matches the engine.
2. **Map the gates in the order the engine applies them.**
   - Job-level gates: enabled, due, content present, provider configured.
   - Record-level gates: suppression, conditions, activation anchor, hold or maturity time, retry cap.
   - Dedup, then execution: the send or provider call.

   For each gate, record the file:line, the exact predicate, and the constants it reads. [REFERENCE.md](REFERENCE.md) has a catalog of gate kinds and their silent-failure traps.
3. **Diagnose (read-only).** Copy the template to an ignored path, such as `.context/pipeline-debug/<job>/diagnose.ts` (confirm with `git check-ignore`). Fill in the `SWAP:` blocks from step 2, then run:
   ```bash
   env -u DATABASE_URL bun .context/pipeline-debug/<job>/diagnose.ts diagnose <job> <record> --mermaid
   ```
   The script evaluates every gate, not only those before the first failure, so a later failure shows up before you fix the first one. It prints ✅ or ❌ with values and names the first blocking gate.
4. **Answer** with:
   - the verdict and the first blocking gate
   - a mermaid flowchart that marks the record's actual path (`--mermaid` prints one; trim it)
   - a table of gate, concrete value, and pass/fail
   - fix options, each labeled as a data fix, a config fix, or expected behavior

   Restate rule 6 whenever the verdict passes.
5. **Dry-run the audience** before enabling or triggering anything:
   ```bash
   env -u DATABASE_URL bun <copy>.ts audience <job> [--activated-at now]
   ```
   Review the list with the user. `--activated-at now` shows who a fresh enable would reach.
6. **Reproduce (optional; makes writes).** Use a fixture driver to set states, mature hold timers, adjust thresholds, or reset dedup. See the pattern in REFERENCE.md. Each write needs the user's consent, `--apply`, and host confirmation.
7. **Trigger the job locally (optional).** Do this only after the user has reviewed step 5. If engine code changed, restart the dev server first. Call the job's route with its secret read from the env file, without echoing the secret. Check the response summary, then re-run `diagnose` to confirm the new state.

## Done when

- The first blocking gate is named with its concrete values, or every gate passes and the real-effect warning has been stated.
- Every write is listed with its host, the rows it changed, and whether it can be undone.
- Every NEEDS ADMIN item has been handed to the user with what to create and where.

For the mermaid template, the fixture-driver command table, gotchas, and a worked example on an invented domain, see [REFERENCE.md](REFERENCE.md).
