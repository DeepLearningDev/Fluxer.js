# Commands And Conversations

## Command Model

Fluxer.JS commands are intentionally strict:

- names and aliases are validated
- command keys are case-insensitive by default
- quoted arguments stay grouped
- schema-defined args and flags are validated before execution

## Schemas

Use command schemas when you want typed args, flags, defaults, enum checks, or coercion.

Key capabilities:

- required and optional args
- rest args
- typed flags
- enum validation
- default values
- custom `coerce(...)` logic

## Groups And Help

- `defineCommandGroup(...)` lets you model grouped subcommands
- built-in help output is driven by command metadata
- descriptors and command catalogs can be inspected programmatically

## Conversations

For simple conversational flows:

- `context.awaitReply(...)`
- `client.waitForMessage(...)`
- `FluxerMessageCollector`

These support request-response flows without forcing you into a separate orchestration model.
