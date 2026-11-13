### General Applications

| Application                                               | Description                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| [Vscode](https://code.visualstudio.com/Download)          | Customizable code editor with extensive plugin support.           |
| [Discord](https://discord.com/)                           | Platform for voice, video, and text communication.                |
| [Stremio](https://www.stremio.com/)                       | Media center for streaming movies and series.                     |
| [Arc Browser](https://arc.net/)                           | Modern Chromium based web browser.                                |
| [Docker](https://www.docker.com/products/docker-desktop/) | Tool for developing and running applications in containers.       |
| [Oh-My-Zsh](https://ohmyz.sh/#install)                    | Framework for managing Zsh configuration with plugins and themes. |
| [Httpie](https://httpie.io/desktop)                       | A Postman alternative                                             |

### Browser Extensions

| Extension                                                                                            | Description                               |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [JSON Viewer](https://chromewebstore.google.com/detail/json-viewer/gbmdgpbipfallnflgajpaliibnhdgobh) | Visualizes JSON responses in browsers.    |
| [Vimium](https://chromewebstore.google.com/detail/vimium/dbepggeogbaibhgnhhndojpepiihcmeb)           | Provides keyboard navigation in browsers. |

### Mac-specific Tools

| Tool                                                               | Description                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| [Warp](https://app.warp.dev/get_warp)                              | Speedy, efficient terminal emulator.                    |
| [Raycast](https://www.raycast.com/)                                | Command center for quick tool access and control.       |
| [Rectangle](https://rectangleapp.com/)                             | Window management app with keyboard shortcuts.          |
| [Altab](https://alt-tab-macos.netlify.app/)                        | Windows-style “Alt-Tab” window switcher for macOS.      |
| [MonitorControl](https://github.com/MonitorControl/MonitorControl) | Control external monitor settings from macOS.           |
| [Metting Bar](https://meetingbar.app/)                             | MeetingBar is a menu-bar app for your calendar meetings |

### Web App Stack

| Tool                                               | Description                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Bun](https://bun.sh/)                             | Package manager and script runner. Use `bun run <script>`; bare `bun test` runs Bun's own test runner.            |
| [Next.js](https://nextjs.org/)                     | React framework: App Router, Turbopack, Cache Components.                                                         |
| [TypeScript](https://www.typescriptlang.org/)      | Strict mode, no `any`.                                                                                            |
| [Vercel](https://vercel.com/)                      | Hosting, preview deploys and cron jobs (`vercel.json`).                                                           |
| [Neon](https://neon.com/)                          | Serverless Postgres with branching.                                                                               |
| [Drizzle ORM](https://orm.drizzle.team/)           | Type-safe SQL and migrations. The `neon-http` driver has no transactions: use `db.batch`.                         |
| [Better Auth](https://www.better-auth.com/)        | Auth with email + password, Google, email OTP and admin roles, via the Drizzle adapter.                           |
| [Resend](https://resend.com/)                      | Transactional email API with signed webhooks.                                                                     |
| [React Email](https://react.email/)                | Email templates as React components, with a local preview server.                                                 |
| [Vercel Blob](https://vercel.com/docs/vercel-blob) | File storage for uploads. Use a private store for user documents.                                                 |
| [t3-env](https://env.t3.gg/)                       | Type-safe environment variables, validated with Zod at build time.                                                |
| [Zod](https://zod.dev/)                            | Schema validation for inputs, env vars and LLM output.                                                            |
| [oRPC](https://orpc.dev/)                          | API-first routes with a generated OpenAPI spec; Server Actions call them in-process. See [API First](#api-first). |
| [next-intl](https://next-intl.dev/)                | i18n for the App Router.                                                                                          |
| [React Hook Form](https://react-hook-form.com/)    | Form state and validation.                                                                                        |
| [Zustand](https://github.com/pmndrs/zustand)       | Small client-state store, for persisted browser state only.                                                       |
| [AI SDK](https://ai-sdk.dev/)                      | LLM calls, tool use and streaming chat UI.                                                                        |
| [AI Gateway](https://vercel.com/docs/ai-gateway)   | One key for every model provider, addressed by `provider/model` slugs.                                            |

### API First

Every project is API first: the REST API is the spec, and the UI is one of its clients. The app, the REST API and the docs all run the same code.

- **Each operation is one documented route.** Define every CRUD operation and command once with oRPC: `.route({ method, path, tags, summary })`, `.input(zod)`, `.output(zod)`, `.handler(({ context, input }) => module(context.ctx, input))`. Business logic lives in plain modules (`server/modules/*`) that take a context and check permissions; a route only validates, calls a module and returns.
- **Server Actions call the routes.** Each action is one line in a `"use server"` file, calling the route in-process with the session's context, never over HTTP: `export const renameProjectAction = mutation(projects.rename)`. Actions and UI handlers never get their own validation or logic. `mutation()` also calls `refresh()`; both return `{ ok, data } | { ok: false, error }`.
- **One public spec lists every operation.** Generate it from the routes (`OpenAPIGenerator` + `ZodToJsonSchemaConverter` from `@orpc/zod/zod4`), never by hand. Commit it, check it for drift in CI, serve it at `/api/v1/openapi.json` with one public API reference page, and generate typed clients (CLI, SDKs) from it. Operations only the UI calls are in it too, and each says who may call it. The docs gate nothing: each operation's own auth decides access, so there is no public-vs-internal split.
- **One base builder per kind of caller:** `pub` (anyone), `authed` (signed in), and one that takes a permission for staff. Attach the security scheme, the shared error responses and who may call the route to their middleware with `customOpenAPIOperation`, so every route documents them.
- **Less code, fewer bugs.** Prefer one generic route or table with a type field over N copies.
- **One error shape.** Modules throw your own error class; map it to `ORPCError` in one `clientInterceptors` entry and encode one body (`{ error: { code, message } }`) with `customErrorResponseBodyEncoder`.
- **Always set `.output()`.** It is validated and unknown keys are stripped, so the schema is exactly what clients get. Use `z.date()` for timestamps.
- **Every operation shows its response in the docs.** The spec carries a response schema for every operation, so the API reference renders its fields and an example; a response that shows `null` is a bug. `.output()` gives this for free. In a codebase that has no output schemas, generate the response schemas from each operation's TypeScript return type at build time (the compiler over `InferRouterOutputs<typeof router>`, named types as `components/schemas`) and merge them into the spec. Never hand-write a response schema or example.
- **Inputs are compact:** path params plus the JSON body (or the query string for `GET`) arrive as one object. A non-GET route that reads the query string needs `inputStructure: "detailed"`.
- **Contract test:** replay every route against recorded, normalized responses, so a refactor can't change the public API by accident.

#### Resources

- **CRUD only, plural nouns.** Collection: `GET`, `POST`. Item: `GET`, `PATCH`, `PUT`, `DELETE`. Singleton (`/me/avatar`): `GET`, `PUT`, `DELETE`.
- **A status change is a `PATCH`** on the resource (`{ status }`, `{ published }`), never a `/publish` or `/cancel` route.
- **Duplicating is a create:** `POST /things { copyFrom: id }`.
- **Only real side effects are commands:** `POST /things/{id}/<verb>` for send, retry, stop, test, refund, run.
- **One list per collection.** A narrower view of the same rows is a query parameter on the list (`?status=running`, `?select=ids`, `?include=conditions`, `?parentId=`), never a sibling route (`/active`, `/ids`, `/with-conditions`, the same children listed under two parents). A second route is right only when the shape or the audience differs: a public read model next to the staff list, or an aggregate.
- **Per-user routes live once** at `/users/{userId}/…`, and `userId` may be `me`. No `/me/…` twin of a `/users/{userId}/…` route; `/me/…` is only for what exists for the caller alone.

#### Shared concerns

One route each, never one per resource:

- **Access:** one `GET /me/access` returns the role, plan, permissions and feature flags, computed from one registry of checks. No per-feature availability routes.
- **Events:** one `POST /events` and one `events` table (`type`, the actor as a user or a guest, the subject, `metadata`, `created_at`). No per-resource click or view routes, counter columns or per-feature event tables. Derive counts with a query, so every event keeps who did it, when, and its metadata.
- **Pickers:** one `GET /<resource>/options` per resource, filtered by the query string. No picker routes under other resources.
- **Search:** one `POST /<resource>/search` per resource, taking `{ filters, select }`. No route per projection (ids, emails, rows).

### UI Libraries

| Tool                                                        | Description                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| [shadcn/ui](https://ui.shadcn.com/)                         | Copy-in components you own and restyle.                             |
| [Base UI](https://base-ui.com/)                             | Unstyled, accessible primitives under shadcn/ui (instead of Radix). |
| [Tailwind CSS](https://tailwindcss.com/)                    | v4 utility CSS on semantic design tokens.                           |
| [cva](https://cva.style/)                                   | Typed component variants.                                           |
| [tailwind-merge](https://github.com/dcastil/tailwind-merge) | Merges Tailwind classes without conflicts (shadcn's `cn`).          |
| [Lucide](https://lucide.dev/)                               | Outline icon set.                                                   |
| [Motion](https://motion.dev/)                               | Animation. Use `LazyMotion` + `m.*` to keep the bundle small.       |
| [dnd-kit](https://dndkit.com/)                              | Accessible drag-and-drop and sortable lists.                        |
| [Tiptap](https://tiptap.dev/)                               | Rich-text editor on ProseMirror.                                    |
| [Serwist](https://serwist.pages.dev/)                       | PWA service worker (`@serwist/turbopack`).                          |
| [Rybbit](https://github.com/rybbit-io/rybbit)               | Privacy-friendly web analytics.                                     |

### Testing

| Tool                                               | Description                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| [Vitest](https://vitest.dev/)                      | Test runner, split into node, jsdom and database projects.        |
| [Testing Library](https://testing-library.com/)    | Render and query components the way users do.                     |
| [jest-axe](https://github.com/nickcolley/jest-axe) | Automated WCAG checks in component tests.                         |
| [PGlite](https://pglite.dev/)                      | Postgres in WASM, in-process: real-database tests without Docker. |

### Code Quality & CI

| Tool                                                                                           | Description                                                                 |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Prettier](https://prettier.io/)                                                               | Code formatter.                                                             |
| [ESLint](https://eslint.org/)                                                                  | Linter (flat config).                                                       |
| [eslint-plugin-jsx-a11y](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y)                 | Accessibility lint rules for JSX.                                           |
| [eslint-plugin-simple-import-sort](https://github.com/lydell/eslint-plugin-simple-import-sort) | Auto-sorted imports.                                                        |
| [eslint-plugin-unused-imports](https://github.com/sweepline/eslint-plugin-unused-imports)      | Removes unused imports.                                                     |
| [@shadcn/lint](https://github.com/shadcn-ui/lint)                                              | Design-system lint: no raw colors, arbitrary values or restyled components. |
| [knip](https://knip.dev/)                                                                      | Finds unused files, exports and dependencies.                               |
| [commentless](https://github.com/barad-side-hustle/commentless)                                | Strips prose comments; `--check` fails CI on any that remain.               |
| [next-intl-validator](https://www.npmjs.com/package/next-intl-validator)                       | Finds missing and unused translation keys.                                  |
| [React Doctor](https://github.com/millionco/react-doctor)                                      | React health scan: security, performance, correctness, accessibility.       |
| [ShadScan](https://github.com/TheOrcDev/shadscan)                                              | shadcn/ui audit with a `--fail-under` score gate.                           |
| [GitHub Actions](https://github.com/features/actions)                                          | CI: one job per gate, actions pinned by commit SHA.                         |
| [Blacksmith](https://www.blacksmith.sh/)                                                       | Drop-in GitHub Actions runners.                                             |
| [actionlint](https://github.com/rhysd/actionlint)                                              | Workflow syntax checker.                                                    |
| [zizmor](https://github.com/zizmorcore/zizmor)                                                 | Security audit for GitHub Actions workflows.                                |
| [TruffleHog](https://github.com/trufflesecurity/trufflehog)                                    | Scans git history for leaked secrets.                                       |
| [AGENTS.md](https://agents.md/)                                                                | One instructions file for every coding agent (Claude Code, Codex, Cursor).  |

### Agent Skills

Reusable [Agent Skills](https://docs.claude.com/en/docs/claude-code/skills) for Claude Code, Codex and Cursor, in [`skills/`](./skills). Each skill discovers project specifics (package manager, default branch, issue tracker, design tokens) at runtime instead of hardcoding them.

Install one, or all of them, with the [skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add alon710/configs --list              # see what's here
npx skills add alon710/configs -s create-pr -g     # one skill, user-level
npx skills add alon710/configs -s '*' -g           # everything
```

| Skill                                               | Description                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [create-pr](./skills/create-pr)                     | Opens a PR titled with its issue id and a QA table Claude runs, then has a fresh agent review it and resolves every comment.                |
| [resolve-pr-issues](./skills/resolve-pr-issues)     | Inventories every PR review thread and comment, verifies each, replies, and resolves.                                                       |
| [debug](./skills/debug)                             | Triages a concrete bug report from real logs, DB rows and deploy history to a root cause and a minimal fix.                                 |
| [vercel-log-debug](./skills/vercel-log-debug)       | Pulls Vercel production error logs, ranks them, traces each to source, and writes a fix report.                                             |
| [codebase-audit](./skills/codebase-audit)           | Evidence-backed audit for dead code, duplication, over-abstraction and perf/cost wins; files tickets after approval.                        |
| [component-drilldown](./skills/component-drilldown) | Explains, fixes, or consolidates UI components: variants, usages, and repo conventions.                                                     |
| [demo-video](./skills/demo-video)                   | Product demo videos as code: HTML recreating the real UI, a pure `seek(t)` on a beat grid, rendered to MP4.                                 |
| [design-variants](./skills/design-variants)         | Builds 4-5 genuinely different UI/UX variants of a section in the project's own design system, with real content, then implements the pick. |
