# Fluxer.JS

TypeScript framework for building bots on Fluxer.

Current release channel: `0.1.0-alpha.1`

- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Release policy: [docs/ReleasePolicy.md](./docs/ReleasePolicy.md)
- API guarantees: [docs/ApiGuarantees.md](./docs/ApiGuarantees.md)
- Plugin packaging conventions: [docs/PluginPackaging.md](./docs/PluginPackaging.md)
- Migration notes: [docs/MigrationFromDiscordJS.md](./docs/MigrationFromDiscordJS.md)

## Current scope

This alpha currently includes:

- Strongly typed message and command contracts
- `FluxerClient` and `FluxerBot`
- `MockTransport`, `RestTransport`, `GatewayTransport`, and `PlatformTransport`
- Fluxer discovery/bootstrap helpers for hosted and self-hosted instances
- Command registration, prefix parsing, schemas, groups, and generated help
- Middleware, guards, and lifecycle hooks
- Rich message builders for embeds, attachments, and payload templates
- Mock-transport test helpers through `FluxerTestRuntime` and fixture builders

## Release posture

`Fluxer.JS` is currently an alpha framework. The foundation is real and test-backed, but the package is still moving toward a stable `1.0` contract.

Current expectations:

- alpha releases may still refine public APIs when doing so materially improves correctness or developer ergonomics
- package-root exports are the intended public surface
- deep imports into internal files should not be treated as stable
- release notes and the changelog should call out meaningful public changes explicitly
- CI runs `npm run release:check` as the authoritative verification path for pushes, pull requests, and release-tag verification

Important alpha caveats:

- the published package is ESM-only
- Node `>=20` is required
- the gateway session/runtime layer is implemented and tested, but parts of its lifecycle still rely on Discord-compatible assumptions because Fluxer's dedicated lifecycle docs are still incomplete
- the REST surface is still intentionally narrow, but it now covers bootstrap/discovery plus core read/write bot operations: fetch the current user, fetch users by id, fetch guild, list guild channels, fetch guild members, list guild roles, fetch channel, list messages, list pinned messages, indicate typing, and send/fetch/edit/delete messages
- real-instance bootstrap through `createFluxerPlatformTransport(...)` now surfaces typed `PlatformBootstrapError` failures for discovery, gateway-info, and unsupported-capability startup paths
- the exported low-level discovery helpers surface typed `DiscoveryError` failures for request, HTTP, and invalid-response cases
- release verification includes both a built-example smoke test and an installed-package smoke test through the published entrypoint
- many common gateway event families are normalized, but not the entire Fluxer surface yet
- this is not a production-ready framework yet

## Installation

For package consumers:

```bash
npm install fluxer-js
```

The published package is ESM-only and targets Node `>=20`.

If you want real Fluxer connectivity, pair `FluxerClient` with `createFluxerPlatformTransport(...)`. `new FluxerClient()` by itself uses `MockTransport`.
Real-instance bootstrap errors from `createFluxerPlatformTransport(...)` surface through `PlatformBootstrapError`.

## Repo workflow

Fluxer.JS currently targets Node `>=20`.

These commands are for working on this repository itself:

```bash
npm install
npm run dev:minimal
npm run dev
npm test
npm run release:check
```

`npm run dev:minimal` runs the smallest local bot example in `src/examples/minimal.ts`.
`npm run dev` runs the local example entrypoint in `src/example.ts`. By default that example uses the default `MockTransport` unless you wire in a real transport.

## Usage examples

### Minimal bot example

This is the shortest useful local example for trying the framework. It uses `MockTransport` explicitly so the behavior is obvious, injects one message, and logs the bot response.

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

In this repository, the same example lives in `src/examples/minimal.ts` and can be run with `npm run dev:minimal`.

### Full local bot example

This example is useful once you want to see more of the framework surface in one place. Because it uses `new FluxerClient()` with no transport argument, it runs on the default `MockTransport`.

```ts
import {
  AttachmentBuilder,
  EmbedBuilder,
  FluxerBot,
  FluxerClient,
  MessageBuilder,
  createEmbedTemplate,
  serializeMessagePayload,
  attachDebugHandler,
  createConsoleDebugHandler,
  createEssentialsPlugin,
  createPermissionGuard,
  defineCommand,
  defineCommandGroup
} from "fluxer-js";
import type { FluxerModule } from "fluxer-js";

const client = new FluxerClient();
const bot = new FluxerBot({
  name: "EchoBot",
  prefix: "!",
  hooks: {
    commandError: async ({ commandContext }) => {
      await commandContext.reply("That command failed.");
    }
  }
});

attachDebugHandler(
  client,
  createConsoleDebugHandler({
    minLevel: "info"
  })
);

bot.guard(({ message }) => message.channel.type !== "dm" || "DMs are disabled.");

bot.use(async (context, next) => {
  const startedAt = Date.now();
  await next();
  context.state.durationMs = Date.now() - startedAt;
});

const utilityModule: FluxerModule = {
  name: "utility",
  commands: [
    {
      name: "ping",
      description: "Replies with pong",
      execute: async ({ reply, state }) => {
        await reply(
          new MessageBuilder()
            .setContent("pong")
            .addEmbed(
              new EmbedBuilder()
                .setTitle("Heartbeat")
                .setDescription("Bot is online.")
                .setColorHex("#2f855a")
                .setTimestampNow()
                .setAttachmentThumbnail("status.png")
                .addInlineField("Command", "ping")
            )
            .addAttachment(
              new AttachmentBuilder()
                .setFilename("status.png")
                .setContentType("image/png")
                .setData(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
            )
            .addAttachment(
              new AttachmentBuilder()
                .setFilename("status.json")
                .setJson({ healthy: true }, 2)
            )
        );
        state.lastCommand = "ping";
      }
    },
    defineCommandGroup({
      name: "admin",
      description: "Administrative commands.",
      commands: [
        defineCommand({
          name: "grant",
          guards: [
            createPermissionGuard({
              allowUserIds: ["123"],
              allowChannelTypes: ["text"],
              reason: "Only operators can use this command."
            })
          ],
          execute: async ({ reply }) => {
            await reply("Admin access granted.");
          }
        }),
        defineCommand({
          name: "status",
          execute: async ({ reply }) => {
            await reply("Admin systems nominal.");
          }
        })
      ]
    }),
    defineCommand({
      name: "echo",
      description: "Echoes text with optional formatting flags.",
      schema: {
        args: [{ name: "text", required: true, rest: true }],
        flags: [{ name: "upper", short: "u" }],
        allowUnknownFlags: false
      },
      execute: async ({ input, reply }) => {
        const text = input.args.text.join(" ");
        await reply(input.flags.upper ? text.toUpperCase() : text);
      }
    }),
    defineCommand({
      name: "schedule",
      description: "Schedules a task with schema defaults and coercion.",
      schema: {
        args: [
          { name: "task", required: true },
          { name: "priority", enum: ["low", "normal", "high"], defaultValue: "normal" }
        ],
        flags: [
          {
            name: "delay",
            type: "number",
            defaultValue: 0,
            coerce: (value) => Number(value.replace(/m$/, ""))
          }
        ],
        allowUnknownFlags: false
      },
      execute: async ({ input, reply }) => {
        await reply(
          `${input.args.task}:${input.args.priority}:${input.flags.delay}`
        );
      }
    })
  ]
};

bot.module(utilityModule);
bot.plugin(createEssentialsPlugin());

client.registerBot(bot);
await client.connect();
```

### Real instance bootstrap

Use `createFluxerPlatformTransport(...)` when you want the client to talk to a real Fluxer instance over REST plus gateway transport.
Bootstrap failures in this path surface through `PlatformBootstrapError` with stable codes for discovery failure, gateway-info failure, and unsupported instance capabilities.
When a debug handler is attached, this bootstrap path also emits structured transport events for instance detection, blocked bootstrap, bootstrap failures, and successful platform bootstrap completion.

For synchronous modules, use `bot.module(...)`. If a module needs async setup, use `await bot.installModule(...)` so startup remains deterministic.

Core command behavior is intentionally strict:

- Command keys are case-insensitive by default
- Duplicate command names and aliases throw immediately
- Quoted arguments are parsed as a single argument
- Empty command invocations are ignored cleanly
- Schema-defined args and flags are validated before execution
- Invalid schema input replies with a usage string by default
- `defineCommand(...)` preserves typed `input.args` and `input.flags`
- args and flags support `defaultValue`, enum validation, and custom `coerce(...)`
- multi-word commands resolve to the longest registered command name
- `defineCommandGroup(...)` expands grouped subcommands without manual name prefixing
- `context.awaitReply(...)` and `client.waitForMessage(...)` support conversational flows

Rich messages are now builder-driven:

- `MessageBuilder` composes outbound payloads
- `EmbedBuilder` handles typed embed construction
- `AttachmentBuilder` composes file attachments and supports `attachment://filename` embed references
- `EmbedBuilder` now supports convenience methods like `setColorHex(...)`, `setTimestampNow()`, `addInlineField(...)`, and `addFieldsFromRecord(...)`
- `AttachmentBuilder#setJson(...)` helps generate structured file payloads without manual serialization
- `createEmbedTemplate(...)` and `createMessageTemplate(...)` let bots reuse validated payload templates
- `serializeMessagePayload(...)` exposes the exact JSON-safe payload shape used by the REST serializer
- `validateMessagePayload(...)` enforces safe defaults before the transport sends malformed payloads
- `client.sendMessage(...)` and `context.reply(...)` accept either strings or rich payloads
- `client.listMessages(...)` exposes the current channel message listing surface with `limit`, `before`, `after`, and `around`
- `client.fetchCurrentUser(...)` exposes the current authenticated-user read surface
- `client.fetchUser(...)` exposes the current user-by-id read surface
- `client.fetchGuild(...)` exposes the current guild fetch surface
- `client.listGuildChannels(...)` exposes the current guild channel-list surface
- `client.fetchGuildMember(...)` exposes the current guild-member read surface
- `client.listGuildRoles(...)` exposes the current guild role-list surface
- `client.fetchChannel(...)` exposes the current channel fetch surface
- `client.listPinnedMessages(...)` exposes the current pinned-message read surface with `limit`, `before`, `items`, and `hasMore`
- `client.indicateTyping(...)` exposes the current typing indicator surface
- `client.fetchMessage(...)`, `client.editMessage(...)`, and `client.deleteMessage(...)` expose the current message lifecycle surface

Serializer preview example:

```ts
const baseEmbed = createEmbedTemplate(
  new EmbedBuilder()
    .setTitle("Status")
    .setColorHex("#4f46e5")
    .addInlineField("Shard", "0")
);

const payload = serializeMessagePayload(
  new MessageBuilder()
    .setContent("Deployment complete")
    .addEmbed(baseEmbed(new EmbedBuilder().setDescription("All services healthy.")))
    .addAttachment(
      new AttachmentBuilder()
        .setFilename("deploy.json")
        .setJson({ ok: true }, 2)
    )
);

console.log(payload);
```

Detailed payload-builder docs and serializer examples live in [docs/PayloadBuilders.md](./docs/PayloadBuilders.md).

## Packaging and migration docs

- Release flow and version channel policy: [docs/ReleasePolicy.md](./docs/ReleasePolicy.md)
- Public API guarantee scope: [docs/ApiGuarantees.md](./docs/ApiGuarantees.md)
- Plugin package conventions: [docs/PluginPackaging.md](./docs/PluginPackaging.md)
- `discord.js` migration notes: [docs/MigrationFromDiscordJS.md](./docs/MigrationFromDiscordJS.md)

Plugins now sit above modules:

- `plugin(...)` installs synchronous packaged features
- `installPlugin(...)` handles plugins with async setup
- `createEssentialsPlugin()` provides a reusable higher-level command pack

Generated help is now metadata-driven:

- `description`, `usage`, `aliases`, `examples`, and command schemas feed the built-in `help` command
- hidden commands stay out of the default help surface
- `!help` now separates standalone commands from command groups
- `!help <command>` renders detailed usage, arguments, flags, aliases, and examples
- `!help <group>` renders grouped subcommand help with aliases and usage
- argument and flag descriptions are rendered directly in detailed help output

Conversation flows now have first-class primitives:

```ts
bot.command({
  name: "confirm",
  execute: async ({ reply, awaitReply }) => {
    await reply("Reply with yes to confirm.");
    const response = await awaitReply({
      timeoutMs: 5_000,
      filter: (message) => message.content.toLowerCase() === "yes"
    });
    await reply(`Confirmed: ${response.content}`);
  }
});
```

## Project layout

- `src/core` contains the reusable framework pieces
- `src/examples/minimal.ts` is the smallest runnable local bot example
- `src/example.ts` is a broader framework showcase
- `src/index.ts` exports the public API

## Transport layers

The framework now supports three transport patterns:

- `MockTransport` for local development and tests
- `RestTransport` for HTTP actions like fetching channels, indicating typing, plus listing, sending, fetching, editing, and deleting messages
- `GatewayTransport` for realtime inbound events over WebSocket

For test-heavy workflows, `FluxerTestRuntime` wraps `MockTransport` with fixture builders and deterministic event injection:

```ts
import { FluxerBot, FluxerTestRuntime } from "fluxer-js";

const runtime = new FluxerTestRuntime();
const bot = new FluxerBot({ name: "TestBot", prefix: "!" });

bot.command({
  name: "ping",
  execute: async ({ reply }) => {
    await reply("pong");
  }
});

runtime.registerBot(bot);
await runtime.connect();
await runtime.injectMessage("!ping");

console.log(runtime.sentMessages[0]?.content); // "pong"
console.log((await runtime.waitForSentMessage()).content); // "pong"
```

`FluxerTestRuntime.waitForSentMessage(...)` lets tests observe the real outbound transport path without monkeypatching `client.sendMessage(...)`.

This is still a mock-first harness. It improves framework-level test confidence, but it is not a live Fluxer contract test layer.

`PlatformTransport` is the composed transport used by `createFluxerPlatformTransport(...)` for separate REST and gateway channels.

Command metadata can also be inspected programmatically when you want to build your own help UI, docs, or admin panels:

```ts
const catalog = bot.createCommandCatalog();
const echo = bot.getCommandDescriptor("echo");
const admin = bot.getCommandGroupDescriptor("admin");

console.log(catalog.commands);
console.log(catalog.groups);
console.log(echo?.args);
console.log(admin?.commands);
```

The current bootstrap and message-send layer align with the documented Fluxer routes:

- Discovery document: `GET /v1/.well-known/fluxer`
- Gateway bootstrap: `GET /v1/gateway/bot`
- Message send: `POST /v1/channels/{channel_id}/messages`
- Bot auth header: `Authorization: Bot <token>`

Gateway lifecycle behavior is still described separately below because parts of that contract are currently inferred from Fluxer's Discord-compatible guidance rather than a finished dedicated lifecycle spec.

## Gateway Event Contract

`FluxerClient` exposes two layers of gateway events:

- raw `gatewayDispatch`, which gives access to the original gateway envelope after transport parsing
- normalized high-level events for common bot surfaces like messages, channels, guilds, invites, moderation, members, presence, typing, roles, reactions, and voice

The current normalized event contract is:

- message lifecycle: `messageCreate`, `messageUpdate`, `messageDelete`, `messageDeleteBulk`
- channel lifecycle: `channelCreate`, `channelUpdate`, `channelDelete`, `channelPinsUpdate`
- guild lifecycle: `guildCreate`, `guildUpdate`, `guildDelete`
- role lifecycle: `roleCreate`, `roleUpdate`, `roleDelete`
- member lifecycle: `guildMemberAdd`, `guildMemberUpdate`, `guildMemberRemove`
- moderation/invites: `guildBanAdd`, `guildBanRemove`, `inviteCreate`, `inviteDelete`
- activity/status: `presenceUpdate`, `typingStart`, `userUpdate`
- reactions/voice: `messageReactionAdd`, `messageReactionRemove`, `voiceStateUpdate`, `voiceServerUpdate`
- runtime surfaces: `gatewayStateChange`, `gatewaySessionUpdate`, `debug`, `error`

If a Fluxer dispatch is not normalized yet, bot code can still consume it through `gatewayDispatch` without waiting for a new SDK release.

Field-level payload docs for every currently normalized gateway event live in [docs/GatewayEventContract.md](./docs/GatewayEventContract.md).

The gateway session layer currently assumes Discord-style gateway lifecycle semantics as an inference from Fluxer's quickstart guidance that the gateway is Discord-compatible. The official lifecycle page is still `TBD`, so the SDK treats these parts as adapter-safe defaults rather than a final protocol guarantee:

- `HELLO` starts the heartbeat loop
- `HEARTBEAT_ACK` clears the pending heartbeat state
- `RECONNECT` and invalid session payloads trigger reconnect
- `IDENTIFY` can be generated automatically from the bot token

## Runtime Guarantees And Assumptions

Current runtime guarantees:

- gateway connection state changes are surfaced through `gatewayStateChange`
- session updates are surfaced through `gatewaySessionUpdate`
- resumable sessions are tracked explicitly and reused on reconnect when possible
- heartbeat ack loss is treated as a transport failure and triggers reconnect
- invalid sessions distinguish resumable vs non-resumable invalidation
- transport/protocol failures surface typed errors instead of generic strings
- raw dispatch access remains available even when a payload is not normalized yet

Typed diagnostics currently cover failure modes such as:

- invalid JSON payloads
- malformed `HELLO` payloads
- missing identify payload generation
- reconnect exhaustion or reconnect-disabled paths

A code-by-code reference for current gateway failures lives in [docs/GatewayErrorCodes.md](./docs/GatewayErrorCodes.md).

Non-gateway transport failures now also surface typed `RestTransportError` instances for configuration, discovery, request, and HTTP response failures. Reference: [docs/RestErrorCodes.md](./docs/RestErrorCodes.md).

Rate-limited REST responses are classified separately and include retry metadata when the server provides it, but the framework does not automatically retry or back off for you yet.

Current assumptions:

- Fluxer gateway opcodes and session lifecycle are close enough to Discord-style semantics for `HELLO`, `IDENTIFY`, `RESUME`, `RECONNECT`, `INVALID_SESSION`, and `HEARTBEAT_ACK`
- gateway message parsing and dispatch parsing are adapter-safe defaults, not a final protocol lock
- unsupported outbound gateway actions should go through `RestTransport` or a composed `PlatformTransport`, not `GatewayTransport` directly

```ts
import {
  FluxerBot,
  FluxerClient,
  PlatformBootstrapError,
  createFluxerPlatformTransport,
} from "fluxer-js";

try {
  const transport = await createFluxerPlatformTransport({
    instanceUrl: "https://api.fluxer.app",
    auth: { token: process.env.FLUXER_TOKEN ?? "" },
    intents: 513,
    onInstanceInfo: (instance) => {
      console.log(instance.isSelfHosted, instance.apiCodeVersion, instance.capabilities);
    }
  });

  const client = new FluxerClient(transport);
} catch (error) {
  if (error instanceof PlatformBootstrapError) {
    console.error(error.code, error.details);
  }
  throw error;
}
```

`createFluxerPlatformTransport(...)` uses the built-in `defaultParseMessageEvent(...)` parser unless you override `parseMessageEvent` explicitly.

## Progress

Current state is the SDK foundation layer:

- Command parsing and bot lifecycle are in place
- The client is now transport-driven instead of hard-coded to console output
- `MockTransport` supports local development and deterministic tests alongside the current REST and gateway transports
- Middleware, guard, and hook execution now exist as first-class bot framework features
- Modules and declarative permission policies now exist as first-class composition tools
- Build output and command parsing are now deterministic and test-backed
- Rich message composition now covers embeds, attachments, templates, and transport-aware validation
- Gateway dispatches and higher-level plugins now have first-class entry points
- Gateway normalization now covers messages, bulk message deletes, channel pin updates, channels, guilds, moderation, invites, members, presence, typing, roles, reactions, and voice
- Gateway runtime now exposes state/session transitions, typed protocol errors, and structured debug hooks
- Prefix commands now support schema-based args and flags with typed command input
- `MockTransport` now captures outbound messages and powers a reusable `FluxerTestRuntime`
- Client and command lifecycles now emit structured debug events with attachable console logging
- Platform bootstrap now detects instance capabilities from discovery documents and surfaces self-hosted instance info

This is still not a production framework. The biggest missing pieces are:

- More gateway event payload normalization across the remaining Fluxer surface
- Dedicated attachment lifecycle APIs beyond message-send serialization
- Broader REST resource coverage beyond the current bootstrap, guild/channel/member reads, and core message operations
- Stable API guarantees and release progression beyond alpha

## Next steps

- Expand gateway event coverage, REST surface area, and attachment/payload lifecycle APIs
- Keep tightening runtime contracts and move toward beta-level API stability
