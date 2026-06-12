# Security

Public output is generated from `PublicSnapshot`, not raw internal data.

Public output validation rejects obvious leakage:

- RFC1918, loopback, and link-local IP addresses
- localhost and common internal hostnames
- raw URLs
- webhook URLs
- token-like strings
- secret-like strings
- stack traces and raw error patterns

Notification URLs must be environment references such as `${STATUSFRAME_WEBHOOK_URL}`. Admin API is disabled by default and requires a bearer token when enabled.
