# Reference

The helper script covers GitHub. This file has the same workflow for GitLab, Bitbucket Cloud, and Azure DevOps: inventory, reply, resolve, ledger, and verify. It also lists what the script calls on GitHub, for when it can't run.

`<reply-dir>` is the git-ignored drafts directory from SKILL.md step 2. Save every inventory, draft, and payload there.

## Posting safely by hand

On GitHub the script enforces these gates. On the other hosts, apply them yourself, one thread at a time:

1. **Draft.** Write the reply to `<reply-dir>/<thread-id>.md`. Never put reply text inline in a shell command.
2. **Check the draft.** It must not be empty (`[ -s <reply-dir>/<thread-id>.md ]`). If `<reply-dir>` is inside the repo, `git check-ignore -q <reply-dir>/<thread-id>.md` must succeed. A `mktemp -d` directory outside the repo needs no ignore check.
3. **Build the payload with `jq`**, which escapes quotes, backticks, and newlines. Each host section shows the shape. If `jq` is missing, build the same JSON with `node -e` and `JSON.stringify`, never by string concatenation.
4. **Preview (the dry run).** Re-fetch the target thread by its id from this PR/MR, then print its id, file and line, the first comment's author and opening line, and the payload. Nothing is posted in this step.
5. **Confirm.** Post only if the re-fetched thread belongs to this PR/MR, is the one the draft answers, and the payload is the text you reviewed. Take the id from the preview output, not from memory. This is the manual form of the script's `--confirm RESOLVE:<thread-id>`.
6. **Reply, then resolve.** If the reply call fails, stop and don't resolve.

Keep tokens out of output and out of files. Reference them only through variables the user exported.

## GitHub (what the script calls)

- `inventory`: `gh api --paginate --slurp repos/<owner>/<repo>/issues/<n>/comments` (top-level comments), `gh api --paginate --slurp repos/<owner>/<repo>/pulls/<n>/reviews` (review summaries), and the GraphQL `pullRequest.reviewThreads` connection with every comment in each thread.
- `reply-resolve`: the GraphQL mutations `addPullRequestReviewThreadReply`, then `resolveReviewThread`.
- `verify`: re-reads `reviewThreads` and fails if any has `isResolved: false`.

If neither `node` 22.18+ nor `bun` is available, make the same calls with `gh api` and follow "Posting safely by hand".

## GitLab

**Setup.** Check `glab auth status`. `glab api` replaces `:id` with the current project, so the calls below work on gitlab.com and on self-hosted instances from inside the clone. `<iid>` is the MR number (`!123` is iid 123). Resolving a thread needs the Developer role or higher, or being the MR author.

**Find the MR and its head.**
```bash
glab api "projects/:id/merge_requests?source_branch=<branch>&state=opened"
glab api "projects/:id/merge_requests/<iid>"   # target_branch, source_branch, sha (head commit), web_url
```

**Inventory.** Discussions cover diff threads, threads, and plain MR comments.
```bash
glab api --paginate "projects/:id/merge_requests/<iid>/discussions?per_page=100" | jq -s 'add' > <reply-dir>/inventory.json
```
- `jq -s 'add'` joins the pages whether `glab` prints one array or one per page.
- Each discussion has an `id` and `notes[]`. Skip notes with `system: true` (pushes, label changes).
- A discussion is open when any note has `resolvable: true` and `resolved: false`.
- Diff notes carry `position` (`new_path`, `new_line`, `old_line`, `head_sha`). When `head_sha` differs from the MR's `sha`, the note was written on an older commit. Verify it against the current head anyway.
- These go in the ledger, because they have no resolve control:
  ```bash
  jq '[.[] | select(all(.notes[]; .system | not) and all(.notes[]; .resolvable | not)) | {id, body: .notes[0].body}]' <reply-dir>/inventory.json
  ```

**Reply.**
```bash
glab api "projects/:id/merge_requests/<iid>/discussions/<discussion-id>"   # preview: fails if the discussion isn't on this MR
jq -n --rawfile body <reply-dir>/<discussion-id>.md '{body: $body}' > <reply-dir>/<discussion-id>.json
glab api -X POST "projects/:id/merge_requests/<iid>/discussions/<discussion-id>/notes" --input <reply-dir>/<discussion-id>.json
```

**Resolve.**
```bash
glab api -X PUT "projects/:id/merge_requests/<iid>/discussions/<discussion-id>?resolved=true"
```

**Ledger.**
```bash
jq -n --rawfile body <reply-dir>/ledger.md '{body: $body}' > <reply-dir>/ledger.json
glab api -X POST "projects/:id/merge_requests/<iid>/notes" --input <reply-dir>/ledger.json
```
If the new ledger note comes back with `resolvable: true`, resolve its discussion too, so it doesn't block a merge that requires resolved threads.

**Verify.** This must print `[]`:
```bash
glab api --paginate "projects/:id/merge_requests/<iid>/discussions?per_page=100" | jq -s 'add' \
  | jq '[.[] | select(any(.notes[]; .resolvable and (.resolved | not) and (.system | not))) | {id, path: .notes[0].position.new_path, line: .notes[0].position.new_line}]'
```

## Bitbucket Cloud

**Setup.** There is no official CLI, so use `curl` against the REST API. Take `<workspace>` and `<repo>` from the remote (`git@bitbucket.org:<workspace>/<repo>.git` or `https://bitbucket.org/<workspace>/<repo>.git`). Below:
- `<base>` is `https://api.bitbucket.org/2.0/repositories/<workspace>/<repo>`.
- `<id>` is the pull request id.
- `<auth>` is the user's credential, for example `-u "<atlassian-email>:$BB_TOKEN"` for an Atlassian API token, or `-H "Authorization: Bearer $BB_TOKEN"` for a repository or workspace access token. `BB_TOKEN` stands for whatever variable the user exported. Atlassian is replacing app passwords with API tokens. If a call returns 401 or 403, check Bitbucket's authentication docs for the token type and scopes the workspace needs.

**Find the PR and its head.**
```bash
curl -sS --fail-with-body <auth> -G "<base>/pullrequests" --data-urlencode 'q=source.branch.name="<branch>"' --data-urlencode 'state=OPEN'
curl -sS --fail-with-body <auth> "<base>/pullrequests/<id>"   # destination.branch.name, source.branch.name, source.commit.hash, links.html.href, participants[].state
```

**Inventory.** Responses are paged. Follow `next` until it's gone. Use `printf`, not `echo`, so the JSON passes through unchanged.
```bash
url="<base>/pullrequests/<id>/comments?pagelen=50"; while [ -n "$url" ]; do page=$(curl -sS --fail-with-body <auth> "$url") || { echo "FAILED: $url" >&2; break; }; printf '%s' "$page" | jq '.values'; url=$(printf '%s' "$page" | jq -r '.next // empty'); done | jq -s 'add' > <reply-dir>/comments.json
```
Run the same loop on `<base>/pullrequests/<id>/tasks?pagelen=50` into `<reply-dir>/tasks.json`. A `FAILED:` line means the inventory is incomplete. Fix the cause and run it again.
- A comment has `id`, `content.raw`, `user`, `deleted`, `links.html.href`, `inline` (`path`, `to`, `from`) when it's on a line, `parent.id` when it's a reply, and `resolution` once its thread is resolved.
- A thread is a top-level comment (no `parent`) plus its replies. A reply's `parent` can be another reply, so walk up to the top-level comment. Skip `deleted: true`.
- A task has `id`, `state` (`UNRESOLVED` or `RESOLVED`), and `content.raw`.
- `participants[].state` of `changes_requested` has no text. Report it; only the reviewer can clear it.

**Reply.** Reply to the thread's top-level comment.
```bash
curl -sS --fail-with-body <auth> "<base>/pullrequests/<id>/comments/<comment-id>"   # preview: must exist, have no parent, and not be deleted
jq -n --rawfile body <reply-dir>/<comment-id>.md --argjson parent <comment-id> '{content: {raw: $body}, parent: {id: $parent}}' > <reply-dir>/<comment-id>.json
curl -sS --fail-with-body <auth> -X POST -H 'Content-Type: application/json' --data @<reply-dir>/<comment-id>.json "<base>/pullrequests/<id>/comments"
```

**Resolve.** Only a top-level comment can be resolved (403 otherwise). 409 means it's already resolved.
```bash
curl -sS --fail-with-body <auth> -X POST "<base>/pullrequests/<id>/comments/<comment-id>/resolve"
```
Mark a task done once it's fixed. For a declined task, give the reason on its comment thread or in the ledger first.
```bash
curl -sS --fail-with-body <auth> -X PUT -H 'Content-Type: application/json' --data '{"state":"RESOLVED"}' "<base>/pullrequests/<id>/tasks/<task-id>"
```

**Ledger.** Usually nothing needs it, since every top-level comment can be resolved. Post one only for items the resolve call refused.
```bash
jq -n --rawfile body <reply-dir>/ledger.md '{content: {raw: $body}}' > <reply-dir>/ledger.json
curl -sS --fail-with-body <auth> -X POST -H 'Content-Type: application/json' --data @<reply-dir>/ledger.json "<base>/pullrequests/<id>/comments"
```

**Verify.** Re-run both inventory loops into `comments-after.json` and `tasks-after.json`. Both filters must print `[]`, apart from the ledger comment's own id:
```bash
jq '[.[] | select((.parent | not) and (.deleted | not) and (.resolution | not)) | {id, path: .inline.path, line: .inline.to}]' <reply-dir>/comments-after.json
jq '[.[] | select(.state == "UNRESOLVED") | {id, task: .content.raw}]' <reply-dir>/tasks-after.json
```

Bitbucket Data Center (self-hosted) has a different API. Check its REST docs for the comment and task endpoints.

## Azure DevOps

**Setup.** Take `<org>`, `<project>`, and `<repo>` from the remote:
- `https://dev.azure.com/<org>/<project>/_git/<repo>` (sometimes with a `<org>@` prefix)
- `git@ssh.dev.azure.com:v3/<org>/<project>/<repo>`
- `https://<org>.visualstudio.com/<project>/_git/<repo>` or `<org>@vs-ssh.visualstudio.com:v3/<org>/<project>/<repo>` (older URLs; `https://dev.azure.com/<org>` reaches the same organization)

Keep a project name's URL encoding (`%20`) as it appears in the remote. Below:
- `<base>` is `https://dev.azure.com/<org>/<project>/_apis/git/repositories/<repo-id>/pullRequests/<id>`. Use `repository.id` from `az repos pr show --id <id>` as `<repo-id>`.
- `<auth>` is `-u ":$AZURE_DEVOPS_EXT_PAT"` for a personal access token, or `-H "Authorization: Bearer $(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv)"` after `az login`.

`az devops invoke --area git --resource <resource> --route-parameters project=<project> repositoryId=<repo-id> pullRequestId=<id> --api-version 7.1` wraps the same calls, with `--http-method` and `--in-file` for writes. List the resource names with `az devops invoke --query "[?area=='git']" -o table`, and check `az devops invoke --help` for the route parameters each one needs.

**Find the PR and its head.**
```bash
az repos pr list --source-branch <branch> --status active
az repos pr show --id <id>   # targetRefName, sourceRefName, lastMergeSourceCommit.commitId, repository.id
```
Add `--org https://dev.azure.com/<org> --project <project>` if `az devops configure --defaults` doesn't set them.

**Inventory.**
```bash
curl -sS --fail-with-body <auth> "<base>/threads?api-version=7.1" > <reply-dir>/inventory.json
jq '.count == (.value | length)' <reply-dir>/inventory.json   # should print true
```
- A thread has `id`, `status`, `isDeleted`, `threadContext` (`filePath`, `rightFileStart.line`; null for a general comment), and `comments[]` (`id`, `parentCommentId`, `author.displayName`, `content`, `commentType`, `isDeleted`).
- Skip deleted threads, and threads whose comments are all `commentType: "system"` (votes, pushes, policy updates):
  ```bash
  jq '[.value[] | select((.isDeleted | not) and any(.comments[]; .commentType != "system")) | {id, status, path: .threadContext.filePath, first: .comments[0].content}]' <reply-dir>/inventory.json
  ```
- `active` and `pending` are open. `fixed`, `wontFix`, `closed`, and `byDesign` are resolved. A thread with no status is a plain comment: reply to it, and give it a status when you resolve it.

**Reply.** `parentCommentId` is the `id` of the thread's first comment, usually 1.
```bash
curl -sS --fail-with-body <auth> "<base>/threads/<thread-id>?api-version=7.1"   # preview: fails if the thread isn't on this PR
jq -n --rawfile body <reply-dir>/<thread-id>.md --argjson parent <first-comment-id> '{content: $body, parentCommentId: $parent, commentType: 1}' > <reply-dir>/<thread-id>.json
curl -sS --fail-with-body <auth> -X POST -H 'Content-Type: application/json' --data @<reply-dir>/<thread-id>.json "<base>/threads/<thread-id>/comments?api-version=7.1"
```

**Resolve.** Set the status that matches the disposition: `fixed` for a fix, `wontFix` for a decline (or `byDesign` when the code works as intended), and `closed` for already-addressed or informational items.
```bash
curl -sS --fail-with-body <auth> -X PATCH -H 'Content-Type: application/json' --data '{"status":"fixed"}' "<base>/threads/<thread-id>?api-version=7.1"
```
The API also takes the numbers: `active` 1, `fixed` 2, `wontFix` 3, `closed` 4, `byDesign` 5, `pending` 6.

**Ledger.** Every thread has a status, so usually nothing needs it. When something does, post it as a new thread that is already closed, so it doesn't block a comment-resolution policy:
```bash
jq -n --rawfile body <reply-dir>/ledger.md '{comments: [{parentCommentId: 0, content: $body, commentType: 1}], status: "closed"}' > <reply-dir>/ledger.json
curl -sS --fail-with-body <auth> -X POST -H 'Content-Type: application/json' --data @<reply-dir>/ledger.json "<base>/threads?api-version=7.1"
```

**Verify.** This must print `[]`:
```bash
curl -sS --fail-with-body <auth> "<base>/threads?api-version=7.1" \
  | jq '[.value[] | select((.isDeleted | not) and (.status == "active" or .status == "pending") and any(.comments[]; .commentType != "system")) | {id, path: .threadContext.filePath, line: .threadContext.rightFileStart.line}]'
```

Azure DevOps Server (on-premises) uses the same thread API under its collection URL (`https://<server>/<collection>/<project>/_apis/...`). Check which `api-version` the server supports.
