# API Guarantees

This document defines what `Fluxer.JS` currently treats as part of its intended public API, and what is still considered internal or unstable during the alpha phase.

## Public API

The following surfaces are intended for package consumers:

- exports from `fluxer-js` through [src/index.ts](../src/index.ts)
- documented builder APIs such as `MessageBuilder`, `EmbedBuilder`, `AttachmentBuilder`, and serializer helpers
- documented bot/client abstractions like `FluxerBot`, `FluxerClient`, transports, plugins, and testing helpers
- documented error types and event contracts referenced from the README and docs

For the current alpha, "public API" means "intended for consumers and documented," not "locked against change." The stability promise is still evolving until a later beta/stable release.

Examples, README snippets, and release docs are meant to describe the intended consumer path, but the supported runtime surface is still defined by documented package-root exports and the behavioral notes attached to them.
That includes the documented error families exported from `fluxer-js`, such as `PlatformBootstrapError`, `GatewayTransportError`, `GatewayProtocolError`, `RestTransportError`, and `PayloadValidationError`.

## Not guaranteed as public API

The following are not considered stable package contracts:

- deep imports into `src/core/...`
- object shapes or helper functions that are not exported from `src/index.ts`
- test-only helpers that are not part of the documented public surface
- undocumented private/protected implementation details
- release workflow files, CI implementation details, and packaging internals

## Alpha compatibility stance

During the alpha phase:

- documented public APIs are expected to trend toward stability, but may still change
- changes that materially improve runtime trustworthiness or developer ergonomics can still reshape public APIs
- meaningful breaking changes should be called out in the changelog and README notes
- some currently exported surfaces may still be narrowed, renamed, or reorganized before beta if they are found to be too broad or poorly shaped
- mock-first testing helpers are public and supported for alpha use, but they should not be treated as a live-platform protocol guarantee

## What counts as a breaking change

Examples:

- removing or renaming an exported symbol from `fluxer-js`
- changing the required shape of a documented public option or payload
- changing a documented event or error contract in a non-backward-compatible way
- changing the documented shape of exported bootstrap/runtime errors such as `PlatformBootstrapError` codes, `retryable`, or `details`
- changing command, transport, or builder behavior in a way that invalidates documented usage patterns

## What usually does not count as a breaking change

Examples:

- adding new exported types, methods, or helpers
- adding new normalized events while keeping raw `gatewayDispatch` available
- strengthening validation for clearly malformed payloads
- improving diagnostics or doc coverage without altering the documented contract shape

## Stability target

The intended long-term guarantee is:

- package-root exports define the supported public surface
- docs describe the behavioral contract for that surface
- semver governs compatibility once the project reaches stable releases
