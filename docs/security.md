# Publication and runtime security

Private monitoring configuration and runtime types are distinct from public snapshot types. Projection explicitly selects public site/component/incident/maintenance fields. Monitor results have only a private success flag and stable error code; they are never spread into public records, notification payloads, or persisted history.

Every projected snapshot and every stored snapshot read by public routes is checked against a strict schema. Extra keys fail validation. Known monitor IDs, targets/hostnames, and webhook bindings are rejected in public strings; public prose also rejects common URL/IP/internal-host, credential, and stack-trace patterns. This supplements the field boundary rather than replacing it.

Operators deliberately author public names, titles, and bodies. Validation cannot infer whether an arbitrary backend name, password without a recognizable prefix, or other human-authored text is confidential. Use service-level descriptions and review publication text. Monitor IDs cannot overlap component IDs.

HTML escapes every operator-authored string. Responses set content security, no-sniff, and referrer headers. Request failures return only a fixed message, and monitoring exceptions do not become public status descriptions.

All routes are read-only. There are no administration, push, or generic provider endpoints. YAML is bundled at deployment and rejects unknown fields/types, duplicate keys, excessive aliases, unknown component references, and malformed domain dates/statuses.

HTTP redirects are followed manually only when enabled. Every destination is validated; credentials, local/internal targets, and HTTPS downgrades are rejected. Downloads, checks, sockets, and notifications have bounds and deadlines. Private-network monitoring/VPC integration is unsupported. Cloudflare applies its own socket destination restrictions; hostname validation does not independently resolve and pin destination IPs.

Webhook destinations and signing credentials come only from Worker secrets/environment bindings. Webhooks require HTTPS, reject redirects, include public transition fields, and optionally sign the exact JSON body. D1 outbox claims prevent duplicate attempts across Cron overlap; failed/claimed deliveries are not retried.

D1 production bindings are mandatory. Missing bindings, invalid stored public models, and runtime/storage errors fail closed. The scheduler uses an expiring owner-token lease and transaction-guarded writes to prevent concurrent/stale state publication.

TLS checks use only a native secure socket and force handshake completion before succeeding. Certificate trust, hostname, and current validity are enforced by the runtime. No unauthenticated certificate sample is consumed. Advance expiration warnings are unsupported, and the configuration rejects `expire_before`; see [TLS configuration](configuration.md#tls).
