# Reference

## Investigation map

Start from whatever the user gave you and work inward. Directory names vary by stack, so check the repo's `AGENTS.md` / `CLAUDE.md` layout section first.

| You were given | Start here |
|---|---|
| UI text or a screenshot | grep the string in the locale or message files (`messages/`, `locales/`, `i18n/`, or the JSX itself if the app isn't localized) → take the key → grep the key across the source tree |
| A URL path | the router's directory for that path (`app/` or `pages/` in Next.js, `routes/` in Remix or SvelteKit, the route config in an SPA). Note which layout or shell (admin vs end user) the path renders in |
| A domain noun | the feature module named after it (a `features/`, `modules/`, or `domains/` folder): its server actions or handlers, components (admin variants are often separate), hooks, constants |
| "It doesn't save" / "it saved wrong" | the mutation handler (server action, API route, resolver) → the data-access layer → the schema |
| An email didn't arrive | the email library wrapper, the code path that triggers the send, the provider's webhook handler (bounces, complaints), and any cron that batches sends |
| A cron or background job | the scheduler config (`vercel.json`, a GitHub Actions `schedule:`, a queue worker, `crontab`) → the handler it calls |
| Auth or redirect weirdness | the middleware or edge-proxy file (its name varies by framework version, so check `AGENTS.md`), then the auth library config |
| A payment problem | the route that creates the checkout session or URL, the return / verify route, and the provider's webhook handler |
| A form field behaving oddly | the form renderer and the per-field-type components |

Useful passes:

- `git log -S'<symbol>' --oneline -- <path>`: when this changed, and why. Commit messages carry the reasoning, especially in repos that strip or discourage code comments.
- `gh pr list --search '<term>' --state all`: has this been attempted before?
- Check `AGENTS.md` / `CLAUDE.md` for the convention the fix must follow before you propose the fix.

## Choosing label, status, priority

**Label** (exactly one, mapped to the workspace's own names from `list_issue_labels`):

- Bug: existing behaviour is wrong or broken.
- Feature: a capability that does not exist yet.
- Improvement: it works, but it should work better. Polish, consistency sweeps, refactors, and closing gaps in an already-shipped pattern all count.

**Priority**: set it only when the evidence supports it. Otherwise leave it at `0` (None) and say why.

- `1` Urgent: money lost, data lost, or a user-facing path is dead (for example, customers charged and never upgraded).
- `2` High: broken for a real segment of users, with no workaround.
- `3` Medium: a visible defect with a workaround.
- `4` Low: cosmetic, or cleanup.

**Status**: the team's first `unstarted` status by default, or a `backlog`-type status when the user is parking it.

## Worked example: a bug

Note the shape. It goes from the symptom, to *why it looks intermittent but isn't*, to the exact line that clobbers state, to a fix that mirrors a guard already in the file.

```markdown
On the admin users page, submitting the email-list filter does not show the table skeleton
while the query is in flight. The table falls back to the empty/no-results state for the whole
duration, so it looks like **"no users found" until results pop in**.

## Repro

1. Go to `/admin/users`
2. Search, filter, or page first (this matters — see below)
3. Open the load-users popover and submit a list of emails
4. No skeleton — the table shows the empty state until the request resolves

Looks intermittent, but it's deterministic: it only reproduces when any of `searchTerm`,
`filters`, `activePresetId`, `hasSearched`, or `currentPage !== 1` is non-default at submit
time. On a pristine page load the skeleton *does* appear.

## Root cause

The wiring is correct — `DataTable` renders the skeleton off `loading`
(`src/components/data-table.tsx:204-219`). Something clears it before the `await` resolves.

`handleToggleCustomList` (`users-page.tsx:466-474`) wipes the prior query state in the same
batch. Those writes change the dependency array of the debounced-search effect at
`users-page.tsx:239-263`, which re-runs after commit and unconditionally clobbers `loading`:

    251      : { ...prev, loading: false }   // <-- kills the in-flight email-list load

The effect can't distinguish "no search term because the user cleared it" from "no search term
because we're in email-list mode" — it lacks a `customListMode` early return.

## Same defect

`loadCustomListPage` (`users-page.tsx:541-567`) — paging in custom-list mode changes
`currentPage`, rebuilds `performSearch`, re-fires the effect.

## Suggested fix

Add `if (customListMode) return;` at the top of the effect at `users-page.tsx:240`,
mirroring the guard already present in the filters effect (`:324`) and in
`loadUsersWithFilters` (`:266`). And/or drop the bare `{ ...prev, loading: false }`
else-branch at `:251` so the effect never clears a loading flag it didn't set.

## Files

* `src/admin/users/users-page.tsx`
* `src/admin/users/load-users-popover.tsx`
* `src/components/data-table.tsx`
```

## Worked example: a feature (abridged)

The moves worth copying: prove the premise by finding the **single writer**, surface the blocker that invalidates the obvious approach *before* the work items, make each work item name its file, and give the hazards their own section.

```markdown
Customers who complete payment at the provider but close the browser before landing on the
return URL are **charged and never upgraded**, and we never even learn the charge happened.

## The premise is confirmed

`updateSubscription` (`src/billing/update-subscription.ts:16-156`) is the **single writer**
that activates a plan. It has exactly two real callers: … **A paid transaction becomes a plan
only if the browser returns and POSTs to** `/api/checkout/verify`.

### Today there is no safety net

* No webhook of any kind. `src/app/api/webhooks/` has only `email/` and a stub.
* No reconciliation cron. The scheduler config has 7 crons; the only payment-adjacent one
  *removes* access.

## Hard blocker to solve first: we can't identify the user

Nothing the provider sends back carries a user id. The order reference is literally the plan id
(`use-checkout.ts:170`) — not unique per attempt; the user-id field is hard-coded empty
(`checkout-url/route.ts:110`). So step one is embedding the user id at sign time.

## Work items

1. **Embed identity at sign time** — `checkout-url/route.ts`: populate the user-id and custom fields…
2. **Extract a session-free verifier.** `verifyPaymentAndUpdateSubscription` (`verify.ts:282-504`)
   calls `requireAuth()` (:300), a request-scoped translation helper (:283), path revalidation,
   and — via a rewards hook — `cookies()`. None of that works in a webhook.
3. **New route** `src/app/api/webhooks/payment/route.ts` — copy the auth pattern from
   `src/app/api/webhooks/email/route.ts:7-18`. Add `PAYMENT_WEBHOOK_SECRET` to the env
   schema — required, not optional, per the repo's env-var rule.

## Idempotency — what a webhook must respect

**The check-then-insert is not atomic.** Insert with on-conflict-do-nothing on a unique
transaction id — the same pattern already used for `payouts.dedupe_key` in
`src/rewards/qualify.ts:69`. Do **not** use a cache-invalidation API in the webhook path that
only works inside a user request; `update-subscription.ts:147` already uses the variant that
is safe outside one.

## Also worth adding

* A reconciliation cron as a second safety net.
* An admin screen for "paid but not granted".

## Existing config

`env.ts:34-38`, all required: `PAYMENT_MERCHANT_ID`, … No payment webhook secret exists yet.
```

## Filing call

```ts
save_issue({
  team: '<team key or name from list_teams>',
  title: '…',
  description: '…',              // literal newlines, not \n escapes
  labels: ['<one type label>'],  // exactly one, from list_issue_labels
  state: '<status from list_issue_statuses>',
  priority: 2,                   // omit or 0 when the evidence doesn't support one
  // project: '<name>'           // only when exactly one active project was resolved
})
```

Then call `get_issue({ id: '<PREFIX>-<n>' })` to read back `gitBranchName` (shaped like `<user>/<prefix>-<n>-<slug>`), and hand it to the user with the URL.

## Gotchas

- If `list_teams` returns teams that have nothing to do with the repo, you are authenticated as a different user or workspace. Stop and say so rather than filing anywhere.
- Linear renders GitHub-flavoured Markdown. Fenced or indented code blocks with line-number prefixes are fine, and they read well for "here is the offending line".
- On an update, `save_issue`'s `labels` replaces the whole label set. Use `addLabels` / `removeLabels` for incremental changes.
- Once a PR lands with `(<PREFIX>-<n>)` in its title, Linear auto-attaches it and moves the issue. Don't hand-set the done status.
