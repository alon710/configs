# PR test plan reference

## Effect vocabulary

| Risk | Meaning | Examples | Confirmation |
| --- | --- | --- | --- |
| `none` | Reads repository state or computes locally | `git diff`, JSON validation | `--execute` only |
| `local-write` | Writes disposable local output | build output, coverage, screenshots | `--execute` only |
| `db-read` | Connects and runs `SELECT` only | fixture inspection, audience preview | `--execute` only |
| `external-read` | Calls a remote read endpoint | provider item lookup, `gh pr view` | `--execute` only |
| `db-write` | Inserts, updates, or deletes rows | advancing a record's state | `--confirm EXECUTE:<id>` |
| `external-write` | Creates or changes external state | email, voucher, payment, webhook | `--confirm EXECUTE:<id>` |
| `mixed-write` | Writes to the database and to external systems | a scheduled job that updates rows and sends email | `--confirm EXECUTE:<id>` |

A "read-only" database step still opens a connection, and that connection can appear in provider logs. Local checks can write caches even when tracked files stay unchanged.

## Plan format

```json
{
  "version": 1,
  "title": "PR #123 test session",
  "base": "origin/main",
  "sessionLog": ".context/pr-tests/pr-123/session-log.md",
  "stripEnv": ["POSTGRES_URL"],
  "steps": [
    {
      "id": "focused-tests",
      "title": "Run focused tests",
      "risk": "local-write",
      "command": "bun run test tests/path.test.ts",
      "requiredEnv": [],
      "prerequisites": ["Dependencies installed"],
      "effects": {
        "filesystem": "May update test caches; no tracked source writes expected",
        "database": "None",
        "external": "None"
      },
      "expected": ["Test runner exits 0"],
      "rollback": "Delete disposable caches if desired"
    }
  ]
}
```

- Required step fields: `id` (lowercase kebab-case), `title`, `risk`, `command`, `effects` (`filesystem`, `database`, and `external` strings), and `expected`.
- Optional step fields: `requiredEnv`, `prerequisites`, and `rollback`. `rollback` is required for write risks. Write `"Irreversible: <what>"` when nothing can undo the step.
- `stripEnv` (plan-level, optional): extra variable names removed from the child environment of database-risk steps, on top of `DATABASE_URL` and `BASH_ENV`. Use it when the app also reads `POSTGRES_URL`, `PG*`, or similar names.
- Commands run from the repository root through `bash --noprofile --norc -c`, so shell profiles can't re-export what the runner removed. Name the specific external effect in `effects.external`: "1 email to the allowlisted test address", not "email".
- `run-plan.ts` warns when the plan file itself isn't git-ignored.

## Database steps

The runner removes `DATABASE_URL`, but the app's `.env` loader may fill it back in. Point the app at the test database explicitly:

```json
{
  "id": "audience-preview",
  "title": "Preview the job audience on the test database",
  "risk": "db-read",
  "command": "DATABASE_URL=\"$TEST_DATABASE_URL\" bun .context/pr-tests/pr-123/scripts/audience.ts --expect-db app_test",
  "requiredEnv": ["TEST_DATABASE_URL"],
  "effects": { "filesystem": "None", "database": "SELECT only", "external": "None" },
  "expected": ["Prints host and database name", "Lists exactly the 2 fixture accounts"]
}
```

Before a database write:

1. Require `TEST_DATABASE_URL`. Never fall back to `.env` or `DATABASE_URL`.
2. Print the host and `current_database()`. Have the user confirm the exact database name, and make the session script abort when it doesn't match (for example with `--expect-db <name>`).
3. Select the explicit target rows. Refuse unexpected counts or statuses.
4. Save the original values to the session's `snapshots/` directory.
5. Wrap reversible writes in a single transaction on a TCP driver (`pg`, `postgres`, `psql`). Serverless HTTP drivers may not support interactive transactions.
6. Re-read and display the changed rows without exposing sensitive columns.

## Scheduled jobs and external writes

1. Prove the complete audience or work queue first, including stale work the engine reclaims automatically.
2. Refuse any row or recipient the plan doesn't explicitly expect.
3. Run the provider's read-only preflight (credentials check, item lookup, sandbox status).
4. State what can't be rolled back: sent messages, redeemed vouchers, payments, third-party audit records.
5. Trigger the job with its secret read from the environment, and never echo the secret, for example `curl -s -H "Authorization: Bearer $CRON_SECRET" <url>`.
6. Rerun the read-only verification step afterwards.

If the dev server was started before the engine changed, restart it before you trigger anything.

## Debug loop

For each failure, append this to the session log:

```md
## <timestamp> - <step-id>

- Expected:
- Actual:
- Evidence:
- Hypothesis:
- Smallest next command:
- Effects of next command:
- Result:
```

Don't jump from a failed focused check to the full suite. Reproduce the failure, isolate it, fix the code or adjust the fixture, rerun the focused check, and only then move on.

## Session handoff

Report:

- the commit, PR, and base tested
- the commands actually executed, not just planned
- the database identity and the exact rows changed
- external IDs and URLs created, without secret tokens
- messages, vouchers, and payments created
- the rollback performed, or why it is impossible
- failures, and the next safe command
