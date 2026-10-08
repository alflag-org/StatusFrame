# StatusFrame

A self-hosted status page with HTTP, TCP, DNS, and TLS monitoring, running on Cloudflare Workers and D1.

Publish service availability, incidents, and maintenance while keeping monitoring targets and diagnostics private.

## Features

- HTTP status/body checks, TCP connectivity, DNS records, and native TLS validation.
- YAML configuration with persistent check intervals and failure/recovery thresholds.
- Incident updates and scheduled maintenance.
- A public status page, read-only APIs with 90-day status history and estimated uptime, and optional webhook notifications.

## Deployment

### Quick deployment

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/viasnake/StatusFrame)

For evaluation or temporary use. Creates an independent repository copy, Worker, D1 database, and Workers Builds connection. Upstream updates are manual.

### Long-term deployment

[Fork this repository](https://github.com/viasnake/StatusFrame/fork) and connect the fork to Cloudflare Workers Builds. Use GitHub **Sync fork → Update branch** to receive upstream updates.

Both apply D1 migrations before publishing the Worker. See the [deployment guide](docs/deployment.md) for setup and updates.

## Documentation

- [Local development](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Public API](docs/public-api.md)
- [Runtime costs](docs/runtime-cost.md)
- [Security](docs/security.md)
- [Architecture](docs/architecture.md)
