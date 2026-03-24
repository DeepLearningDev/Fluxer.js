# Fluxer.JS Wiki

Fluxer.JS is a TypeScript framework for building Fluxer bots with typed commands, transport flexibility, mock-first local workflows, and a clear path toward real-instance bootstrap.

Current posture:

- release channel: `0.1.0-alpha.1`
- package format: ESM-only
- runtime: Node `>=20`
- status: useful for experimentation, still moving toward beta

## Start Here

- [Getting Started](./Getting-Started.md)
- [Core Concepts](./Core-Concepts.md)
- [Commands And Conversations](./Commands-And-Conversations.md)
- [Transport And Runtime](./Transport-And-Runtime.md)
- [Messages And Payloads](./Messages-And-Payloads.md)
- [Testing And Release](./Testing-And-Release.md)
- [Migration And Compatibility](./Migration-And-Compatibility.md)

## Reference Docs

- [Release Policy](../docs/ReleasePolicy.md)
- [API Guarantees](../docs/ApiGuarantees.md)
- [Gateway Error Codes](../docs/GatewayErrorCodes.md)
- [REST Error Codes](../docs/RestErrorCodes.md)
- [Gateway Event Contract](../docs/GatewayEventContract.md)
- [Payload Builders](../docs/PayloadBuilders.md)

## What Fluxer.JS Is Good For

- local-first bot development with deterministic test workflows
- strongly typed command systems with schema-driven inputs
- teams who want a transport abstraction instead of a single runtime path
- controlled alpha adoption where release signals and docs matter

## What It Is Not Yet

- not a production-ready stable framework
- not a complete Fluxer surface
- not yet backed by broad live contract testing against a real Fluxer instance
