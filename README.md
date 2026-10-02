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

| Tool                                               | Description                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Bun](https://bun.sh/)                             | Package manager and script runner. Use `bun run <script>`; bare `bun test` runs Bun's own test runner. |
| [Next.js](https://nextjs.org/)                     | React framework: App Router, Turbopack, Cache Components.                                              |
| [TypeScript](https://www.typescriptlang.org/)      | Strict mode, no `any`.                                                                                 |
| [Vercel](https://vercel.com/)                      | Hosting, preview deploys and cron jobs (`vercel.json`).                                                |
| [Neon](https://neon.com/)                          | Serverless Postgres with branching.                                                                    |
| [Drizzle ORM](https://orm.drizzle.team/)           | Type-safe SQL and migrations. The `neon-http` driver has no transactions: use `db.batch`.              |
| [Better Auth](https://www.better-auth.com/)        | Auth with email + password, Google, email OTP and admin roles, via the Drizzle adapter.                |
| [Resend](https://resend.com/)                      | Transactional email API with signed webhooks.                                                          |
| [React Email](https://react.email/)                | Email templates as React components, with a local preview server.                                      |
| [Vercel Blob](https://vercel.com/docs/vercel-blob) | File storage for uploads. Use a private store for user documents.                                      |
| [t3-env](https://env.t3.gg/)                       | Type-safe environment variables, validated with Zod at build time.                                     |
| [Zod](https://zod.dev/)                            | Schema validation for inputs, env vars and LLM output.                                                 |
| [next-intl](https://next-intl.dev/)                | i18n for the App Router.                                                                               |
| [React Hook Form](https://react-hook-form.com/)    | Form state and validation.                                                                             |
| [Zustand](https://github.com/pmndrs/zustand)       | Small client-state store, for persisted browser state only.                                            |
| [AI SDK](https://ai-sdk.dev/)                      | LLM calls, tool use and streaming chat UI.                                                             |
| [AI Gateway](https://vercel.com/docs/ai-gateway)   | One key for every model provider, addressed by `provider/model` slugs.                                 |

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

| Skill                                               | Description                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [create-pr](./skills/create-pr)                     | Opens a PR titled with its issue id, with a user-impact-first body and a manual QA table Claude runs where it's safe. |
| [resolve-pr-issues](./skills/resolve-pr-issues)     | Inventories every PR review thread and comment, verifies each, replies, and resolves.                                 |
| [debug](./skills/debug)                             | Triages a concrete bug report from real logs, DB rows and deploy history to a root cause and a minimal fix.           |
| [vercel-log-debug](./skills/vercel-log-debug)       | Pulls Vercel production error logs, ranks them, traces each to source, and writes a fix report.                       |
| [codebase-audit](./skills/codebase-audit)           | Evidence-backed audit for dead code, duplication, over-abstraction and perf/cost wins; files tickets after approval.  |
| [component-drilldown](./skills/component-drilldown) | Explains, fixes, or consolidates UI components: variants, usages, and repo conventions.                               |
| [demo-video](./skills/demo-video)                   | Product demo videos as code: HTML recreating the real UI, a pure `seek(t)` on a beat grid, rendered to MP4.           |
