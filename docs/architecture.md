# Architecture

StatusFrame is a public-safe status page framework. It deliberately avoids behaving like a public infrastructure monitoring dashboard.

Core rule:

```text
Do not publish your infrastructure.
Publish your service status.
```

## Product Model

StatusFrame has three layers:

```text
Core Framework
  -> official extensions
  -> user extensions
```

Official extensions are not special. They use the same `StatusFrameExtension` interface that third-party extensions use.

## Layering Rule

```text
apps/worker
  -> packages/core
  -> packages/schema

packages/extensions/*
  -> packages/core

packages/storage/*
  -> packages/core
```

Core owns orchestration, validation, public projection, redaction, status aggregation, and budget enforcement. Core must not depend on extension or storage packages.

Storage packages implement `StorageAdapter`. Extension packages implement `StatusFrameExtension`. The Worker package composes the concrete adapters and extensions at build time.

## Runtime Model

Extension boundaries are feature boundaries, not Worker invocation boundaries.

```text
statusframe Worker
  -> Core runner
  -> Extension registry
  -> Registered extensions
```

The scheduled handler is the only standard background execution point. It loads bundled config, selects due jobs, enforces budgets, runs registered extensions, aggregates component state, saves state, generates a public snapshot, and sends notifications when budget allows.

Public requests must not execute monitors. Public routes read or generate public snapshots only.

## Public Data Flow

```text
private extension result
  -> normalized monitor state
  -> component aggregation
  -> extension public projection hooks
  -> redaction and leakage validation
  -> PublicSnapshot
  -> HTML or JSON
```

Public output may include site metadata, public component names, public statuses, active incidents, scheduled maintenance, and explicitly enabled aggregate metrics.

Public output must not include monitor targets, private IPs, internal hostnames, raw monitor IDs, raw errors, stack traces, response bodies, request or response headers, webhook URLs, provider tokens, secrets, or backend dependency lists.

## Config Model

YAML is the primary user-facing config format. `@statusframe/schema` parses YAML into `StatusFrameConfig`; `@statusframe/core` validates semantic references against the extension registry.

The minimal valid config has:

- site metadata
- disabled optional features
- user-defined status states
- public components with static statuses

It does not require monitors, scheduled jobs, D1, incidents, maintenance, notifications, or metrics.

## Runtime Budgets

The runner enforces conservative per-tick limits:

- due jobs
- subrequests
- D1 reads
- D1 writes
- notifications
- scheduler concurrency

Jobs that would exceed budget are skipped or delayed by the runner. Extensions declare approximate cost in their manifest.

## Storage Model

Storage is pluggable:

- static storage for no-storage minimal mode
- memory storage for local development and tests
- D1 storage for Cloudflare Workers deployment

Public page and API routes should prefer a stored public snapshot when storage is enabled. Raw monitor result storage is disabled by default.

## Extension Points

Supported extension hooks:

- monitor execution
- public projection contribution
- notification delivery
- admin request handling

The manifest shape also leaves room for future provider, renderer, validation rule, redaction rule, and storage adapter extensions.
