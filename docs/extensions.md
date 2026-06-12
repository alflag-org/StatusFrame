# Extensions

Extensions are build-time registered objects created with `defineExtension`.

Each extension has a manifest:

- `name`
- `kind`
- optional `monitorTypes`
- optional `providers`
- optional `capabilities`
- optional `cost`
- optional `defaultRedaction`

Official and third-party extensions use the same interface. Monitor extensions expose `runMonitor`. Feature extensions may expose `projectPublic`. Notification extensions expose `notify`. Admin extensions may expose `handleAdminRequest`.

Scaffolded extensions can set `manifest.scaffold = true` while the package shape and registration are established.
