import test from "node:test";
import assert from "node:assert/strict";
import { FluxerBot } from "../src/core/Bot.js";
import { parseCommandInput } from "../src/core/CommandParser.js";
import { FluxerClient } from "../src/core/Client.js";
import { MockTransport } from "../src/core/MockTransport.js";
import { createPermissionGuard } from "../src/core/Permissions.js";
import type { FluxerCommand, FluxerMessage } from "../src/core/types.js";

function createMessage(content: string, overrides: Partial<FluxerMessage> = {}): FluxerMessage {
  return {
    id: "msg_1",
    content,
    author: {
      id: "user_1",
      username: "fluxguy"
    },
    channel: {
      id: "general",
      name: "general",
      type: "text"
    },
    createdAt: new Date(),
    ...overrides
  };
}

test("runs middleware before executing commands", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const calls: string[] = [];

  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!"
  });

  bot.use(async (context, next) => {
    calls.push(`before:${context.commandName}`);
    await next();
    calls.push(`after:${context.commandName}`);
  });

  bot.command({
    name: "ping",
    execute: async () => {
      calls.push("execute:ping");
    }
  });

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!ping"));

  assert.deepEqual(calls, ["before:ping", "execute:ping", "after:ping"]);
});

test("blocks commands when permission guards fail", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const replies: string[] = [];

  client.sendMessage = async (_channelId: string, content: string) => {
    replies.push(content);
  };

  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!"
  });

  const restrictedCommand: FluxerCommand = {
    name: "admin",
    guards: [
      createPermissionGuard({
        allowUserIds: ["operator_1"],
        reason: "No access."
      })
    ],
    execute: () => {
      throw new Error("should not run");
    }
  };

  bot.command(restrictedCommand);

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!admin"));

  assert.deepEqual(replies, ["No access."]);
});

test("installs module commands once even if the module is re-used", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  let executions = 0;

  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!"
  });

  const moduleCommand: FluxerCommand = {
    name: "once",
    execute: async () => {
      executions += 1;
    }
  };

  const module = {
    name: "utility",
    commands: [moduleCommand]
  };

  bot.module(module);
  bot.module(module);

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!once"));

  assert.equal(executions, 1);
  assert.deepEqual(bot.modules, ["utility"]);
});

test("fires commandNotFound hooks for missing commands", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const missing: string[] = [];

  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!",
    hooks: {
      commandNotFound: ({ commandName }) => {
        missing.push(commandName);
      }
    }
  });

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!unknown"));

  assert.deepEqual(missing, ["unknown"]);
});

test("parses quoted command arguments", () => {
  const parsed = parseCommandInput('!say "hello world" test', "!");

  assert.deepEqual(parsed, {
    commandName: "say",
    args: ["hello world", "test"]
  });
});

test("matches commands case-insensitively by default", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  let executions = 0;

  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!"
  });

  bot.command({
    name: "Ping",
    execute: async () => {
      executions += 1;
    }
  });

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!ping"));

  assert.equal(executions, 1);
});

test("throws on duplicate command aliases", () => {
  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!"
  });

  bot.command({
    name: "ping",
    aliases: ["p"],
    execute: async () => {}
  });

  assert.throws(() => {
    bot.command({
      name: "pong",
      aliases: ["p"],
      execute: async () => {}
    });
  }, /already registered/);
});
