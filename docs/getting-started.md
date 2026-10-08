# Getting started

For hosted setup, choose [Quick deployment or Long-term deployment](deployment.md).

## Local development

Install [mise](https://mise.jdx.dev/), then run these commands from the repository root:

```sh
mise install
pnpm install --frozen-lockfile
pnpm --filter @statusframe/worker db:local
pnpm dev
```

Configure your services in `apps/worker/statusframe.yml`. See [examples](../examples/) and [Configuration](configuration.md).

Before the first successful scheduled run, the page reports `unknown`. With defaults, two successful checks establish `operational`, three failures establish an outage, and two subsequent successes recover it. Cron runs every minute; each monitor's interval determines when it is due.

To trigger a local scheduled run while Wrangler is running:

```sh
curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
```

## Checks

| Command | Checks |
| --- | --- |
| `pnpm test` | Unit tests for configuration, state, public projection, monitors, budgets, and webhooks |
| `pnpm test:integration` | Local D1 persistence/concurrency and Workers API compatibility |
| `pnpm validate` | Type checking, both test suites, and a deployment dry run |

Tests use controlled I/O and local data. They do not contact monitoring targets or deploy resources.
