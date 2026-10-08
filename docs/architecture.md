# Architecture

StatusFrame runs in a single Cloudflare Worker with fetch and scheduled handlers, and D1 is its only production storage. The root `wrangler.jsonc` defines the Worker entry point, D1 binding, and Cron trigger.

## Ownership

- `apps/worker`: bundles YAML, wires Workers fetch/sockets, binds D1 and webhook secrets, and exposes read-only routes.
- `packages/core`: validates configuration and domain records, owns the scheduler/state machine, projects public snapshots, enforces budgets, stores records in D1, and renders HTML.
- `packages/monitors`: implements four concrete checks. Only the external fetch/socket I/O is supplied at the runtime boundary.
- `packages/notifications`: implements signed HTTPS webhook delivery.

## Reading the implementation

- `apps/worker/src/index.ts` wires runtime bindings and routes requests to the HTML page or JSON responses.
- `packages/core/src/runner.ts` coordinates scheduled work: admission, lease acquisition, rereading state, sequential checks, atomic publication, and notification delivery. `runner-plan.ts` handles configuration hashes, restoration of monitor state, and merging configured domain records into the public view without I/O.
- `packages/core/src/projection.ts` selects public fields, computes component status, validates public data, and derives notification events.
- `packages/core/src/storage.ts` owns D1 queries, guarded statement preparation, and batch commits. `history.ts` splits published-state spans into calendar days in the configured site timezone and computes the 90-day public history. `history-calendar.ts` determines date boundaries, including timezone transitions.
- `packages/core/src/html.ts` composes the page. Its `html/` directory contains `messages.ts` for Japanese/English text, `styles.ts` for embedded CSS, `format.ts` for escaping and display formatting, `components.ts` for service history, and `events.ts` for incident and maintenance cards. CSS stays inline; these source modules require no browser scripts, asset requests, or custom build loaders.

## Scheduled execution

The runner reads persisted monitor runtime, bounded incident/maintenance records, and the previous public snapshot. Monitor runtime contains its private ID, configuration hash, last check, next due time, internal state, and saturated consecutive-result counters.

Only monitors whose next due time has arrived are candidates. Changes to monitor configuration reset that monitor to unknown and make it immediately due. Oldest due times are processed first, breaking ties by monitor ID. Execution is sequential and limited by actual budgets and a 45-second admission window. Skipped work remains due for a later tick. Checks are not replayed for missed intervals.

When due work or domain/public changes exist, the runner acquires the singleton D1 scheduler lease, then rereads persisted data. The lease lasts 120 seconds and is not acquired for entirely unchanged, not-due ticks. State/domain/snapshot/outbox mutations and lease release are one D1 batch transaction. Every mutation is conditional on the same unexpired owner token; stale invocations cannot publish over a new owner. An expired crashed invocation becomes recoverable on subsequent ticks.

D1 read failures, commit failures, or unexpected runner errors fail the invocation. External monitor errors produce a private failed result; budget exhaustion does not count as a monitor failure. No raw response, header, diagnostic message, or per-check history is stored.

## Projection

The pipeline is private runtime → explicit public field selection → strict public-model validation → D1 snapshot → validated public routes. Component state is computed from every configured monitor, including stored states of monitors which are not due.

| Internal component monitor states | Public status |
| --- | --- |
| No monitors, or any unknown with no failures | unknown |
| All up | operational |
| Some down | partial_outage |
| All down | major_outage |

An active incident may worsen the result to its declared impact. Site severity is operational < unknown < degraded < partial_outage < major_outage. Maintenance is published separately and does not hide failures.

Projection contains no monitor objects or diagnostic hints. The snapshot is persisted when public content changes or its history checkpoint needs updating. `site.updated_at` remains the last content-change time, including across history-only writes. Public fetches only read it and never perform monitoring or save fallback snapshots.

## Domains and delivery

Incidents and maintenance are core records, declaratively edited through YAML deployment and persisted in D1. Active entries are prioritized in the public view; up to 50 entries per domain are shown. Persistence retains history beyond that view. Indexed queries load bounded active/history windows plus explicitly configured IDs, so editing an older record remains possible without full history scans.

Notifications are created only by snapshot/domain changes after the initial baseline. Events are committed atomically with their public state. Due to the uncertainty of webhook transport, delivery is an at-most-once attempt: a conditional outbox deletion claims the event before sending. Budget deferral retains unclaimed events; transport failure/crash after claiming can lose delivery. Receivers get a unique event ID and optional exact-body HMAC signature.

## Verification

`pnpm test` runs deterministic unit tests in `tests/unit`. Fetch/socket boundaries use controlled I/O; timers are advanced explicitly for timeout cases. The suite covers public-data isolation, thresholds, redirects, bounded responses, native TLS I/O, operation budgets, and webhook signing/failure behavior.

`pnpm test:integration` checks D1 transactions, lease ownership, persistence across process restart, Worker routes, and runtime fetch compatibility using local workerd. These tests retain the real database/runtime contracts rather than implementing a mock SQL engine. Deployment tests substitute CLI commands to check migration failure and publish ordering without contacting Cloudflare.

`pnpm build` runs type checking and unit tests. `pnpm validate` adds integration tests and a Wrangler deployment dry run. Native TLS certificate verification and the hosted Deploy Button flow are platform behavior; the suites do not contact live targets or create remote resources.

## Status history

Migration `0002_status_history.sql` adds nullable `history_json` to the existing public snapshot table. The column stores duration counters for each of the five public states in daily buckets, bounded to 90 calendar days per configured public component. History includes its aggregation timezone, defaulting to UTC when reading legacy records. A checkpoint records the component states and the start of the open span. State changes and local day boundaries close spans into their daily buckets, prune old buckets, and save history atomically with the snapshot under the same scheduler lease. Changing the aggregation timezone discards old daily totals and starts recording at that checkpoint; closed daily totals cannot be accurately split into different calendar days. Removed components are dropped on the next checkpoint.

Public reads load snapshot and history together in one SELECT, validate stored data, and extend the open span in memory. They return 90 daily entries and time-weighted uptime per component. No history is reconstructed before the first checkpoint. Uptime excludes unknown time and assumes a published state persists until its next transition; it is an estimate of published status, not raw probe availability. Maintenance does not pause monitoring.

The status page uses server-rendered HTML and inline CSS with no scripts or external assets. `site.language` chooses Japanese or English labels; operator-authored text is preserved. Daily bars and an expandable table expose the same history, with unknown time and missing history shown in gray. Incident sections separate active records from resolved history.
