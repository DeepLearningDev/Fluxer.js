# Fluxer.JS

TypeScript framework for building bots on Fluxer.

Current release channel: `0.1.0-alpha.1`

Fluxer.JS is for teams who want a typed bot framework with strict command behavior, transport flexibility, test-first local workflows, and a clear path from mock development to real-instance bootstrap.

Important alpha caveats:

- the package is still alpha and not production-ready
- the published package is ESM-only
- Node `>=20` is required
- parts of the gateway lifecycle still rely on Discord-compatible assumptions while dedicated Fluxer lifecycle docs remain incomplete
- the REST surface is useful but still intentionally narrower than the long-term framework goal

## Table Of Contents

- [Why Fluxer.JS](#why-fluxerjs)
- [Install](#install)
- [Five-Minute Path](#five-minute-path)
- [Real Instance Bootstrap](#real-instance-bootstrap)
- [What You Get Today](#what-you-get-today)
- [Docs And Guides](#docs-and-guides)
- [Repo Workflow](#repo-workflow)
- [Current Limitations](#current-limitations)

## Why Fluxer.JS

- Strongly typed command, message, and transport contracts.
- Mock-first local development through `MockTransport` and `FluxerTestRuntime`.
- A composed platform path through `createFluxerPlatformTransport(...)` for real Fluxer instances.
- Strict command schemas, command groups, guards, middleware, hooks, and generated help.
- Typed diagnostics for gateway, discovery, REST, bootstrap, and payload failures.

## Install

```bash
npm install fluxer-js
```

For package consumers:

- runtime: Node `>=20`
- module format: ESM-only

## Five-Minute Path

This is the fastest useful local path. It uses `MockTransport`, registers one command, injects one message, and shows the bot response.

```ts
import { FluxerBot, FluxerClient, MockTransport } from "fluxer-js";

const transport = new MockTransport();
const client = new FluxerClient(transport);
const bot = new FluxerBot({
  name: "HelloBot",
  prefix: "!"
});

bot.command({
  name: "ping",
  execute: async ({ reply }) => {
    await reply("pong");
  }
});

client.registerBot(bot);
await client.connect();

await transport.injectMessage({
  id: "msg_1",
  content: "!ping",
  author: {
    id: "user_1",
    username: "fluxguy"
  },
  channel: {
    id: "general",
    name: "general",
    type: "text"
  },
  createdAt: new Date()
});

console.log(transport.sentMessages[0]?.content); // "pong"
```

The same example lives in `src/examples/minimal.ts`.

## Real Instance Bootstrap

When you are ready to talk to a real Fluxer instance, use `createFluxerPlatformTransport(...)`.

```ts
import {
  FluxerClient,
  PlatformBootstrapError,
  createFluxerPlatformTransport,
} from "fluxer-js";

try {
  const transport = await createFluxerPlatformTransport({
    instanceUrl: "https://api.fluxer.app",
    auth: { token: process.env.FLUXER_TOKEN ?? "" },
    intents: 513,
  });

  const client = new FluxerClient(transport);
  await client.connect();
} catch (error) {
  if (error instanceof PlatformBootstrapError) {
    console.error(error.code, error.details);
  }
  throw error;
}
```

For the narrowest real-instance smoke path in this repo, set `FLUXER_INSTANCE_URL` and `FLUXER_TOKEN`, then run:

```bash
npm run dev:platform
```

For the first real bot path, add `FLUXER_KEEP_ALIVE=1` and optionally `FLUXER_BOOTSTRAP_CHANNEL_ID`, then send `!ping` in a real text channel after connect.

For a stronger repeatable self-hosted or bot-gateway-capable live-instance check, set `FLUXER_CONTRACT_CHANNEL_ID` and run:

```bash
npm run dev:contract
```

Set `FLUXER_CONTRACT_REPORT_PATH` as well if you want the harness to write a JSON report artifact for the run.
The harness also auto-loads `.env.contract.local`, `.env.contract`, `.env.local`, and `.env` when those files exist.

If you are targeting the official hosted Fluxer platform and need an honest hosted read/write confidence path without `gatewayBot`, run:

```bash
npm run dev:hosted
```

That path also supports `FLUXER_HOSTED_REPORT_PATH` and is documented in [docs/HostedInstanceConfidence.md](./docs/HostedInstanceConfidence.md).
It now proves hosted channel read-back through recent history, direct `fetchMessage(...)`, and an edit-plus-refetch cycle on the confirmed probe.

These examples live in `src/examples/real-instance-bootstrap.ts`, `src/examples/live-instance-contract.ts`, and `src/examples/hosted-instance-confidence.ts` and are documented in [docs/RealInstanceBootstrap.md](./docs/RealInstanceBootstrap.md), [docs/FirstRealBot.md](./docs/FirstRealBot.md), [docs/LiveInstanceContractHarness.md](./docs/LiveInstanceContractHarness.md), and [docs/HostedInstanceConfidence.md](./docs/HostedInstanceConfidence.md). They are meant to prove narrow live confidence layers, not to stand in for a full live contract matrix.

## What You Get Today

- `FluxerClient` and `FluxerBot`
- `MockTransport`, `RestTransport`, `GatewayTransport`, and `PlatformTransport`
- discovery/bootstrap helpers for hosted and self-hosted instances
- schema-driven prefix commands with typed args and flags
- command groups, guards, middleware, hooks, modules, and plugins
- rich payload builders for embeds, attachments, and validated message payloads
- mock-first testing through `FluxerTestRuntime`
- typed diagnostics for gateway, REST, discovery, payload validation, and platform bootstrap

## Docs And Guides

Guide layer:

- Wiki home: https://github.com/DeepLearningDev/Fluxer.js/wiki
- Getting started: https://github.com/DeepLearningDev/Fluxer.js/wiki/Getting-Started
- Core concepts: https://github.com/DeepLearningDev/Fluxer.js/wiki/Core-Concepts
- Transport and runtime: https://github.com/DeepLearningDev/Fluxer.js/wiki/Transport-And-Runtime

Reference docs:

- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Release policy: [docs/ReleasePolicy.md](./docs/ReleasePolicy.md)
- Real instance bootstrap: [docs/RealInstanceBootstrap.md](./docs/RealInstanceBootstrap.md)
- First real bot: [docs/FirstRealBot.md](./docs/FirstRealBot.md)
- Live instance contract harness: [docs/LiveInstanceContractHarness.md](./docs/LiveInstanceContractHarness.md)
- Hosted instance confidence: [docs/HostedInstanceConfidence.md](./docs/HostedInstanceConfidence.md)
- Waits and collectors: [docs/WaitsAndCollectors.md](./docs/WaitsAndCollectors.md)
- API guarantees: [docs/ApiGuarantees.md](./docs/ApiGuarantees.md)
- Gateway error codes: [docs/GatewayErrorCodes.md](./docs/GatewayErrorCodes.md)
- REST error codes: [docs/RestErrorCodes.md](./docs/RestErrorCodes.md)
- Migration notes: [docs/MigrationFromDiscordJS.md](./docs/MigrationFromDiscordJS.md)
- Plugin packaging conventions: [docs/PluginPackaging.md](./docs/PluginPackaging.md)

## Repo Workflow

Fluxer.JS uses `release:check` as the single release gate.

```bash
npm install
npm run dev:minimal
npm test
npm run release:check
```

## Current Limitations

- The framework is still alpha and the public API is not fully settled.
- Gateway lifecycle behavior is implemented and tested, but parts of that contract are still based on Discord-compatible assumptions.
- The test harness is still mock-first rather than a live Fluxer contract layer.
- Broader REST resource coverage, wider gateway normalization, and stronger beta-level confidence work are still in progress.
