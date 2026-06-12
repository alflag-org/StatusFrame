# Public API

## `GET /api/status`

Returns the current public status snapshot:

```json
{
  "site": {
    "name": "Example Status",
    "status": "operational",
    "updated_at": "2026-06-12T03:00:00.000Z"
  },
  "components": [
    {
      "id": "web",
      "name": "Web services",
      "status": "operational"
    }
  ],
  "active_incidents": [],
  "scheduled_maintenance": []
}
```

## `GET /api/incidents`

Available when the incident extension is enabled. Returns public incident data only.

## `GET /api/maintenance`

Available when the maintenance extension is enabled. Returns public maintenance data only.
