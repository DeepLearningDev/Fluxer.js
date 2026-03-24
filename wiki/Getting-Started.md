# Getting Started

## Requirements

- Node `>=20`
- ESM environment
- `npm install fluxer-js`

## Fastest Local Path

Use `MockTransport` first. It gives you a zero-network bot loop and makes behavior obvious.

```ts
import { FluxerBot, FluxerClient, MockTransport } from "fluxer-js";

const transport = new MockTransport();
const client = new FluxerClient(transport);
const bot = new FluxerBot({ name: "HelloBot", prefix: "!" });

bot.command({
  name: "ping",
  execute: async ({ reply }) => {
    await reply("pong");
  }
});

client.registerBot(bot);
await client.connect();
```

## First Success Checklist

1. Register a bot.
2. Add one command.
3. Connect the client.
4. Inject a message through `MockTransport`.
5. Assert against sent messages.

## Real Instance Path

When you are ready for a real Fluxer instance, switch to `createFluxerPlatformTransport(...)`.

```ts
import { FluxerClient, createFluxerPlatformTransport } from "fluxer-js";

const transport = await createFluxerPlatformTransport({
  instanceUrl: "https://api.fluxer.app",
  auth: { token: process.env.FLUXER_TOKEN ?? "" },
  intents: 513,
});

const client = new FluxerClient(transport);
await client.connect();
```

## Where To Go Next

- [Core Concepts](./Core-Concepts.md)
- [Commands And Conversations](./Commands-And-Conversations.md)
- [Transport And Runtime](./Transport-And-Runtime.md)
