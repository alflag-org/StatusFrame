# Public API

All routes accept GET and HEAD. Other methods return 405; unknown routes, including administration/push paths, return 404. Responses are cacheable for 30 seconds. Failures return a fixed 503 message and no private diagnostics.

## GET /api/status

```json
{
  "site": { "name": "Example Status", "timezone": "Asia/Tokyo", "status": "operational", "updated_at": "2026-01-01T00:00:00.000Z" },
  "components": [{ "id": "web", "name": "Web", "status": "operational" }],
  "incidents": [],
  "maintenance": []
}
```

Site/component description fields appear only when configured. `site.language` is `en` or `ja` on new snapshots; older stored snapshots may omit it until their next publication. Each returned component also includes `history`, described below. Public states are operational, degraded, partial_outage, major_outage, and unknown. `updated_at` records the last public content change, not every monitoring check. Before initial publication, the unknown fallback uses the request time.

Incidents contain id, title, status, impact, component IDs, started_at, nullable resolved_at, and updates. Each update contains status, body, and created_at. Maintenance contains id, title, status, component IDs, starts_at, ends_at, and body. Lists are bounded to 50 entries each, prioritizing active entries before recent history.

## GET /api/incidents

Returns `{ "incidents": [...] }` from the same public snapshot, including resolved history. It is always available; there is no feature toggle route.

## GET /api/maintenance

Returns `{ "maintenance": [...] }` from the same snapshot, including completed/cancelled history.

## GET /

Renders component availability, incident updates/history, and maintenance. Operator prose is HTML-escaped. Times are displayed using the configured timezone. The page includes a localized status banner, service cards with 90-day status bars and uptime, active incidents, maintenance, and resolved incident history. Each history chart has an expandable daily table. There is no client monitoring logic, third-party asset, raw check log, or latency graph.

## Publication contract

Public output selects explicit service fields and excludes monitoring IDs/targets, request/response data, errors, headers, credentials, backend diagnostics, and webhook bindings. A strict schema plus known-private-value checks validates both newly projected and stored snapshots. Invalid snapshots fail closed rather than returning a partially filtered object. See [Security](security.md).

## Component history

`components[].history` contains `days` (90 entries in ascending UTC-date order) and `uptime_percent` (the time-weighted percentage across those days, or `null` without known time). Each day contains `date` (`YYYY-MM-DD` in UTC), `status` (the worst published state during that day, or `unknown` without recorded time), `known_ms` (time excluding unknown state), and `uptime_percent` (normal duration / known duration × 100, or `null`). Missing data is not reported as 100% uptime.

Daily history starts at the first scheduled checkpoint; it is not backfilled from existing incidents. Failure/recovery thresholds and incident impact affect published status and thus history. Maintenance does not pause monitoring or remove downtime from the denominator. The last published state is assumed to continue through scheduler interruptions. The open span is calculated at request time without writing to D1, so history may advance while `site.updated_at` remains unchanged. History buckets are UTC even when event timestamps use another site timezone.
