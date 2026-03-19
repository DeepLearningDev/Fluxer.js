# Plugin Packaging Conventions

`Fluxer.JS` already supports runtime plugins. This document defines how plugin packages should be named, scoped, documented, and versioned as the ecosystem grows.

## Naming

Recommended package naming:

- official packages: `@fluxer-js/plugin-<name>`
- community packages: `fluxer-js-plugin-<name>` or a scoped equivalent like `@your-scope/fluxer-js-plugin-<name>`

Examples:

- `@fluxer-js/plugin-essentials`
- `@fluxer-js/plugin-moderation`
- `@your-scope/fluxer-js-plugin-economy`

## Package shape

Each plugin package should export:

- a factory like `createModerationPlugin(...)`
- any documented plugin-specific option types
- any documented plugin-specific public utility types

Plugin packages should avoid:

- deep-import requirements into `Fluxer.JS` internals
- side-effect-only installs
- undocumented global state

## Runtime contract

A plugin should integrate through the existing public `FluxerPlugin` contract:

- use `modules` for packaged commands/middleware/hooks
- use `setup(...)` only for explicit plugin initialization work
- assume the host application may install multiple plugins in one bot
- avoid mutating unrelated runtime state outside the plugin context

## Documentation expectations

Each plugin package should document:

- what commands or hooks it installs
- required permissions or expected bot capabilities
- whether it assumes hosted Fluxer, self-hosted Fluxer, or both
- any migration notes if the plugin mirrors common Discord bot patterns

## Version alignment

Recommended compatibility policy:

- official plugins should declare a peer dependency on a compatible `fluxer-js` range
- plugin releases should note the minimum supported `fluxer-js` version
- breaking plugin changes should follow semver and call out host-framework compatibility changes clearly

## Testing expectations

Recommended plugin quality bar:

- use `FluxerTestRuntime` for command and event tests
- avoid relying on live network behavior for core plugin tests
- test module/plugin installation paths and any capability guards explicitly

## Official plugin direction

The likely first official plugin packages should be:

- essentials
- moderation
- admin/utilities
- testing helpers if they eventually split from core
