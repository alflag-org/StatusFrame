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

Site/component description fields appear only when configured. Public states are operational, degraded, partial_outage, major_outage, and unknown. `updated_at` records the last public content change, not every monitoring check. Before initial publication, the unknown fallback uses the request time.

Incidents contain id, title, status, impact, component IDs, started_at, nullable resolved_at, and updates. Each update contains status, body, and created_at. Maintenance contains id, title, status, component IDs, starts_at, ends_at, and body. Lists are bounded to 50 entries each, prioritizing active entries before recent history.

## GET /api/incidents

Returns `{ "incidents": [...] }` from the same public snapshot, including resolved history. It is always available; there is no feature toggle route.

## GET /api/maintenance

Returns `{ "maintenance": [...] }` from the same snapshot, including completed/cancelled history.

## GET /

Renders component availability, incident updates/history, and maintenance. Operator prose is HTML-escaped. Times are displayed using the configured timezone. The page has no client monitoring logic, third-party assets, raw checks, or uptime/latency graphs.

## Publication contract

Public output selects explicit service fields and excludes monitoring IDs/targets, request/response data, errors, headers, credentials, backend diagnostics, and webhook bindings. A strict schema plus known-private-value checks validates both newly projected and stored snapshots. Invalid snapshots fail closed rather than returning a partially filtered object. See [Security](security.md).
