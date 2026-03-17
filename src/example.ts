import { FluxerBot } from "./core/Bot.js";
import { FluxerClient } from "./core/Client.js";
import { MockTransport } from "./core/MockTransport.js";
import { createPermissionGuard } from "./core/Permissions.js";
import type { FluxerModule } from "./core/types.js";

const transport = new MockTransport();
const client = new FluxerClient(transport);

const bot = new FluxerBot({
  name: "StarterBot",
  prefix: "!",
  hooks: {
    commandNotFound: async ({ message, commandName }) => {
      if (commandName.length > 0) {
        console.log(`Unknown command "${commandName}" from ${message.author.username}`);
      }
    },
    commandError: async ({ error, commandContext }) => {
      console.error(`Command "${commandContext.commandName}" failed:`, error.message);
      await commandContext.reply("Something went wrong while running that command.");
    }
  }
});

bot.guard(({ message }) => {
  if (message.channel.type === "dm") {
    return "Commands are disabled in DMs for this bot.";
  }

  return true;
});

bot.use(async (context, next) => {
  const startedAt = Date.now();
  await next();
  context.state.durationMs = Date.now() - startedAt;
  console.log(`Command "${context.commandName}" finished in ${context.state.durationMs}ms`);
});

const utilityModule: FluxerModule = {
  name: "utility",
  commands: [
    {
      name: "ping",
      description: "Check whether the bot is alive.",
      execute: async ({ reply, state }) => {
        await reply("pong");
        state.lastCommand = "ping";
      }
    },
    {
      name: "echo",
      description: "Echo back the provided message.",
      guards: [
        ({ args }) => {
          if (args.length === 0) {
            return "Provide text to echo.";
          }

          return true;
        }
      ],
      execute: async ({ args, reply }) => {
        await reply(args.join(" ").trim());
      }
    },
    {
      name: "admin",
      description: "Restricted command for bot operators.",
      guards: [
        createPermissionGuard({
          allowUserIds: ["user_1"],
          allowChannelTypes: ["text"],
          reason: "This command is restricted to approved operators in server text channels."
        })
      ],
      execute: async ({ reply }) => {
        await reply("Admin command granted.");
      }
    }
  ]
};

bot.module(utilityModule);

client.on("ready", ({ connectedAt }) => {
  console.log(`Connected at ${connectedAt.toISOString()}`);
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

await transport.injectMessage({
  id: "msg_3",
  content: "!missing",
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

await transport.injectMessage({
  id: "msg_2",
  content: '!echo "Fluxer bot framework online"',
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

await transport.injectMessage({
  id: "msg_4",
  content: "!admin",
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
