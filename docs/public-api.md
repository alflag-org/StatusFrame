# Public API

All routes accept GET and HEAD. Other methods return 405; unknown routes, including administration/push paths, return 404. Responses are cacheable for 30 seconds. Failures return a fixed 503 message and no private diagnostics.

## GET /api/status

```json
{
  "site": { "name": "Example Status", "timezone": "Asia/Tokyo", "status": "operational", "updated_at": "2026-01-01T00:00:00.000Z" },
  "components": [{ "id": "web", "name": "Web", "status": "operational", "last_checked_at": "2026-01-01T00:00:00.000Z" }],
  "incidents": [],
  "maintenance": []
}
```

Site/component description fields appear only when configured. `site.language` is `en` or `ja` on new snapshots; older stored snapshots may omit it until their next publication. Each returned component also includes `history`, described below. Public states are operational, degraded, partial_outage, major_outage, and unknown. `updated_at` records the last public content change, not every monitoring check. Before initial publication, the unknown fallback uses the request time.

`components[].last_checked_at` is an ISO 8601 UTC instant for the oldest last check among the component's configured monitors. Successful and failed checks both count; skipped checks do not advance it. It is `null` when there are no monitors or any monitor has not yet been checked. Older stored snapshots may omit it until the next scheduled publication. Check-time updates preserve `site.updated_at` and do not create notifications.

Incidents contain id, title, status, impact, component IDs, started_at, nullable resolved_at, and updates. Each update contains status, body, and created_at. Maintenance contains id, title, status, component IDs, starts_at, ends_at, and body. Lists are bounded to 50 entries each, prioritizing active entries before recent history.

## GET /api/incidents

Returns `{ "incidents": [...] }` from the same public snapshot, including resolved history. It is always available; there is no feature toggle route.

## GET /api/maintenance

Returns `{ "maintenance": [...] }` from the same snapshot, including completed/cancelled history.

## GET /

Renders component availability, incident updates/history, and maintenance. Operator prose is HTML-escaped. Times are displayed using the configured timezone. Service cards display the 90-day uptime percentage beside the service name, daily status bars with date/status/uptime tooltips, and the last check time including seconds and timezone. Leading unrecorded dates are omitted from the chart; unknown days after recording starts remain visible. Bars grow with the recorded period, and their date range is shown below. Without known history, the card displays "No history yet" instead of an uptime value or placeholder bars. Missing check times display "Not checked yet". Normal operation uses a compact status line; other states retain a prominent banner. The page also includes active incidents, maintenance, and resolved incident history. There is no navigation menu, daily table, client monitoring logic, third-party asset, raw check log, or latency graph.

## Publication contract

Public output selects explicit service fields and excludes monitoring IDs/targets, request/response data, errors, headers, credentials, backend diagnostics, and webhook bindings. A strict schema plus known-private-value checks validates both newly projected and stored snapshots. Invalid snapshots fail closed rather than returning a partially filtered object. See [Security](security.md).

## Component history

`components[].history` contains `days` (90 entries in ascending calendar-date order in `site.timezone`) and `uptime_percent` (the time-weighted percentage across those days, or `null` without known time). Each day contains `date` (`YYYY-MM-DD` in `site.timezone`, UTC by default), `status` (the worst published state during that day, or `unknown` without recorded time), `known_ms` (time excluding unknown state), and `uptime_percent` (normal duration / known duration × 100, or `null`). Calendar days follow timezone transitions and may be longer or shorter than 24 hours. Missing data is not reported as 100% uptime.

Daily history starts at the first scheduled checkpoint; it is not backfilled from existing incidents. Failure/recovery thresholds and incident impact affect published status and thus history. Maintenance does not pause monitoring or remove downtime from the denominator. The last published state is assumed to continue through scheduler interruptions. The open span is calculated at request time without writing to D1, so history may advance while `site.updated_at` remains unchanged. The page displays event timestamps and history using the same `site.timezone`. API event timestamps remain ISO 8601 UTC instants. Changing the aggregation timezone starts new daily history at the next scheduled checkpoint. Legacy history without timezone metadata is interpreted as UTC; upgrading preserves these totals when the configured timezone is UTC.
