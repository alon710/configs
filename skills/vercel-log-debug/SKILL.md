---
name: vercel-log-debug
description: Pull Vercel production runtime logs, aggregate the errors, trace them to source, and write a report of the biggest issues with fixes. Use when the user asks to read/debug Vercel production logs, find the most common production errors, diagnose a Vercel deployment, or produce a production error report.
---

# Vercel log debugging

Turn raw Vercel runtime logs into a ranked report: biggest issues → root cause → fix.

Requires the Vercel CLI (`vercel`, or `npx vercel` / `bunx vercel`) and a logged-in account. Examples below use `vercel`.

## Workflow

1. **Verify link & scope.** In the project dir run `vercel ls --prod 2>&1 | head`. If it errors with `Can't find ... under the context "<wrong-team>"`, the CLI is on the wrong scope: run `vercel link` (pick the right team/project) or pass `--scope <team>` on every command. `vercel inspect` in particular defaults to the personal scope and often needs `--scope`.

2. **Pull error logs — ALWAYS pass `--no-branch`.** `vercel logs` silently filters by the *current git branch*. On a feature branch that returns **zero** production logs (message: `No logs found ... on branch <x>`). This is the #1 trap. Fetch expanded JSON into a scratch dir:
   ```bash
   work=$(mktemp -d)
   vercel logs --environment production --no-branch --level error \
     --since 24h --limit 1000 --expand --json 2>/dev/null > "$work/prod_errors.jsonl"
   wc -l "$work/prod_errors.jsonl"
   ```
   Retention is short (recent window only), so `--since 24h` may still return only the last few minutes. That's expected, not an error. If `--limit` is hit fast, one error is flooding.

3. **Aggregate.** Run the bundled script to rank normalized messages and error-heavy routes:
   ```bash
   node <skill-dir>/scripts/aggregate-logs.mjs "$work/prod_errors.jsonl"
   ```

4. **Confirm coverage.** Check nothing else hides: `--status-code 5xx`, `--status-code 4xx`, `--level warning`. Sample older slices with `--until 6h` etc. (usually empty — retention). Grab one full stack trace with `grep -m1 "<msg>" "$work/prod_errors.jsonl"`: the `logs[]` array holds the full multi-line trace. `.next/server/chunks/ssr/...` frames mean SSR or a Server Action (`POST /<page>`).

5. **Trace to source.** `git grep -n "<literal error string>" origin/<default-branch>`. Production runs the default branch, not your branch; confirm via the log entry's `branch` field. Follow imports to find where the failing call is mounted. An auth error (`Forbidden` / `Unauthorized`) thrown inside a server-action wrapper or try/catch that logs and swallows is recorded as an error even when the HTTP response is 200. Those are the usual flood.

6. **Write the report** (structure below) and offer to implement the top fix.

## Report structure

```md
# Vercel production error report — <date>

## Summary
- Window analyzed: <start → end UTC>, <N> error events
- Headline: <one line — e.g. "one error is ~100% of the flood">

## Top issues
### 1. <error> — <count> (<% of errors>)
- **Where:** <routes> · stack top frame
- **Root cause:** <file:line, why it fires>
- **Fix:** <concrete change>
### 2. ...

## Health checks
- 5xx: <n> · 4xx: <n> · warnings: <n>
```

## Useful flags
`--query "status:500 error"` (advanced search) · `--request-id <id>` · `--source serverless|edge-function|edge-middleware` · `--follow` (live stream; on macOS there is no `timeout`, so run it in the background or Ctrl-C).

## Gotchas
- **`--no-branch` or you get nothing.** Restated because it wastes the most time.
- **macOS has no `timeout`.** Don't wrap streaming commands in it.
- **Production = the default branch.** Grep `origin/<default-branch>` for source, not the working branch.
- **Short retention.** Analyze the window you get; don't assume missing older data is a bug.
- **Split by deployment.** If the window spans a deploy, group by the entry's `deploymentId` before blaming the current code.
