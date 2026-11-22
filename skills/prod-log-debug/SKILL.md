---
name: prod-log-debug
description: Pull production error logs from wherever the app runs (Vercel, Netlify, Cloudflare, Fly.io, Render, Railway, Heroku, AWS, Google Cloud, Azure, Kubernetes, Docker) or from its log/error platform (Sentry, Datadog, Better Stack, Axiom, Loki, New Relic and others), aggregate and rank the errors, trace them to the code that is actually deployed, and write a report of the biggest issues with fixes. Use when the user asks to read or debug production logs or Vercel logs, find the top production errors or the most common errors in production, diagnose a deployment, or produce a production error report.
---

# Production log debugging

Turn raw production logs into a ranked report: biggest issues → root cause → fix.

The workflow is the same on every provider. The commands are not: per-provider commands (access, fetching a window, filters, finding the deployed commit, gotchas) are in [REFERENCE.md](./REFERENCE.md). Examples below use `<provider>` placeholders.

**Read-only.** This skill reads logs, provider metadata and code. It never deploys, rolls back, restarts, scales, or changes provider or alert settings. Print env var names only, never their values, and don't copy tokens, emails or other personal data from log lines into the report.

## Workflow

1. **Detect the provider.** Where production runs (the host) and where its errors land (a log or error platform) can differ: an app on Fly.io that reports to Sentry has both. Find both, and stop at the first clear answer:
   - **Repo docs:** `AGENTS.md`, `CLAUDE.md` (or the agent's own instructions file), `README`, `CONTRIBUTING.md`, runbooks.
   - **Config files** (table below).
   - **The deploy workflow in CI.** The deploy step names the host (`vercel deploy`, `netlify deploy`, `wrangler deploy`, `flyctl deploy`, `railway up`, `heroku`, `sam deploy` / `cdk deploy` / `serverless deploy`, `gcloud run deploy` / `gcloud app deploy`, `az webapp` / `az containerapp`, `kubectl apply` / `helm upgrade`, `docker compose up` over ssh).
   - **Env var names** (never values) in `.env*` files, CI config and the shell, and **SDKs** in the package manifest (table below).
   - **Tools in this session:** CLIs on PATH and logged in, and MCP servers connected for a provider (prefer a connected MCP server when it can read logs).

   ```bash
   ls -a | grep -E '^(vercel\.json|\.vercel|netlify\.toml|wrangler\.(toml|json|jsonc)|fly\.toml|render\.yaml|railway\.(json|toml)|app\.yaml|Procfile|serverless\.ya?ml|template\.ya?ml|cdk\.json|azure\.yaml|(docker-)?compose\.ya?ml)$'
   git ls-files | grep -E '(^|/)(Chart\.yaml|kustomization\.ya?ml|helmfile\.ya?ml)$' | head
   git grep -lE '^kind: *(Deployment|StatefulSet)' -- '*.yaml' '*.yml' | head
   git remote -v | grep -i heroku
   grep -lE 'vercel|netlify|wrangler|flyctl|fly deploy|railway|render|heroku|sam deploy|cdk deploy|serverless deploy|gcloud|az (webapp|containerapp|functionapp)|kubectl|helm' \
     .github/workflows/*.y*ml .gitlab-ci.yml bitbucket-pipelines.yml azure-pipelines.yml .circleci/config.yml 2>/dev/null
   # env var NAMES only
   cat .env .env.* 2>/dev/null | grep -oE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//; s/=$//' | sort -u
   awk 'BEGIN { for (k in ENVIRON) print k }' | sort
   for c in vercel netlify wrangler fly flyctl render railway heroku aws sam gcloud az kubectl helm docker sentry-cli logcli axiom newrelic; do command -v "$c" >/dev/null && echo "$c"; done
   ```

   | Signal | Host |
   | --- | --- |
   | `vercel.json`, `.vercel/`, `VERCEL_*` | Vercel |
   | `netlify.toml`, `NETLIFY_*` | Netlify |
   | `wrangler.toml` / `wrangler.json(c)`, `CLOUDFLARE_*` | Cloudflare Workers / Pages |
   | `fly.toml`, `FLY_*` | Fly.io |
   | `render.yaml`, `RENDER_*` | Render |
   | `railway.json` / `railway.toml`, `RAILWAY_*` | Railway |
   | `Procfile` plus a `heroku` git remote, `HEROKU_*` | Heroku |
   | `serverless.yml`, `template.yaml` (SAM), `cdk.json`, ECS task definitions, `AWS_*` | AWS (logs in CloudWatch) |
   | `app.yaml` with a `runtime:` key | Google App Engine |
   | `gcloud run deploy` in CI, `GOOGLE_CLOUD_PROJECT` | Google Cloud Run (logs in Cloud Logging) |
   | `azure.yaml`, `az webapp` / `az containerapp` in CI, `AZURE_*` | Azure (logs in Azure Monitor) |
   | k8s manifests (`kind: Deployment`), `Chart.yaml`, `kustomization.yaml` | Kubernetes |
   | `docker-compose.yml` / `compose.yaml` used by the deploy step | Docker Compose on a server |

   | Signal (SDK, config file, env var name) | Log / error platform |
   | --- | --- |
   | `@sentry/*`, `sentry-sdk`, `sentry.*.config.*`, `.sentryclirc`, `SENTRY_DSN` | Sentry |
   | `dd-trace`, `ddtrace`, `datadog.yaml`, `DD_API_KEY`, `DD_SERVICE` | Datadog |
   | `@logtail/*`, `LOGTAIL_*`, `BETTER_STACK_*` | Better Stack (Logtail) |
   | `@axiomhq/*`, `next-axiom`, `AXIOM_TOKEN`, `AXIOM_DATASET` | Axiom |
   | `pino-loki`, `winston-loki`, Promtail / Alloy config, `LOKI_*` | Grafana Loki |
   | `newrelic` package, `newrelic.js` / `newrelic.ini`, `NEW_RELIC_*` | New Relic |
   | `@honeycombio/*`, `HONEYCOMB_API_KEY` | Honeycomb |
   | AWS host, `winston-cloudwatch` | CloudWatch |
   | Google Cloud host, `@google-cloud/logging*` | Cloud Logging |
   | Azure host, `applicationinsights`, `@azure/monitor-opentelemetry`, `APPLICATIONINSIGHTS_CONNECTION_STRING` | Azure Monitor / Application Insights |

   Production is the target the deploy workflow ships to. A `docker-compose.yml` next to a `fly.toml` is usually local dev. If the signals conflict or there are none, ask the user once, with your best guess ("Looks like Fly.io, with errors also going to Sentry. Right?"), and use the answer for the rest of the run.

   When there is both a host and an error platform, use both. The error platform already groups errors and has stack traces and releases. The host's logs show what never reached it: timeouts, crashes, out-of-memory kills, 5xx responses with no exception.

2. **Verify access and scope.** Check that the CLI or API is logged in and pointed at the right account, team, project, app, region, cluster or namespace before trusting any result. A wrong scope returns an empty result that looks exactly like "no errors". Each provider's check is in REFERENCE.md. Example: on Vercel, `Can't find ... under the context "<wrong-team>"` means the CLI is on the wrong team.

3. **Pull production error logs for a window.** Fetch the last 24h (or the window the user asked for) into a scratch dir, as JSON when the provider can emit it:
   ```bash
   work=$(mktemp -d)
   <provider fetch command from REFERENCE.md> > "$work/prod_errors.jsonl"
   wc -l "$work/prod_errors.jsonl"
   ```
   - Filter to production (environment, app, service, namespace) and to errors (level error or worse, or 5xx) on the provider side when it can. When it can't, fetch everything and filter in step 4 with `--errors`.
   - **History or live tail.** Some providers only stream live logs (REFERENCE.md says which). Then start the stream into a file in the background, let it run for a few minutes (longer on low traffic), stop it, and say in the report that the window is the capture time. macOS has no `timeout`: background the command and kill it (in Claude Code, the Bash tool's background option; elsewhere `cmd > file & pid=$!` … `kill $pid`), or use `gtimeout` if coreutils is installed.
   - **Retention is often short.** Analyze the window you get. Missing older data is expected, not a bug.
   - **If the fetch hits its limit fast, one error is flooding.** Raise the limit or page through.

4. **Aggregate.** Run the bundled script. It reads JSON Lines, JSON arrays and API responses, pretty-printed JSON, and plain-text lines from any provider, collapses ids, numbers, uuids, hex and timestamps, and ranks the normalized messages and the error-heavy routes:
   ```bash
   node <skill-dir>/scripts/aggregate-logs.mjs "$work/prod_errors.jsonl"
   ```
   | Option | Use |
   | --- | --- |
   | `--errors` | Keep only error/fatal entries and 5xx responses, for sources you couldn't filter on the provider side. |
   | `--level warn` / `--status 5xx,4xx` | Keep entries at these levels or HTTP statuses (an entry is kept if it matches any filter). |
   | `--by level,status,deploy,service` | Extra breakdowns. `deploy` reads deployment id, version, release or revision fields. Any field path also works (`--by resource.labels.revision_name`). |
   | `--count <field>` | Add up a count field instead of counting rows, for rows that are already grouped (Sentry issues, Logs Insights `stats`). |
   | `--limit <n>` | The fetch limit you used, so the "hit limit" warning is right (default 1000, `0` turns it off). |
   | `--top <n>` | Rows per section (default 15). |

   Pass several files to aggregate them together, or `-` to read stdin. If the platform already grouped the errors (Sentry issues, Datadog Error Tracking, GCP Error Reporting), use its groups and counts, and use the script only on the host logs.

5. **Confirm coverage.** Check nothing else hides:
   - 5xx and 4xx responses. Request or router logs are often a separate source from app logs (Vercel `requests`, Cloud Run request logs, the Heroku router, a load balancer).
   - Warnings.
   - Older slices: sample an earlier window with the provider's start/end flags. It is usually empty because of retention.
   - Platform events that never reach app logs: crash loops, out-of-memory kills, failed health checks, failed deploys.
   - One full stack trace for each top issue: `grep -m1 "<msg>" "$work/prod_errors.jsonl"`. `.next/server/chunks/ssr/...` frames mean Next.js SSR or a Server Action (`POST /<page>`). Minified frames need source maps (the error platform usually has them).
   - If the window spans a deploy, split by deployment (`--by deploy`) before blaming the current code.

6. **Trace to source on the code that is deployed.** Production runs whatever the provider deployed. That is often the default branch, but it can be a release branch, a tag, a promoted or rolled-back build, and it is never your working branch. Find the deployed commit:
   - from the log entries (deployment id, version, release, revision, image tag, `branch` or commit fields),
   - or from the provider (REFERENCE.md lists the command for each),
   - or from the last successful run of the CI deploy workflow.

   Then search that commit:
   ```bash
   git fetch origin
   git grep -n "<literal error string>" <deployed-sha>   # or origin/<production-branch>
   ```
   If you can't pin the commit, use the production branch from the provider's settings or the deploy workflow, and say so in the report. Follow imports to find where the failing call is mounted. An auth error (`Forbidden` / `Unauthorized`) thrown inside a server-action wrapper or a try/catch that logs and swallows it is recorded as an error even when the HTTP response is 200. Those are the usual flood.

7. **Write the report** (structure below) and offer to implement the top fix.

## Report structure

```md
# Production error report — <provider> — <date>

## Summary
- Source: <host and/or platform>, <project/app/service>, deployment <id or commit>
- Window analyzed: <start → end UTC>, <N> error events (<"live capture" if it was a tail>)
- Headline: <one line — e.g. "one error is ~100% of the flood">

## Top issues
### 1. <error> — <count> (<% of errors>)
- **Where:** <routes> · stack top frame
- **Root cause:** <file:line, why it fires>
- **Fix:** <concrete change>
### 2. ...

## Health checks
- 5xx: <n> · 4xx: <n> · warnings: <n>
- Not covered: <sources or windows you couldn't read, and why>
```

## Gotchas
- **Wrong scope looks like no errors.** Verify account, team, project and environment before reporting "clean".
- **Vercel: `--no-branch` or you get nothing.** Older Vercel CLIs filter `vercel logs` by the current git branch, so a feature branch returns zero production logs. See REFERENCE.md for the CLI versions.
- **Production = what's deployed.** Grep the deployed commit, not the working branch, and not the default branch until you've confirmed it's what runs.
- **Short retention.** Analyze the window you get; don't assume missing older data is a bug.
- **Live tail only.** Some providers only stream. Capture for a while into a file, and report the capture window.
- **macOS has no `timeout`.** Don't wrap streaming commands in it.
- **Split by deployment.** If the window spans a deploy, group by deployment, version or revision before blaming the current code.
- **App logs miss platform failures.** Timeouts, OOM kills and crash loops often show only in router, request or platform event logs.
