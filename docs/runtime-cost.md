# Runtime costs

Cron runs every minute. An unchanged tick with no due monitors performs four bounded D1 read queries and no writes (plus an outbox query when webhook delivery is enabled). Public requests read one snapshot row. A missing snapshot produces an in-memory unknown view, without a write.

## Write policy

A successful due tick writes one scheduler lease acquisition, one runtime row per executed monitor, and one lease release. Runtime rows are necessary for restart-safe intervals and consecutive-result counters. The public snapshot writes when visible content changes, published component states change, or UTC day rollover checkpoints history. History and the snapshot share one row and one write. Domain records write only when changed. Notifications add one outbox row per transition and one conditional deletion per delivery attempt. Removed monitors are deleted in one statement during reconciliation.

The runtime table holds only the current state of configured monitors. A separate JSON column on the singleton public snapshot row holds up to 90 UTC calendar days of duration counters per public component, plus the current state and checkpoint time. It adds no read queries. Repeated same-state checks add no history writes within a day. History is checkpointed on state changes and UTC day rollover; old days and removed components are dropped at the next checkpoint. Public reads extend the current span in memory without writes.

There is no per-check result log or latency/SLA time series. Uptime is an estimate from published states, including configured failure/recovery thresholds and active incident impact. The last published state is assumed to continue until its next transition, including scheduler interruptions; this is not independent evidence of availability during unobserved periods. Unknown time and time before recording began are excluded from the uptime denominator. Maintenance does not pause monitoring or exclude downtime.

## Budgets

The following limits apply separately to each scheduled invocation:

| YAML budget field | Default | Counted operation |
| --- | --- | --- |
| `max_d1_reads` | 10 | Executed SELECT statements |
| `max_d1_writes` | 20 | Executed mutation statements, including leases and outbox |
| `max_subrequests` | 40 | Each D1 statement, fetch hop, and socket connection |
| `max_notifications` | 5 | Attempted webhook deliveries |
| `max_due_jobs` | 10 | Admitted due monitors |

Accounting happens before actual I/O, including D1 batches and notification failures. A conditional SQL statement that affects zero rows still consumes an operation. The subrequest accounting conservatively counts every statement in a D1 batch. HTTP redirects count individually; DNS costs one fetch, and TCP and TLS each cost one connection.

The scheduler reserves transaction space before admitting checks. It reserves up to six fetches for an HTTP monitor that follows redirects, and reserves potential transition writes when notifications are enabled. Capacity is therefore lower than the declared job maximum when another budget is tighter. Jobs are skipped before I/O when their complete operation cannot fit, and remain due. Reading essential state can throw a budget error if its read budget is too small. Domain change transactions must fit as a whole; they fail before commit when insufficiently budgeted.

These are operation limits, not a daily billing cap. D1 [billing](https://developers.cloudflare.com/d1/platform/pricing/) counts rows read/written, including index work. Check actual `meta.rows_read`/`meta.rows_written` or Cloudflare analytics when sizing an installation. Defaults target small installations; user traffic, monitoring frequency, domain history, and status changes also affect quotas. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) remain authoritative.

## Recovery and notification tradeoffs

An invocation crash before commit leaves due work intact and the lease eventually expires. A successful commit persists scheduler state and transitions together. Deferred notifications are durable and may be delivered on a later tick; no periodic same-state reminder is generated.

Webhook claims are at most once. Failed sends are logged with a fixed message and are not retried. A receiver must not treat webhook delivery as a guaranteed incident log; the public snapshot and D1 domain records remain the state source.
