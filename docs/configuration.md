# Configuration

Configure public services in `apps/worker/statusframe.yml`, then redeploy. Fields are strict: unknown fields and monitor types fail validation. Durations use positive integer `ms`, `s`, `m`, `h`, or `d` values. Intervals are 1 minute–30 days; timeouts are at most 30 seconds. Cron resolution is one minute, so due checks run at the next available tick, subject to budgets.

## Site and components

`site.name` and optional `site.description` are public. `site.timezone` is an IANA timezone, defaulting to UTC. Each component has a unique `id`, a public `name`, and an optional public `description`.

Component IDs and operator-written descriptions must be suitable for publication. Use service names rather than backend names. Public prose rejects target URLs, known target hostnames, monitor IDs, common IP/internal-host patterns, and credential/stack-trace patterns. This validation cannot determine whether an arbitrary human-written name is confidential.

## Monitor defaults

Every monitor has a unique private `id`, a valid `component` reference, and one of four types. Monitor IDs must differ from all public component IDs.

| Field | Default | Meaning |
| --- | --- | --- |
| `interval` | `1m` | Minimum delay after the scheduled check time |
| `timeout` | `5s` | Total deadline for the complete check |
| `failure_threshold` | `3` | Consecutive failures required for `down` |
| `recovery_threshold` | `2` | Consecutive successes required for `up` |

The initial internal state is `unknown`. Success resets the failure counter; failure resets the success counter. Counters saturate at their thresholds. Runtime state is reset when any monitor configuration changes. A removed monitor's runtime row is deleted during a successful scheduled run.

Only public Internet targets are supported. Credentials in HTTP URLs, private/special IP literals, localhost, and internal/local domains are rejected. DNS rebinding protection for socket destinations depends on Cloudflare's runtime restrictions. This is not a private network connectivity product.

## HTTP

```yaml
type: http
url: https://example.com/health
method: GET
follow_redirects: false
expect:
  status: 200
  body_contains: ok
```

`method` is GET or HEAD; GET is the default. Expected status defaults to 200. Body matching is optional, literal, and case-sensitive; HEAD cannot check a body. Without body matching, the response stream is cancelled immediately. Body checks are limited to 1 MiB. A status/body mismatch, oversized response, network error, or timeout is a failure.

Redirects are handled manually and counted individually. With `follow_redirects: true`, at most five redirects are followed, each destination must pass public-target validation, and HTTPS cannot redirect to HTTP. Without following redirects, the actual redirect status can be checked explicitly with `expect.status`.

## TCP

```yaml
type: tcp
host: play.example.com
port: 25565
```

A successful connection is sufficient; no application protocol is inferred. Sockets close after each check, including failures and timeouts. Cloudflare blocks some destinations and ports, including connections to Cloudflare IPs and port 25. See [Workers TCP restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#considerations).

## DNS

```yaml
type: dns
name: example.com
record_type: A
expect:
  values: [192.0.2.10]
```

Queries use [Cloudflare's DNS-over-HTTPS JSON endpoint](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/). Supported types are A, AAAA, CNAME, TXT, and MX. At least one requested-type answer is required. NXDOMAIN, empty/malformed responses, timeouts, and mismatches fail.

If `expect.values` is supplied, every expected value must appear; additional answers are permitted. CNAME/MX hostnames ignore case and a final dot. MX values use `priority hostname`, such as `10 mail.example.com`. AAAA addresses normalize equivalent IPv6 spellings. TXT values are logical strings, with quoted answer segments concatenated. This check reflects this resolver's view; it is not authoritative-server or multi-location monitoring.

## TLS

```yaml
type: tls
host: example.com
port: 443
```

The native Workers TLS socket validates certificate trust, hostname, and current validity. A one-byte write forces completion of any lazy handshake; the connection then closes. A successful authenticated connection is sufficient. The default port is 443. Each check uses one secure connection, with the configured deadline and socket cleanup. TLS versions and cipher suites are negotiated by the native runtime; there is no separate TLS 1.2 probe.

Advance certificate expiration warnings are unsupported because [workerd's peer-certificate methods are unimplemented](https://github.com/cloudflare/workerd/blob/main/src/node/internal/internal_tls_wrap.ts). The configuration rejects `expire_before` rather than silently ignoring it. Remove that field from TLS monitors. A currently valid certificate may pass even when it is close to expiration; an expired or otherwise invalid certificate fails native validation.

## Incident lifecycle

An incident requires `id`, public `title`, `status`, `impact`, public component references, and `started_at`. Status is investigating, identified, monitoring, or resolved. Impact is degraded, partial_outage, or major_outage. Optional `updates` contain status, public body, and `created_at`.

Resolved incidents require `resolved_at`; active incidents must omit it. Dates must be ISO timestamps with a timezone. Updates must be chronological and fall within the incident's lifetime. The final update must match the incident's status. Every YAML entry is the complete desired record, so include previous updates when adding a new one.

Active incident impact can worsen a component's monitoring-derived status. Resolved incidents remain in history and do not change current status. Changes are saved to D1; omitting an entry does not erase it.

## Maintenance lifecycle

A maintenance entry requires `id`, public `title`, `status`, component references, `starts_at`, `ends_at`, and public `body`. Status is scheduled, in_progress, completed, or cancelled. End time must be after start time.

Nonterminal entries follow their dates: before start they are scheduled, during the window they are in_progress, and after end they are completed. Explicit completed/cancelled entries remain terminal. Monitoring continues and its results remain visible throughout maintenance.

## Notifications and budgets

`notifications.webhook: true` enables delivery using `STATUSFRAME_WEBHOOK_URL` and optional `STATUSFRAME_WEBHOOK_SECRET` bindings. YAML never contains webhook URLs or secrets. Failed deliveries are not retried; budget-deferred events remain in the D1 outbox. See [Runtime costs](runtime-cost.md).

Configuration allows up to 100 components, 100 monitors, 50 incident declarations, and 50 maintenance declarations. These are validation limits, not guaranteed capacity on a Free account. Budgets must accommodate a domain change transaction; publish large batches in smaller changes if necessary.

## Public page language and history

Set `site.language` to `ja` for Japanese labels or `en` for English (default). `site.timezone` controls event timestamps; history buckets always use UTC calendar days and are labeled accordingly. The language setting does not translate service names or incident/maintenance descriptions.

The public page shows current service status, 90 daily history bars and estimated uptime, active incidents, planned/ongoing maintenance, and resolved incident history. History begins with the first scheduled run after the history migration; earlier dates show no data. Daily status shows the worst published state during the day. Uptime is normal duration divided by known duration, excluding unknown and pre-recording time. Maintenance and active incident impact remain part of published status.

History retention is fixed at the current UTC day plus the preceding 89 days. Daily counters are overwritten/checkpointed in a bounded JSON record, rather than adding every check result. Incidents and maintenance still have no automatic retention limit, and public lists remain bounded to 50 each.
