# Migrating From discord.js

`Fluxer.JS` is not trying to be a shallow clone of `discord.js`, but it does intentionally preserve familiar patterns where they help developers move quickly.

## Familiar concepts

If you know `discord.js`, the closest matching ideas are:

- `Client` -> `FluxerClient`
- command/message handler layer -> `FluxerBot`
- middleware/guards/hooks -> framework-owned execution pipeline
- message builders -> `MessageBuilder`, `EmbedBuilder`, `AttachmentBuilder`
- event listeners -> `client.on(...)`
- collectors / wait-for patterns -> `client.waitFor(...)`, `client.waitForMessage(...)`, `context.awaitReply(...)`

## Main differences

- `Fluxer.JS` treats prefix-command ergonomics as a first-class framework concern instead of leaving all routing to userland.
- self-hosted instance discovery and capability handling are part of the core package.
- transport boundaries are explicit: mock, REST, gateway, and composed platform transports are separate abstractions.
- raw gateway dispatch access remains available even when normalized events exist.

## Common porting pattern

### discord.js style

```ts
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!ping")) return;
  await message.reply("pong");
});
```

### Fluxer.JS style

```ts
const bot = new FluxerBot({ name: "Example", prefix: "!" });

bot.command({
  name: "ping",
  execute: async ({ reply }) => {
    await reply("pong");
  }
});

client.registerBot(bot);
```

## Why this is useful

- less repeated command parsing boilerplate
- typed command input for schema-based args and flags
- consistent hooks, middleware, guards, diagnostics, and testing patterns

## Rich payloads

Instead of hand-building message objects repeatedly, prefer:

- `MessageBuilder`
- `EmbedBuilder`
- `AttachmentBuilder`
- `createMessageTemplate(...)`

## Migration advice

- start by porting event listeners and basic commands into `FluxerBot`
- use `gatewayDispatch` for platform events that are not normalized yet
- move rich payload helpers into builders/templates early so commands stay small
- use `FluxerTestRuntime` to lock behavior down while migrating larger bots
