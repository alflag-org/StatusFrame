# Core Framework

The core package owns the public-safe foundation:

- extension registration
- config validation
- runtime budget accounting
- scheduled runner orchestration
- component aggregation
- public projection generation
- public output leakage validation
- default server-rendered HTML

Core does not implement HTTP, TCP, incident, maintenance, notification, metrics, admin, or storage-specific behavior directly. Those capabilities are registered as extensions or storage adapters.

Public routes should call `runner.getPublicSnapshot()`. Scheduled execution should call `runner.runScheduled()`.
