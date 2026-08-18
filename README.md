# StatusFrame

StatusFrame is a lightweight, extension-first public status page framework.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/viasnake/StatusFrame)

It is not an uptime dashboard. The core rule is:

```text
Do not publish your infrastructure.
Publish your service status.
```

The minimal deployment renders a public status page and `/api/status` from static, public-safe component state. Monitoring, incidents, maintenance, metrics, notifications, storage, and admin APIs are optional extensions that use the same interface as third-party extensions.

## What Is Implemented

- pnpm monorepo with a Cloudflare Worker app.
- TypeScript config schema and YAML parser.
- Public projection and leakage validation.
- Server-rendered public status page.
- `/api/status`, `/api/incidents`, and `/api/maintenance` public routes.
- Extension registry and manifest validation.
- Core scheduled runner with concurrency and budget enforcement.
- Static, memory, and D1 storage adapters.
- Official HTTP and TCP monitor extensions.
- Scaffolded DNS and TLS monitor extensions.
- Incident, maintenance, metrics, webhook notification, and admin API extensions.
- Example YAML configs and focused Vitest coverage.

## Deploy to Cloudflare

Use the button above to create your own copy of StatusFrame and deploy it with Cloudflare Workers Builds.

Cloudflare reads the root `wrangler.jsonc`, provisions the declared D1 database and binding for the target account, and deploys the Worker. The default configuration uses static storage, so the first deployment works without configuring application secrets or external services.

The repository root is intentionally the deployment root. Do not point the Deploy to Cloudflare URL at `apps/worker`: the Worker depends on workspace packages elsewhere in this monorepo.

For a manual deployment from a cloned repository:

```bash
pnpm install
pnpm deploy
```

## Quick Start

```bash
mise install
pnpm install
pnpm validate
pnpm dev
```

Convenience tasks are also available:

```bash
mise run install
mise run validate
mise run dev
```

If your shell does not auto-activate mise shims, run commands through `mise exec --`, for example `mise exec -- pnpm validate`.

The Worker app currently imports `apps/worker/src/statusframe.config.ts`. YAML is supported through `parseStatusFrameYaml` and examples are in `examples/`.

## Repository Layout

```text
apps/worker               Cloudflare Worker app
packages/core             registry, runner, projection, redaction, UI rendering
packages/schema           Zod schema and YAML parsing
packages/storage/*        static, memory, and D1 storage adapters
packages/extensions/*     official extensions
examples                  YAML configuration examples
docs                      architecture and operational notes
```

Start with [Architecture](docs/architecture.md), [Implementation Status](docs/implementation-status.md), and [Security](docs/security.md) when `DESIGN.md` and `goal.md` are no longer present.

## Public Safety

Public routes read public snapshots only. Raw monitor results, target URLs, private IPs, internal hostnames, raw errors, headers, response bodies, webhook URLs, and tokens are not projected. `validatePublicOutput` fails snapshots that contain obvious leakage patterns.

## Cloudflare Worker

The standard runtime is one Worker:

```text
statusframe Worker
  -> Core runner
  -> Extension registry
  -> Registered extensions
```

Extensions do not create their own Worker invocation boundary. The scheduled handler delegates to the Core runner, and public requests render or return the latest public snapshot.
