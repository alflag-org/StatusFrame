# Configuration

YAML is the primary configuration format. Use `parseStatusFrameYaml` from `@statusframe/schema` to parse and validate YAML into a typed `StatusFrameConfig`.

Validation checks include:

- duplicate IDs
- unknown status states
- invalid component references
- unknown monitor types
- disabled features with configured data
- inline notification secrets
- invalid durations
- extension manifest errors

See `examples/` for minimal, monitoring, incident, public-safe, and custom status configurations.
