# Fluxer.JS

TypeScript framework for building bots on Fluxer.

Current release channel: `0.1.0-alpha.0`

- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Release policy: [docs/ReleasePolicy.md](./docs/ReleasePolicy.md)
- API guarantees: [docs/ApiGuarantees.md](./docs/ApiGuarantees.md)
- Plugin packaging conventions: [docs/PluginPackaging.md](./docs/PluginPackaging.md)
- Migration notes: [docs/MigrationFromDiscordJS.md](./docs/MigrationFromDiscordJS.md)

## Current scope

This bootstrap gives you a clean starting point for a bot SDK:

- Strongly typed message and command contracts
- A lightweight `FluxerClient` event layer
- A transport abstraction for real Fluxer adapters later
- A reusable `FluxerBot` base class
- Command registration and prefix parsing
- Middleware, guards, and lifecycle hooks
- Precise command parsing and duplicate-safe registration
- An example bot entrypoint for local iteration

## Release posture

`Fluxer.JS` is currently an alpha framework. The foundation is real and test-backed, but the package is still moving toward a stable `1.0` contract.

Current expectations:

- alpha releases may still refine public APIs when doing so materially improves correctness or developer ergonomics
- package-root exports are the intended public surface
- deep imports into internal files should not be treated as stable
- release notes and the changelog should call out meaningful public changes explicitly

## Getting started

```bash
npm install
npm run dev
npm test
npm run release:check
```

## Example

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
- `src/example.ts` shows how a Fluxer bot is composed
- `src/index.ts` exports the public API

## Transport layers

The framework now supports three transport patterns:

- `MockTransport` for local development and tests
- `RestTransport` for outbound HTTP actions like sending messages
- `GatewayTransport` for realtime inbound events over WebSocket

For test-heavy workflows, `FluxerTestRuntime` now wraps `MockTransport` with fixture builders and deterministic event injection:

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
```

If Fluxer uses separate HTTP and gateway channels, combine them with `PlatformTransport`.

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

The current implementation follows the official Fluxer docs:

- Discovery document: `GET /v1/.well-known/fluxer`
- Gateway bootstrap: `GET /v1/gateway/bot`
- Message send: `POST /v1/channels/{channel_id}/messages`
- Bot auth header: `Authorization: Bot <token>`

## Gateway Event Contract

`FluxerClient` exposes two layers of gateway events:

- raw `gatewayDispatch`, which gives access to the original gateway envelope after transport parsing
- normalized high-level events for common bot surfaces like messages, channels, guilds, invites, moderation, members, presence, typing, roles, reactions, and voice

The current normalized event contract is:

- message lifecycle: `messageCreate`, `messageUpdate`, `messageDelete`
- channel lifecycle: `channelCreate`, `channelUpdate`, `channelDelete`
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

Current assumptions:

- Fluxer gateway opcodes and session lifecycle are close enough to Discord-style semantics for `HELLO`, `IDENTIFY`, `RESUME`, `RECONNECT`, `INVALID_SESSION`, and `HEARTBEAT_ACK`
- gateway message parsing and dispatch parsing are adapter-safe defaults, not a final protocol lock
- unsupported outbound gateway actions should go through `RestTransport` or a composed `PlatformTransport`, not `GatewayTransport` directly

```ts
import {
  FluxerBot,
  FluxerClient,
  createFluxerPlatformTransport,
  defaultParseMessageEvent
} from "fluxer-js";

const transport = await createFluxerPlatformTransport({
  instanceUrl: "https://api.fluxer.app",
  auth: { token: process.env.FLUXER_TOKEN ?? "" },
  intents: 513,
  onInstanceInfo: (instance) => {
    console.log(instance.isSelfHosted, instance.apiCodeVersion, instance.capabilities);
  },
  parseMessageEvent: defaultParseMessageEvent
});

const client = new FluxerClient(transport);
```

## Progress

Current state is the SDK foundation layer:

- Command parsing and bot lifecycle are in place
- The client is now transport-driven instead of hard-coded to console output
- `MockTransport` supports local development while the real Fluxer transport is built
- Middleware, guard, and hook execution now exist as first-class bot framework features
- Modules and declarative permission policies now exist as first-class composition tools
- Build output and command parsing are now deterministic and test-backed
- Rich message composition now covers embeds, attachments, templates, and transport-aware validation
- Gateway dispatches and higher-level plugins now have first-class entry points
- Gateway normalization now covers messages, channels, guilds, moderation, invites, members, presence, typing, roles, reactions, and voice
- Gateway runtime now exposes state/session transitions, typed protocol errors, and structured debug hooks
- Prefix commands now support schema-based args and flags with typed command input
- `MockTransport` now captures outbound messages and powers a reusable `FluxerTestRuntime`
- Client and command lifecycles now emit structured debug events with attachable console logging
- Platform bootstrap now detects instance capabilities from discovery documents and surfaces self-hosted instance info

This is still not a production framework. The biggest missing pieces are:

- More gateway event payload normalization across the remaining Fluxer surface
- Dedicated attachment lifecycle APIs beyond message-send serialization
- Richer permissions and more advanced command routing
- Automated release workflow and a stable API contract progression beyond alpha

## Next steps

- Expand gateway event coverage and attachment/payload lifecycle APIs
- Tighten release workflow automation and continue toward beta-level API stability
