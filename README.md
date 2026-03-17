# Fluxer.JS

TypeScript framework for building bots on Fluxer.

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

## Getting started

```bash
npm install
npm run dev
npm test
```

## Example

```ts
import {
  EmbedBuilder,
  FluxerBot,
  FluxerClient,
  MessageBuilder,
  createEssentialsPlugin,
  createPermissionGuard
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
            )
        );
        state.lastCommand = "ping";
      }
    },
    {
      name: "admin",
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
    }
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

Rich messages are now builder-driven:

- `MessageBuilder` composes outbound payloads
- `EmbedBuilder` handles typed embed construction
- `client.sendMessage(...)` and `context.reply(...)` accept either strings or rich payloads

Plugins now sit above modules:

- `plugin(...)` installs synchronous packaged features
- `installPlugin(...)` handles plugins with async setup
- `createEssentialsPlugin()` provides a reusable higher-level command pack

## Project layout

- `src/core` contains the reusable framework pieces
- `src/example.ts` shows how a Fluxer bot is composed
- `src/index.ts` exports the public API

## Transport layers

The framework now supports three transport patterns:

- `MockTransport` for local development and tests
- `RestTransport` for outbound HTTP actions like sending messages
- `GatewayTransport` for realtime inbound events over WebSocket

If Fluxer uses separate HTTP and gateway channels, combine them with `PlatformTransport`.

The current implementation follows the official Fluxer docs:

- Discovery document: `GET /v1/.well-known/fluxer`
- Gateway bootstrap: `GET /v1/gateway/bot`
- Message send: `POST /v1/channels/{channel_id}/messages`
- Bot auth header: `Authorization: Bot <token>`

The gateway session layer currently assumes Discord-style gateway lifecycle semantics as an inference from Fluxer's quickstart guidance that the gateway is Discord-compatible. The official lifecycle page is still `TBD`, so the SDK treats these parts as adapter-safe defaults rather than a final protocol guarantee:

- `HELLO` starts the heartbeat loop
- `HEARTBEAT_ACK` clears the pending heartbeat state
- `RECONNECT` and invalid session payloads trigger reconnect
- `IDENTIFY` can be generated automatically from the bot token

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
- Rich message composition is typed and transport-aware
- Gateway dispatches and higher-level plugins now have first-class entry points
- Gateway normalization now covers members, presence, typing, roles, reactions, voice, channels, guilds, and messages

This is still not a production framework. The biggest missing pieces are:

- More gateway event payload normalization across the remaining Fluxer surface
- Rich message payload builders for embeds and attachments
- Plugin packaging, richer permissions, and more advanced command routing
- Packaging and versioned API guarantees

## Next steps

- Expand gateway event coverage and richer message builders
- Add release packaging and API versioning workflow
