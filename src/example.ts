import { FluxerBot } from "./core/Bot.js";
import { EmbedBuilder, MessageBuilder } from "./core/builders.js";
import { defineCommand, defineCommandGroup } from "./core/CommandSchema.js";
import { FluxerClient } from "./core/Client.js";
import { attachDebugHandler, createConsoleDebugHandler } from "./core/Diagnostics.js";
import { MockTransport } from "./core/MockTransport.js";
import { createPermissionGuard } from "./core/Permissions.js";
import type { CommandContext, FluxerModule } from "./core/types.js";
import { createEssentialsPlugin } from "./plugins/essentials.js";

const transport = new MockTransport();
const client = new FluxerClient(transport);
attachDebugHandler(
  client,
  createConsoleDebugHandler({
    minLevel: "info"
  })
);

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

const echoCommand = defineCommand({
  name: "echo",
  description: "Echo back the provided message.",
  examples: ['!echo "hello world"', '!echo --upper "hello world"'],
  schema: {
    args: [
      { name: "text", required: true, rest: true }
    ] as const,
    flags: [
      { name: "upper", short: "u" }
    ] as const,
    allowUnknownFlags: false
  },
  guards: [
    ({ input }) => {
      const text = input?.args.text;
      if (!Array.isArray(text) || text.length === 0) {
        return "Provide text to echo.";
      }

      return true;
    }
  ],
  execute: async ({ input, reply }) => {
    const text = Array.isArray(input?.args.text) ? input.args.text.join(" ").trim() : "";
    await reply(input?.flags.upper ? text.toUpperCase() : text);
  }
});

const utilityModule: FluxerModule = {
  name: "utility",
  commands: [
    {
      name: "ping",
      description: "Check whether the bot is alive.",
      examples: ["!ping"],
      execute: async ({ reply, state }: CommandContext) => {
        await reply(
          new MessageBuilder()
            .setContent("pong")
            .addEmbed(
              new EmbedBuilder()
                .setTitle("Heartbeat")
                .setDescription("StarterBot is online.")
                .addField({ name: "Command", value: "ping", inline: true })
                .setColor(0x2f855a)
            )
        );
        state.lastCommand = "ping";
      }
    },
    echoCommand,
    defineCommandGroup({
      name: "admin",
      description: "Restricted operator commands.",
      examples: ["!admin grant", "!admin status"],
      commands: [
        defineCommand({
          name: "grant",
          description: "Grant operator access.",
          guards: [
            createPermissionGuard({
              allowUserIds: ["user_1"],
              allowChannelTypes: ["text"],
              reason: "This command is restricted to approved operators in server text channels."
            })
          ],
          execute: async ({ reply }: CommandContext) => {
            await reply("Admin command granted.");
          }
        }),
        defineCommand({
          name: "status",
          description: "Show operator system status.",
          execute: async ({ reply }: CommandContext) => {
            await reply("Admin systems nominal.");
          }
        })
      ]
    })
  ]
};

bot.module(utilityModule);
bot.plugin(
  createEssentialsPlugin({
    aboutText: "StarterBot runs on Fluxer.JS."
  })
);

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
  content: "!admin grant",
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
  id: "msg_5",
  content: "!help admin",
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
  id: "msg_6",
  content: "!about",
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
