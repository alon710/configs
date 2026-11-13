---
name: api-first
description: Builds and reviews a project's backend API-first. Every CRUD operation and command is defined once as an API operation with an input schema, output, permission, typed errors and a resource-oriented HTTP route. The OpenAPI spec and API docs are generated from those operations, and server actions, RPC handlers, CLI commands, MCP or agent tools and jobs are 1-2 line wrappers that call them in-process. Covers layering, REST resource design, status codes, errors, versioning, and migrating an existing codebase one domain at a time. Use when starting a new project or backend; when adding, changing or reviewing any create/read/update/delete operation, command, API route, endpoint, server action, RPC or oRPC/tRPC procedure, CLI command, MCP tool or background job; or when designing endpoints or an OpenAPI spec.
---

# API first

Every operation the product can do exists once, as an API operation. Everything else (UI handlers, server actions, RPC, CLI, MCP and agent tools, jobs) is a thin wrapper around it. One definition means one validation path, one permission check, one error shape, and docs that cannot drift from the code.

## Step 0: find the operation layer

1. Read `AGENTS.md`, `CLAUDE.md` and any API doc they link. Where they are stricter, they win.
2. Find the existing operation layer (a router, procedures, an `api/` or `operations/` directory) and add to it. Never start a second one.
3. No layer yet: use a library, not a hand-rolled one. [oRPC](https://orpc.dev/) for TypeScript and Next.js, [FastAPI](https://fastapi.tiangolo.com/) for Python, or the stack's equivalent that generates OpenAPI from typed handlers.

## Operations

- Define each CRUD operation and command once, with an input schema, an output schema, the permission it needs, its typed errors, and an HTTP method and route.
- Generate the OpenAPI spec and the API reference from the operations. Never hand-write them.
- An operation validates input, authorizes, calls services, and maps their failures to typed errors. Nothing more.

## Entry points are wrappers

- Server actions, RPC handlers, CLI commands, MCP and agent tools, and jobs that perform a user-facing operation are 1-2 lines: call the operation in-process and return its result.
- Never call your own API over HTTP from server code.
- No validation, permission check or business logic in a wrapper. If a wrapper needs more, the operation is missing it.

## Layers

`entry points → operations → services → repositories / DB`

- **Operations**: input validation, authorization, error mapping.
- **Services**: business logic. No auth, no input validation, no transport types.
- **Repositories**: data access only.
- Calls go one way, down. A service never imports an operation.

## Resources

- Plural nouns, kebab-case paths, no verbs: `/invoice-items`, not `/getInvoiceItems`.
- Collection: `GET` lists (filtered, sorted, cursor-paginated). `POST` creates and returns `201` with a `Location` header.
- Item: `GET`, `PATCH` (partial update), `DELETE` (`204`). `PUT` only for full replacement.
- Singleton (`/me/avatar`): `GET`, `PUT`, `DELETE`. No `POST`.
- Nest at most one level, and only for ownership: `/projects/{id}/members`. A child with its own id also gets a top-level path: `/members/{id}`.
- `/me` is the current user. Never make a client look up its own id first.
- A "command" that only changes a field is a `PATCH`: archiving is `PATCH /projects/{id}` with `{ "archived": true }`. A real command is `POST /<resource>/{id}/<verb>`: `POST /broadcasts/{id}/send`.
- Reordering is `PUT /<collection>/order` with the full ordered list of ids.
- Filters, sort and pagination go in the query string. Merge one-off getters (`/users/by-email`, `/active-users`) into the list endpoint's filters.

## Conventions

- Status codes: `200`, `201`, `204`, `400`, `401`, `403`, `404`, `409`, `422`, `429`.
- One error format everywhere: `application/problem+json`, or the framework's standard error shape.
- Accept an `Idempotency-Key` header on every `POST` that sends or charges.
- Version under `/v1`. Within a version, change only additively: new endpoints, new optional inputs, new output fields.
- Dates have one serialization policy (for example ISO 8601 in UTC) across every transport.
- Shared code works in every transport. Next.js `updateTag()` runs only inside a server action, so cache invalidation goes through one helper that calls `updateTag` there and `revalidateTag` in a route handler.

## Migrating an existing codebase

1. Move one domain at a time: define its operations, then turn its existing entry points into wrappers.
2. Keep each wrapper's name and signature, so callers and tests do not change.
3. Add a CI check that counts the entry points that bypass the operation layer, against a ceiling that can only go down.
