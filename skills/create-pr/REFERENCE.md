# Reference

## Issue trackers

### Detect the tracker

Stop at the first clear answer.

1. **Repo docs:** `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, the PR/MR template (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/`, `.gitlab/merge_request_templates/`, `.azuredevops/pull_request_template.md`), and README badges.
2. **History:** ids or ticket links in recent PR titles, branch names and commit messages. Squash merges put PR titles on the default branch, and merge commits name the branch, so `git log` covers most of it. These count id prefixes:
   ```bash
   # ids in recent commit subjects and bodies on the default branch
   git log -100 --format='%s%n%b' origin/<default> \
     | grep -oE '\b[A-Z][A-Z0-9]+-[0-9]+\b|AB#[0-9]+|\bsc-[0-9]+\b|\bCU-[0-9a-z]+\b|#[0-9]+' \
     | sed -E 's/-[0-9]+$/-n/; s/#[0-9]+$/#n/' | sort | uniq -c | sort -rn | head
   # ids in recent branch names (generated branch names are usually lowercase)
   git branch -r --sort=-committerdate --format='%(refname:short)' | head -50 \
     | grep -ioE '\b[a-z][a-z0-9]+-[0-9]+\b|\bsc-[0-9]+\b|\bcu-[0-9a-z]+\b' \
     | sed -E 's/-[0-9]+$/-n/' | sort | uniq -c | sort -rn | head
   ```
   - `#n` hits include PR numbers: a squash title's `(#123)` suffix and `Merge pull request #123` are PRs, not issues.
   - A prefix like `UTF-n` or `ES-n` is noise. A real ticket prefix repeats across many PRs.
   - Ticket URLs count too: `linear.app/…/issue/`, `atlassian.net/browse/`, `dev.azure.com/…/_workitems/`, `app.shortcut.com/…/story/`, `app.clickup.com/t/`, `app.asana.com/`, `trello.com/c/`, `notion.so/`.
3. **Connected tools:** tracker MCP servers in this session (Linear, Atlassian/Jira, Asana, ClickUp, Trello, Notion, Shortcut, GitHub), and tracker CLIs on PATH (`gh`, `glab`, `jira`, `acli`, `az`). A CLI only counts if it's signed in (`gh auth status`, `glab auth status`, `az account show`).
4. **The code host's own issues,** if they're enabled and in recent use: `gh repo view --json hasIssuesEnabled` and `gh issue list --state all --limit 5` on GitHub, `glab issue list` on GitLab.
5. **Still unclear, or several candidates:** ask the user once which tracker this repo uses, with your guess.

`ABC-123` can be Linear, Jira or YouTrack. Tell them apart by which tool is connected and which one resolves the id.

### How each tracker links

| Tracker | Id / link form | Link and close on merge | Partial work: link, keep open | Look up / create |
| --- | --- | --- | --- | --- |
| Linear | `ENG-123` (team key); generated branches look like `<user>/eng-123-<slug>` | Id at the end of the PR title, or in the branch name. `Fixes/Closes/Resolves ENG-123` in the body also works. By default an open PR moves the issue to In Progress and the merge moves it to Done; the exact mapping is in the team's Git automation settings. | Leave the id out of the title and write `Part of ENG-123` (or `Refs ENG-123`) in the body: the PR links, but the merge doesn't apply the merge status. A branch named with the id still links and moves the issue. | Linear MCP: `get_issue`, `list_issues`, `save_issue` (needs a team), `list_teams`; or the Linear API |
| Jira | `PROJ-123` (project key) | Key in the branch name, commit messages or PR title links it through the code host's Jira integration (GitHub for Jira, GitLab's Jira integration, Bitbucket). Put it at the end of the title, as with Linear. Transitions come from Jira automation rules, or from smart commits (`PROJ-123 #done`) if the admin enabled them. | The same key, with no smart-commit transition. If an automation rule transitions on merge, tell the user the ticket will move anyway. | Atlassian MCP, `acli` (Atlassian CLI) or `jira` (jira-cli), or the REST API. Check `<cli> --help` for the subcommands. |
| GitHub Issues | `#123`, `owner/repo#123` | `Closes/Fixes/Resolves #123` in the PR description. It closes the issue only when the PR merges into the default branch. A closing keyword in a commit message also closes it once that commit lands on the default branch. | `Part of #123` or `Refs #123` in the body only links. Check that no commit message on the branch says `Fixes #123`. | `gh issue view <n>`, `gh issue list --search "…"`, `gh issue create --title "…" --body-file <f>` |
| GitLab Issues | `#123`, `group/project#123` | `Closes #123` (or the project's other closing patterns) in the MR description closes it when the MR merges into the default branch. | Mention it without a closing word, for example `Related to #123`. | `glab issue view/list/create` |
| Azure Boards | `AB#123` on GitHub; the work item id on Azure Repos | On GitHub, `AB#123` in the PR title, description or commits links it (through the Azure Boards app), and `Fixes AB#123` can close it. On Azure Repos, link the work item to the PR (`az repos pr create --work-items 123`); `--transition-work-items true` moves it to its next state when the PR completes. | GitHub: `AB#123` without a fix word. Azure Repos: link it with `--work-items` and leave `--transition-work-items` off. | `az boards work-item show --id <n>`, `az boards work-item create --type <type> --title "…"` |
| Shortcut | `sc-123` | `sc-123` in the branch name, or `[sc-123]` in the PR title or a commit, links it. States follow the workspace's VCS workflow settings. | Any link moves the story the way those settings say. If the user wants it to stay where it is, tell them before opening the PR. | Shortcut MCP or API |
| ClickUp | `CU-<task id>` or `#<task id>` | Task id in the branch name, a commit message or the PR title links it through the ClickUp integration. Status changes come from ClickUp automations. | The same link. Tell the user if an automation moves the task on merge. | ClickUp MCP or API |
| Asana | task URL | Paste the task URL in the PR description. The Asana GitHub integration attaches the PR and can update the task through rules. | The same URL. Rules decide whether the task moves. | Asana MCP or API |
| Trello | card URL | No id convention. Paste the card URL in the PR body; the GitHub Power-Up attaches the PR to the card. Moving the card is manual or a Butler rule. | The same URL. Nothing moves unless a rule does it. | Trello MCP or REST API |
| Notion | page URL | Paste the page URL in the PR body. Linking depends on the workspace's GitHub integration. | The same URL. | Notion MCP |
| YouTrack | `PROJ-123` | Id in commits or the PR through the VCS integration; commit commands (`PROJ-123 Fixed`) if enabled. | The id with no command. | YouTrack MCP or REST API |
| Other / none | — | Ask the user how tickets link. If there is no tracker, say so and continue without one. | — | — |

### Check that the ticket fits

Look the ticket up with the tracker's tool from the table, and read its title, description, state, and team or project.

- **It fits** when it describes the change in the diff. If the diff covers only part of it, that's partial work (step 8). Ask if you're unsure.
- **It describes other work**, or sits in a team or project that doesn't match this repo: a reused branch can carry a stale id. Say so and ask which ticket to use.
- **It's already closed, done or cancelled:** say so, and ask whether to reopen it, use another one, or create a follow-up.
- **The tool isn't connected:** you can't check it. Say so, ask the user to confirm the id, and note in the report that it wasn't checked.

### Create a ticket

Only after the user says yes (step 2), and only in this repo's tracker.

1. **Search for a duplicate first** with the tracker's list or search tool, using the main words of the draft title. If one exists, offer it instead.
2. **File it where this repo's recent tickets live.** Linear needs a team, Jira a project and issue type, Azure Boards a project and work item type, Trello a board and list, Asana a project, ClickUp a list, and GitHub or GitLab issues go in this repo. If you can't tell, name your guess in the question.
3. **Title:** the outcome, in the style of the tracker's recent tickets (for example "Retry a failed renewal once"). **Body:** the problem or goal, what the branch changes with `file:line` evidence, how to verify it, and the branch name. Use the labels or template the team's recent tickets use.
4. **Create it** with the tool from the table (for example Linear's `save_issue` without an id, `gh issue create`, `glab issue create`, `az boards work-item create`), then use the new id or URL in step 8.
5. **If the tool isn't connected,** or it's signed in to a workspace with nowhere that matches this repo, don't file it anywhere else. Say so, give the user the draft title and body to file themselves, and use the id they give back.

## Code hosts

Detect the host from `git remote get-url origin`, and confirm it by which CLI is installed and authenticated. The portable default branch, on any host: `git symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'` (if unset, run `git remote set-head origin --auto` first).

| Host | CLI | Find the open PR for this branch | Read title and body | Create | Update body / title |
| --- | --- | --- | --- | --- | --- |
| GitHub | `gh` | `gh pr view --json number,url` | `gh pr view <n> --json title,body` | `gh pr create --base <default> --title "…" --body-file <f>` | `gh pr edit <n> --body-file <f>` / `--title "…"` |
| GitLab | `glab` | `glab mr view <branch>` | `glab mr view <id> -F json` | `glab mr create --target-branch <default> --title "…" --description-file <f>` | `glab mr update <id> --description-file <f>` / `--title "…"` |
| Bitbucket Cloud | none official; REST API with an API token | `GET /2.0/repositories/{workspace}/{repo}/pullrequests?q=source.branch.name="<branch>"` | `GET …/pullrequests/{id}` (`title`, `description`) | `POST /2.0/repositories/{workspace}/{repo}/pullrequests` | `PUT …/pullrequests/{id}` with `title` / `description` |
| Azure DevOps | `az repos` (azure-devops extension) | `az repos pr list --source-branch <branch> --status active` | `az repos pr show --id <n>` (`title`, `description`) | `az repos pr create --target-branch <default> --title "…" --description "$(cat <f>)"` | `az repos pr update --id <n> --description "$(cat <f>)"` / `--title "…"` |

- **GitLab:** `glab mr create` asks for confirmation unless you pass `-y`. Older `glab` versions have no `--description-file`; pass `--description "$(cat <f>)"` instead. Check `glab mr create --help`.
- **Bitbucket Cloud:** the list endpoint returns open PRs by default. Authenticate with an Atlassian API token that has Bitbucket pull-request scopes, together with your Atlassian email; app passwords are being retired, so check Bitbucket's auth docs if you get a 401. Build the JSON with `jq` so the body file is escaped correctly:
  ```bash
  api=https://api.bitbucket.org/2.0/repositories/<workspace>/<repo>
  curl -sG -u "$BITBUCKET_EMAIL:$BITBUCKET_API_TOKEN" "$api/pullrequests" \
    --data-urlencode 'q=source.branch.name="<branch>"'
  jq -n --arg t "<title>" --rawfile d <f> --arg s "<branch>" --arg b "<default>" \
    '{title: $t, description: $d, source: {branch: {name: $s}}, destination: {branch: {name: $b}}}' \
    | curl -s -u "$BITBUCKET_EMAIL:$BITBUCKET_API_TOKEN" -H 'Content-Type: application/json' \
        -X POST "$api/pullrequests" -d @-
  ```
  Bitbucket Data Center (self-hosted) has a different REST API (`/rest/api/1.0/…`). Check its docs.
- **Azure DevOps:** each value passed to `--description` becomes a new line, so pass the whole file as one quoted value. Link work items with `--work-items <id>` on create, or with `az repos pr work-item add` later (check its `--help`). If `az` rejects a long description, shorten Developer-facing and Notes first, and keep the TL;DR and the QA table.

## Fresh review for other agents

Claude Code runs `/code-review` in a fresh `claude -p` process (SKILL.md step 10). Other agents run their own CLI non-interactively, for example `codex exec "<prompt>"`, `cursor-agent -p "<prompt>"` or `gemini -p "<prompt>"`, from a checkout of the PR's branch, with output redirected to `<scratch>/<branch-slug>.review.md`. Check the CLI's `--help` for the flags that let it read files and run git and the host CLI without prompting. Fill in this prompt, and drop line 5 unless the user owns the PR and wants comments posted:

```text
Review pull request <PR URL> (branch <branch>, base <default>) as an independent reviewer. You did not write this code, and you have no context beyond this prompt.
1. Read AGENTS.md / CLAUDE.md if present, then the change: git fetch origin <default> && git diff origin/<default>...HEAD. Read the changed files in full where the diff isn't enough.
2. Look for correctness bugs, security problems, data loss, broken edge cases, and broken repo rules. Skip style nits and anything a linter would catch.
3. For each finding give: file:line, severity (high / medium / low), what goes wrong and when, and the evidence.
4. Don't edit files, commit, or push.
5. Post each finding as a comment on the PR, on its line where <host CLI or API> allows it.
6. End with the full list of findings, or "No findings".
```

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

1. **Find the dev command and port.** Look at the `dev` script in `package.json` (a `--port` / `-p` flag), a dev target in the `Makefile`, `justfile` or `Procfile`, a `PORT` in `.env`, or the framework default (for example, Next.js 3000, Vite 5173, Rails 3000, Django 8000, and Phoenix 4000).
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
   - Run the framework's local binary with its port flag, for example `./node_modules/.bin/next dev --port $port` or `./node_modules/.bin/vite --port $port`, run in the background. Other stacks take the port the same way, through the repo's runner (`bin/rails server -p $port`, `python manage.py runserver $port`). For a long-running server, prefer the local binary over `bunx` / `npx`. A package-runner wrapper has been seen exiting 0 right after its first request.
4. **One server per directory.** Some frameworks refuse a second dev server in the same directory. Next.js, for example, prints `Another next dev server is already running`. When that happens, reuse the URL it prints, which may be on another port.
5. **Wait for it to be ready**, then `curl` any route once and confirm the server is still listening before you open the browser.
