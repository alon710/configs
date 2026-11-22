# Reference: per-provider commands

Each section covers: **Access** (login and scope), **Fetch** (production errors for a window, as JSON where possible), **Filter** (level and status), **History** (stored logs or live tail only), **Deployed commit**, and **Watch for**. Flags change between CLI versions: when a flag here fails, run `<cli> <command> --help` and adapt.

Hosts: [Vercel](#vercel) · [Netlify](#netlify) · [Cloudflare Workers / Pages](#cloudflare-workers--pages) · [Fly.io](#flyio) · [Render](#render) · [Railway](#railway) · [Heroku](#heroku) · [AWS](#aws-lambda-ecs-beanstalk--cloudwatch) · [Google Cloud](#google-cloud-cloud-run-app-engine-functions-gke--cloud-logging) · [Azure](#azure-app-service-container-apps-functions--azure-monitor) · [Kubernetes](#kubernetes) · [Docker Compose](#docker-compose)

Log and error platforms: [Sentry](#sentry) · [Datadog](#datadog) · [Better Stack](#better-stack-logtail) · [Axiom](#axiom) · [Grafana Loki](#grafana-loki) · [New Relic](#new-relic) · [Honeycomb](#honeycomb) · [Anything else](#anything-else)

## Shared helpers

```bash
work=$(mktemp -d)
since_ms=$(( ($(date +%s) - 86400) * 1000 ))   # 24h ago, epoch milliseconds (macOS and Linux)
since_iso=$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)
```

**Live-tail capture** (providers with no stored history). macOS has no `timeout`, so background the stream and stop it:

```bash
<tail command> > "$work/tail.log" 2> "$work/tail.err" &
tail_pid=$!
# let it run a few minutes (longer on low traffic), then:
kill "$tail_pid"
wc -l "$work/tail.log"; head -5 "$work/tail.err"
```

In Claude Code, the Bash tool's background option does the same; check back after a few minutes instead of sleeping in the foreground. With coreutils installed, `gtimeout 300 <tail command> > "$work/tail.log"` also works. Report the capture window as the analyzed window.

**Empty file?** Check stderr before concluding "no errors": a login, scope or link error often goes to stderr, which `2>/dev/null` hides.

## Vercel

Requires the Vercel CLI (`vercel`, or `npx vercel` / `bunx vercel`) and a logged-in account (`vercel whoami`). Examples use `vercel`.

**Two CLI generations.** Run `vercel logs --help` first and use the matching commands.
- **Older CLIs** have `--level`, `--status-code`, `--source`, `--request-id`, `--expand` and `--follow`, and filter by the current git branch unless you pass `--no-branch`.
- **Newer CLIs** (checked on 65.16) filter with `--query` (KQL-like), have `runtime` (default) and `requests` data sources, and print typed JSON lines. They reject `--expand` ("Full runtime messages are shown by default"), `--level`, `--status-code`, `--source`, `--request-id` and `--branch`. `--no-branch` still parses. `vercel logs` works on team-owned projects only.

**Access and scope.** In the project dir run `vercel ls --prod 2>&1 | head` (newer CLIs: `vercel ls --environment production`; `--prod` is deprecated there). If it errors with `Can't find ... under the context "<wrong-team>"`, the CLI is on the wrong scope: run `vercel link` (pick the right team/project) or pass `--scope <team>` on every command. `vercel inspect` in particular defaults to the personal scope and often needs `--scope`. Newer CLIs say `Your codebase isn't linked to a project on Vercel` and accept `--scope <team> --project <name>`. On 65.16, `vercel logs` rejected `--scope <team>` after the subcommand but accepted `--scope=<team>` or `vercel --scope <team> logs …`.

**Fetch (older CLI). ALWAYS pass `--no-branch`.** `vercel logs` silently filters by the *current git branch*. On a feature branch that returns **zero** production logs (message: `No logs found ... on branch <x>`). This is the #1 trap.
```bash
vercel logs --environment production --no-branch --level error \
  --since 24h --limit 1000 --expand --json 2>/dev/null > "$work/prod_errors.jsonl"
wc -l "$work/prod_errors.jsonl"
```
`--expand --json` prints one entry per line; each entry's `logs[]` array holds the full multi-line trace.

**Fetch (newer CLI).**
```bash
vercel logs --environment production --query 'level:error' \
  --since 24h --limit 1000 --json 2>/dev/null > "$work/prod_errors.jsonl"
wc -l "$work/prod_errors.jsonl"
```
Lines are typed (`{"type":"log","data":{…}}`) and end with a summary line. The aggregate script unwraps them; with jq use `jq 'select(.type == "log") | .data'`. `--limit` goes up to 10000; continue a query with `--next <cursor>` from the summary's `next` value. If you see `No logs found ... on branch <x>`, add `--no-branch`.

**Retention is short** (recent window only), so `--since 24h` may still return only the last few minutes. That's expected, not an error. If `--limit` is hit fast, one error is flooding.

**Coverage.**
- Older CLI: `--status-code 5xx`, `--status-code 4xx`, `--level warning`. Sample older slices with `--until 6h` etc. (usually empty — retention).
- Newer CLI: `vercel logs requests --environment production --query 'httpStatus >= 500' --json` (4xx: `'httpStatus >= 400 AND httpStatus < 500'`), `--query 'level:warning'`, older slices with `--since 12h --until 6h`.
- Stack trace: `grep -m1 "<msg>" "$work/prod_errors.jsonl"`. `.next/server/chunks/ssr/...` frames mean SSR or a Server Action (`POST /<page>`).

**Useful flags.** Older: `--query "status:500 error"` (advanced search) · `--request-id <id>` · `--source serverless|edge-function|edge-middleware` · `--follow` (live stream; on macOS there is no `timeout`, so run it in the background or Ctrl-C). Newer: `--query 'requestId:"<id>"'` · `--query 'source:middleware'` (function, middleware, ci, edge, daemon) · `--deployment <id or url>` · `--project <name>`.

**Deployed commit.** Older JSON entries carry `branch`; entries carry `deploymentId`. `vercel ls --environment production` lists production deployments, newest first, and `vercel inspect <deployment-url> --json` shows one. The git commit is in the deployment's metadata: `vercel api /v13/deployments/<id-or-url>` returns `meta.githubCommitSha` / `meta.githubCommitRef` for GitHub-connected projects (GitLab and Bitbucket use their own `meta` keys; check `vercel api --help` and the response). Production usually runs the project's production branch, but a promoted or rolled-back deployment can run older code.

**Watch for.**
- **Split by deployment.** If the window spans a deploy, group by the entry's `deploymentId` (`--by deploy`) before blaming the current code.
- Errors logged inside a server-action wrapper are recorded as errors even when the response is 200.

## Netlify

- **Access:** `netlify status` (logged-in user and linked site); `netlify link` if unlinked.
- **Fetch:** the CLI streams function logs live: `netlify logs:function [name]`. Commands differ by version; run `netlify logs --help` and `netlify help` to see what yours has (deploy logs, edge function logs).
- **History:** live only through the CLI. Stored function logs are in the Netlify UI (Logs), with retention by plan. If a log drain is set up, read the drain's destination instead (Datadog, Better Stack, …).
- **Filter:** no level filter on the stream; use the script's `--errors`.
- **Deployed commit:** the site's published deploy carries `commit_ref` and `branch`: `netlify api getSite --data '{"site_id":"<id>"}'` (see `netlify api --list` for the operations), or the Deploys page in the UI.
- **Watch for:** CDN 404s and redirects never reach function logs.

## Cloudflare Workers / Pages

- **Access:** `npx wrangler whoami` (account); the Worker name and environments are in `wrangler.toml` / `wrangler.jsonc` (`name`, `[env.production]`).
- **Fetch (live):** `npx wrangler tail <worker> --format json [--env production] [--status error] > "$work/tail.json"`. It prints pretty-printed JSON objects back to back; the aggregate script reads that format. Other filters: `--method`, `--search <text>`, `--sampling-rate`. Pages Functions: `npx wrangler pages deployment tail --project-name <name> --format json` (check `--help` for picking the production deployment).
- **History:** `wrangler tail` is live only. If Workers Logs is on (`observability` enabled in the wrangler config), recent invocations are stored and queryable in the dashboard (Workers → Observability); check the Cloudflare docs for API access.
- **Filter:** `outcome` other than `ok` (`exception`, `exceededCpu`, …) means the invocation failed; the script counts those as errors.
- **Deployed commit:** `npx wrangler deployments list` / `npx wrangler versions list` show the active version and its message or tag; the commit shows when it was deployed by Workers Builds or by CI that sets one.
- **Watch for:** tail can sample or drop events on busy Workers, so treat counts as a sample.

## Fly.io

- **Access:** `fly auth whoami`; the app name is `app = …` in `fly.toml`; `fly status -a <app>`.
- **Fetch:** `fly logs -a <app> --no-tail --json > "$work/fly.jsonl"` returns the recent buffer; without `--no-tail` it streams. Narrow with `-r <region>` or `-m <machine-id>`.
- **History:** the CLI returns only a recent buffer. For older logs, use the dashboard's log search or a log shipper, if one is set up.
- **Filter:** no level filter; use the script's `--errors`. App lines often embed the app's own JSON; the script parses it.
- **Deployed commit:** `fly releases -a <app> --image` shows each release's image; the image tag or labels often carry the commit. `fly status -a <app>` shows what's running now.
- **Watch for:** `[error]` lines from `proxy[…]` (no healthy machine, connection refused) and out-of-memory kills are platform failures that never reach app logs.

## Render

- **Access:** Render CLI (`render`) after `render login`, or an API key for the REST API (`RENDER_API_KEY` by convention).
- **Fetch:** `render logs` (run `render logs --help` for the resource id, time range, level and JSON output flags), or the REST API's logs endpoint (check the Render API docs for its parameters).
- **History:** stored, with retention by plan. A log stream (syslog, Datadog, Better Stack, …) may hold longer history.
- **Deployed commit:** the service's deploy list (dashboard, CLI or API) shows each deploy's commit.

## Railway

- **Access:** `railway whoami`; `railway status` shows the linked project, environment and service (`railway link` to change). Make sure the environment is production.
- **Fetch:** `railway logs` shows the latest deployment's logs for the linked service. Run `railway logs --help` for JSON output, a specific deployment, build vs runtime logs, and line or time limits.
- **History:** older deployments' logs are in the dashboard, with retention by plan.
- **Deployed commit:** the deployment in the dashboard shows its commit; `railway status` shows the active deployment.

## Heroku

- **Access:** `heroku auth:whoami`; the app comes from the `heroku` git remote (`git remote -v`) or `-a <app>`.
- **Fetch:** `heroku logs -a <app> -n 1500 > "$work/heroku.log"` (Logplex keeps only the most recent 1500 lines). `--tail` streams. Narrow with `--source app` / `--source heroku` and `--dyno web` (or `--dyno router`). Output is plain text; router lines are logfmt (`at=error code=H12 desc="Request timeout" … status=503`), which the script parses.
- **History:** 1500 lines at most. Anything older needs a log drain or add-on (Papertrail, Better Stack, …). Apps on the newer Fir generation log differently; check `heroku logs --help`.
- **Filter:** use the script's `--errors` (router `at=error`, 5xx, error-level app lines).
- **Deployed commit:** `heroku releases -a <app>`: git and pipeline deploys show `Deploy <sha>`; `heroku releases:info <vN>` for details.
- **Watch for:** platform error codes: `H10` app crashed, `H12` request timeout, `H13` connection closed without response, `H14` no web dynos running, `R14` / `R15` memory quota exceeded.

## AWS (Lambda, ECS, Beanstalk) / CloudWatch

- **Access:** `aws sts get-caller-identity` (account and role); region from `aws configure get region` or `AWS_REGION`; profile from `AWS_PROFILE`.
- **Find the log group:** Lambda writes to `/aws/lambda/<function>`; ECS uses the `awslogs` group from the task definition; Beanstalk uses `/aws/elasticbeanstalk/<env>/…`. List them: `aws logs describe-log-groups --log-group-name-prefix /aws/lambda/ --query 'logGroups[].logGroupName'`.
- **Fetch:**
  ```bash
  aws logs filter-log-events --log-group-name <group> --start-time "$since_ms" \
    --filter-pattern '?ERROR ?Error ?Exception ?"Task timed out"' --output json > "$work/cw.json"
  ```
  The CLI pages through results; cap with `--max-items <n>`. For large windows, Logs Insights is faster:
  ```bash
  qid=$(aws logs start-query --log-group-name <group> \
    --start-time $(( $(date +%s) - 86400 )) --end-time $(date +%s) \
    --query-string 'fields @timestamp, @message | filter @message like /ERROR|Error|Exception|Task timed out/ | sort @timestamp desc | limit 10000' \
    --query queryId --output text)
  aws logs get-query-results --query-id "$qid" > "$work/insights.json"   # repeat until "status": "Complete"
  ```
  `filter-log-events` takes epoch milliseconds; `start-query` takes epoch seconds.
- **Live:** `aws logs tail <group> --since 1h --follow --format short --filter-pattern ERROR`.
- **History:** stored, per the log group's retention setting.
- **Filter:** the filter pattern above, or fetch everything and use the script's `--errors`. The script parses Lambda's `<timestamp>\t<request id>\t<LEVEL>\t<message>` lines and the JSON in `Invoke Error` lines.
- **Deployed commit:** Lambda: `aws lambda get-function --function-name <fn> --query 'Configuration.[Version,LastModified]'` and its aliases; ECS: `aws ecs describe-services` → the task definition's image tag. Neither is a git sha unless the deploy put one in a tag, a description or the image tag; otherwise use the CI deploy run.
- **Watch for:** `Task timed out after N seconds` and `Runtime.ExitError` lines are errors with no stack. 5xx from API Gateway or a load balancer show in their access logs or metrics, not in the function's log group.

## Google Cloud (Cloud Run, App Engine, Functions, GKE) / Cloud Logging

- **Access:** `gcloud auth list`; `gcloud config get-value project` (or pass `--project`).
- **Fetch:**
  ```bash
  gcloud logging read 'severity>=ERROR AND resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"' \
    --project <project> --freshness=1d --limit=1000 --format=json > "$work/gcp.json"
  ```
  Resource types: Cloud Run `cloud_run_revision`, App Engine `gae_app` (service in `resource.labels.module_id`), Cloud Functions (1st gen) `cloud_function`, GKE `k8s_container`. For an exact window put `timestamp>="<start>" AND timestamp<"<end>"` (ISO times, such as `$since_iso`) in the filter instead of `--freshness`. App Engine also has `gcloud app logs read --service <s> --limit <n>`.
- **Filter:** `severity>=ERROR`, `severity=WARNING`, `httpRequest.status>=500`, `httpRequest.status>=400 AND httpRequest.status<500`.
- **History:** stored (the `_Default` bucket's retention, 30 days unless changed). `gcloud beta logging tail '<filter>'` streams live.
- **Deployed commit:** Cloud Run: `gcloud run services describe <service> --region <region> --format json` (latest ready revision, traffic split, image) and `gcloud run revisions list --service <service> --region <region>`; App Engine: `gcloud app versions list --service <s>`. The image tag or labels often carry the commit; split by `resource.labels.revision_name` (`--by deploy`).
- **Watch for:** request logs (`run.googleapis.com/requests`) carry `httpRequest.status` but no message or stack; the app's own log lines carry the stack. Correlate them with the `trace` field. Error Reporting in the console already groups exceptions.

## Azure (App Service, Container Apps, Functions) / Azure Monitor

- **Access:** `az account show` (subscription); `az account set --subscription <id>`.
- **Fetch (stored):** query Log Analytics or Application Insights with KQL:
  ```bash
  az monitor log-analytics query --workspace <workspace-guid> -o json \
    --analytics-query 'AppExceptions | where TimeGenerated > ago(1d)' > "$work/azure.json"
  ```
  Requests with 5xx: `AppRequests | where TimeGenerated > ago(1d) and toint(ResultCode) >= 500`. Classic (non-workspace) Application Insights names the tables `exceptions`, `requests`, `traces` with a `timestamp` column, queried with `az monitor app-insights query --app <app> --analytics-query '<KQL>'`. Container Apps console logs are in a `ContainerAppConsoleLogs*` table. Table and column names differ between setups: check the schema in the portal. These commands may need the `log-analytics` / `application-insights` CLI extensions.
- **Live:** App Service `az webapp log tail --name <app> --resource-group <rg>` (needs app logging on); Container Apps `az containerapp logs show --name <app> --resource-group <rg> --follow` (run `--help` for JSON output and line count).
- **Deployed commit:** the deploy workflow run, or the image tag (`az containerapp show --name <app> --resource-group <rg> --query 'properties.template.containers[].image'`).

## Kubernetes

- **Access:** `kubectl config current-context` (right cluster?), the namespace (`-n <ns>`), and `kubectl auth can-i get pods --subresource=log -n <ns>`.
- **Fetch:**
  ```bash
  kubectl logs -n <ns> -l app=<label> --all-containers --prefix --timestamps \
    --since=24h --tail=-1 --max-log-requests=20 > "$work/k8s.log"
  ```
  With a selector `--tail` defaults to 10 lines, so pass `--tail=-1`. `kubectl logs deploy/<name>` reads one pod unless you add `--all-pods=true` (newer kubectl). Crashed containers: `kubectl logs <pod> -n <ns> --previous`. The script strips the `[pod/…/container]` prefix and timestamps and parses JSON or logfmt lines.
- **History:** only what the node still has for the current and previous container; logs go when a pod is deleted or rotated. Clusters usually ship logs elsewhere (Loki, Datadog, CloudWatch, Cloud Logging); use that when it exists.
- **Filter:** none on the server; use the script's `--errors`.
- **Deployed commit:** `kubectl get deploy <name> -n <ns> -o jsonpath='{.spec.template.spec.containers[*].image}'`, `kubectl rollout history deploy/<name> -n <ns>`; Helm: `helm history <release> -n <ns>`; GitOps (Argo CD, Flux): the synced git revision.
- **Watch for:** `kubectl get events -n <ns> --sort-by=.lastTimestamp` and `kubectl get pods -n <ns>` (restarts) show OOMKilled, CrashLoopBackOff and failed probes, which app logs miss.

## Docker Compose

- **Access:** production compose usually runs on a remote host: `docker context ls`, `DOCKER_HOST`, or ssh to the server. `docker compose ps` shows the services.
- **Fetch:** `docker compose logs --since 24h --timestamps --no-color [service] > "$work/compose.log"` (`--until` for a window end). The script strips the `service-1  | ` prefix and timestamps.
- **History:** as long as the containers exist and the log driver keeps files (`json-file` / `local`, rotated by size); `docker compose down` removes them.
- **Filter:** use the script's `--errors`.
- **Deployed commit:** `docker compose images`; `docker inspect <container> --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'` when the build sets that label; otherwise the image tag or the deploy run.

## Sentry

- **Access:** a connected Sentry MCP server, if any. Otherwise `sentry-cli info` (config and auth) and an auth token (`SENTRY_AUTH_TOKEN`); org and project slugs from `.sentryclirc`, `sentry.*.config.*` or `SENTRY_ORG` / `SENTRY_PROJECT`.
- **Fetch:** issues are already grouped, so rank them as they are:
  ```bash
  curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
    "https://sentry.io/api/0/organizations/<org>/issues/?project=<project-id>&environment=production&statsPeriod=24h&query=is:unresolved&sort=freq" \
    > "$work/sentry.json"
  node <skill-dir>/scripts/aggregate-logs.mjs --count count "$work/sentry.json"
  ```
  Self-hosted and region-specific orgs use their own base URL. Check the Sentry API docs for these parameters and whether `count` covers the window or the issue's lifetime. Never print the token.
- **History:** stored, retention by plan.
- **Deployed commit:** the event's `release` (often a commit sha or a version), and the release's commits (`sentry-cli releases list`).

## Datadog

- **Access:** a connected Datadog MCP server, if any; otherwise an API key and an application key (`DD_API_KEY`, `DD_APP_KEY` or `DD_APPLICATION_KEY`) and the site (`DD_SITE`, default `datadoghq.com`).
- **Fetch:**
  ```bash
  curl -s -X POST "https://api.${DD_SITE:-datadoghq.com}/api/v2/logs/events/search" \
    -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" -H "Content-Type: application/json" \
    -d '{"filter":{"query":"service:<svc> env:production status:error","from":"now-24h","to":"now"},"page":{"limit":1000},"sort":"-timestamp"}' \
    > "$work/datadog.json"
  ```
  Page with `"page":{"cursor":"<meta.page.after>"}`. Error Tracking and Log Patterns in the UI already group errors.
- **Deployed commit:** the `version` tag (`--by deploy`), when the service sets it.

## Better Stack (Logtail)

- Query in the Better Stack UI (Live tail and its query editor), or use its query API / remote SQL connection; check the Better Stack docs for the endpoint and auth. Export the result as JSON and run the script on it.

## Axiom

- **Access:** `axiom auth status` (CLI), or an API token (`AXIOM_TOKEN`).
- **Fetch:** `axiom query "['<dataset>'] | where level == 'error' | limit 1000"` (APL; field names depend on how the app ships logs). Run `axiom query --help` for JSON output and time-range flags. To rank on the server: `… | summarize count() by message | order by count_ desc`.

## Grafana Loki

- **Access:** `logcli` with `LOKI_ADDR` (plus `LOKI_USERNAME` / `LOKI_PASSWORD` or a bearer token for Grafana Cloud), or a connected Grafana MCP server.
- **Fetch:**
  ```bash
  logcli query '{app="<app>", env="production"} |~ "(?i)error|exception"' \
    --since=24h --limit=5000 --output=jsonl > "$work/loki.jsonl"
  ```
  Labels depend on the setup: `logcli labels` lists them. The script reads the `line` field of each entry.

## New Relic

- **Access:** the `newrelic` CLI (profile with an API key) or NerdGraph.
- **Fetch:** NRQL, already grouped: `newrelic nrql query --accountId <id> --query "SELECT count(*) FROM TransactionError FACET error.class, error.message SINCE 1 day ago LIMIT 100"`. Log lines: `SELECT * FROM Log WHERE level = 'error' SINCE 1 day ago LIMIT MAX` (the level attribute's name depends on the log forwarder). Check `newrelic nrql query --help`.

## Honeycomb

- Honeycomb stores events and traces, not log lines. Query for failing spans (a field such as `error` or `http.status_code >= 500`, depending on the instrumentation) grouped by name and exception message, in the UI, a connected Honeycomb MCP server, or the Query Data API (check the docs for access and keys).

## Anything else

Ask the user where production logs go and how to export them. Any JSON, JSON Lines or plain-text export works with the script. If there is no way to read production logs from here, say so, and give the user the exact export to run so they can share the file.
