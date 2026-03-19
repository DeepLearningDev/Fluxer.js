# API Guarantees

This document defines what `Fluxer.JS` currently treats as part of its intended public API, and what is still considered internal or unstable during the alpha phase.

## Public API

The following surfaces are intended for package consumers:

- exports from `fluxer-js` through [src/index.ts](../src/index.ts)
- documented builder APIs such as `MessageBuilder`, `EmbedBuilder`, `AttachmentBuilder`, and serializer helpers
- documented bot/client abstractions like `FluxerBot`, `FluxerClient`, transports, plugins, and testing helpers
- documented error types and event contracts referenced from the README and docs

## Not guaranteed as public API

The following are not considered stable package contracts:

- deep imports into `src/core/...`
- object shapes or helper functions that are not exported from `src/index.ts`
- test-only helpers that are not part of the documented public surface
- undocumented private/protected implementation details

## Alpha compatibility stance

During the alpha phase:

- documented public APIs are expected to trend toward stability, but may still change
- changes that materially improve runtime trustworthiness or developer ergonomics can still reshape public APIs
- meaningful breaking changes should be called out in the changelog and README notes

## What counts as a breaking change

Examples:

- removing or renaming an exported symbol from `fluxer-js`
- changing the required shape of a documented public option or payload
- changing a documented event or error contract in a non-backward-compatible way
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
