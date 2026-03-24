# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with pre-release channels while the framework is not yet stable.

## [Unreleased]

### Planned

- Remaining gateway normalization across the broader Fluxer surface
- Release-channel progression from alpha to beta once the runtime and packaging surface are more stable

### Changed

- README is now a tighter entry page with a clearer install path, docs navigation, and current-limitations framing
- a staged `wiki/` guide layer now exists in the repo so the GitHub wiki can be populated quickly once wiki hosting is enabled

### Fixed

- the default `MESSAGE_CREATE` parser now rejects malformed payloads with typed `GATEWAY_MESSAGE_CREATE_INVALID` diagnostics instead of constructing partially trusted message objects
- gateway tests now exercise the default inbound message parser directly so the real ingress path is covered instead of only parser overrides

## [0.1.0-alpha.1] - 2026-03-18

### Added

- `FluxerTestRuntime.waitForSentMessage(...)` for asserting against the real outbound transport path in tests

### Changed

- `createFluxerPlatformTransport(...)` now defaults to the built-in message parser unless `parseMessageEvent` is overridden
- README and release docs now state the alpha caveats, ESM-only package format, Node `>=20` requirement, and current migration/plugin expectations more explicitly

### Fixed

- npm packaging metadata now includes the built `dist/` output, bundled docs, and changelog in the release tarball
- release-facing docs and package metadata now reflect the current alpha maturity more accurately

## [0.1.0-alpha.0] - 2026-03-18

### Added

- Typed `FluxerClient`, `FluxerBot`, and transport abstractions for mock, REST, gateway, and composed platform transports
- Middleware, guards, hooks, modules, plugins, permission policies, and command catalogs
- Schema-driven prefix commands with groups, subcommands, defaults, enums, coercion, collectors, and generated help output
- Gateway normalization for messages, channels, guilds, moderation, invites, members, presence, typing, roles, reactions, and voice
- Explicit gateway state/session handling, typed gateway and REST diagnostics, and structured debug hooks
- Self-hosted discovery and capability handling based on Fluxer discovery documents
- `FluxerTestRuntime`, fixture builders, and transport-oriented test coverage
- Rich payload builders for embeds, attachments, payload templates, serializer previews, and payload validation
- Runtime and payload contract docs, error-code references, and migration/release policy docs

### Changed

- Package versioning now uses a semver pre-release channel to reflect alpha readiness explicitly
- Publishing workflow now includes `release:check`, `pack:dry-run`, and `prepublishOnly`

### Notes

- `0.1.0-alpha.0` is the first documented alpha snapshot of the framework foundation
- Public APIs may still change between alpha releases when doing so materially improves correctness or ergonomics

