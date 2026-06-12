# Runtime Cost

StatusFrame runs optional work through a single Core runner.

Default scheduler and budget:

```yaml
runtime:
  scheduler:
    tick: 60s
    concurrency: 4
    jitter: true
  budget:
    max_subrequests_per_tick: 40
    max_d1_queries_per_tick: 10
    max_d1_writes_per_tick: 100
    max_notifications_per_tick: 5
    max_due_jobs_per_tick: 40
```

The runner skips work that would exceed budget. Public requests do not run monitors and should read a public snapshot.
