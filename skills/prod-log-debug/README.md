# prod-log-debug

Pulls your production error logs from whatever hosts the app, ranks the errors, traces the top ones to the code that is actually deployed, and writes a report of the biggest issues with root causes and fixes.

[skills.sh](https://skills.sh/alon710/configs/prod-log-debug) · [SKILL.md](./SKILL.md)

This skill used to be called `vercel-log-debug`.

## Install

```bash
npx skills add alon710/configs -s prod-log-debug -g
```

## When to use it

- "What are the top production errors right now?"
- "Read the Vercel logs and tell me what's breaking."
- "Diagnose yesterday's deployment, errors went up."
- "Write a production error report for the last 24 hours."

## What it does

1. Detects where production runs and where its errors go, from config files, the CI deploy step, env var names (never values), SDKs, CLIs and connected MCP servers.
2. Checks the CLI or API is logged in and on the right account, project and environment.
3. Pulls production error logs for a window (24h by default), or captures a live tail when the provider has no history.
4. Aggregates them with a bundled script that reads any provider's JSON or plain-text logs, collapses ids and numbers, and ranks messages and routes.
5. Checks coverage: 5xx, 4xx, warnings, older slices, platform events, a full stack trace per top issue, and a split by deployment.
6. Finds the deployed commit and traces each top error to source on that commit.
7. Writes a ranked report and offers to fix the top issue.

## Works with

| Kind | Supported |
| --- | --- |
| Hosts | Vercel, Netlify, Cloudflare Workers / Pages, Fly.io, Render, Railway, Heroku, AWS (Lambda, ECS, Beanstalk), Google Cloud (Cloud Run, App Engine, Functions, GKE), Azure (App Service, Container Apps, Functions), Kubernetes, Docker Compose |
| Log / error platforms | Sentry, Datadog, Better Stack, Axiom, Grafana Loki, New Relic, Honeycomb, CloudWatch, Cloud Logging, Azure Monitor |
| Log formats (script) | JSON Lines, JSON arrays and API responses, pretty-printed JSON (wrangler tail), plain text (Heroku, Fly, kubectl, docker compose, Lambda, logfmt, Python tracebacks) |

When there are both a host and an error platform, it reads both. When it can't tell which provider runs production, it asks once with a best guess. For anything else, it asks how to export the logs and runs the same analysis on the export.

## Requirements

- Node.js 18+ for `scripts/aggregate-logs.mjs` (no dependencies).
- The provider's CLI, logged in: `vercel`, `netlify`, `wrangler`, `fly`, `render`, `railway`, `heroku`, `aws`, `gcloud`, `az`, `kubectl`, `docker`, `logcli`, `axiom` or `newrelic`, whichever applies. Or a connected MCP server for the provider.
- For Sentry or Datadog without an MCP server: an API token in the environment (`SENTRY_AUTH_TOKEN`; `DD_API_KEY` and `DD_APP_KEY`).
- `git` with access to `origin`, to read the deployed commit.

## Safety

- Read-only: it never deploys, rolls back, restarts, scales or changes provider settings.
- Prints env var names only, never values, and never prints tokens.
- Keeps raw logs in a temp dir and doesn't copy personal data from log lines into the report.
- Offers the fix for the top issue; it changes code only if you say yes.

## Files

| File | What it holds |
| --- | --- |
| `SKILL.md` | The provider-neutral workflow, detection tables, script options and report structure |
| `REFERENCE.md` | Per-provider commands: access and scope, fetching a window, filters, history vs live tail, finding the deployed commit, gotchas |
| `scripts/aggregate-logs.mjs` | Ranks normalized error messages and routes from any provider's logs; filters by level or status; breaks down by level, status, deployment or service |
