import test from 'node:test';
import assert from 'node:assert/strict';
import { FluxerBot } from '../src/core/Bot.js';
import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageBuilder,
  createAttachmentUrl,
  createEmbedTemplate,
  createMessageTemplate,
  resolveMessagePayload,
  serializeMessagePayload,
  validateMessagePayload
} from '../src/core/builders.js';
import { parseCommandInput } from '../src/core/CommandParser.js';
import {
  defineCommand,
  defineCommandGroup,
  parseCommandSchemaInput
} from '../src/core/CommandSchema.js';
import { FluxerClient } from '../src/core/Client.js';
import {
  FluxerMessageCollector,
  waitForMessage
} from '../src/core/Collectors.js';
import {
  attachDebugHandler,
  createConsoleDebugHandler,
  shouldLogDebugEvent
} from '../src/core/Diagnostics.js';
import {
  CommandSchemaError,
  FluxerError,
  PayloadValidationError,
  WaitForTimeoutError
} from '../src/core/errors.js';
import { MockTransport } from '../src/core/MockTransport.js';
import { createPermissionGuard } from '../src/core/Permissions.js';
import { createEssentialsPlugin } from '../src/plugins/essentials.js';
import { FluxerTestRuntime } from '../src/testing/TestRuntime.js';
import { createTestGatewayDispatch, createTestMessage } from '../src/testing/fixtures.js';
import type { FluxerCommand, FluxerMessage, SendMessagePayload } from '../src/core/types.js';
function createMessage(content: string, overrides: Partial<FluxerMessage> = {}): FluxerMessage {
  return {
    id: 'msg_1',
    content,
    author: {
      id: 'user_1',
      username: 'fluxguy'
    },
    channel: {
      id: 'general',
      name: 'general',
      type: 'text'
    },
    createdAt: new Date(),
    ...overrides
  };
}test("runs middleware before executing commands", async () => {
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
  const runtime = new FluxerTestRuntime();

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

  runtime.registerBot(bot);
  await runtime.connect();

  const replyPromise = runtime.waitForSentMessage({
    filter: (payload) => payload.channelId === "general"
  });
  await runtime.injectMessage(createMessage("!admin"));
  const reply = await replyPromise;

  assert.equal(reply.channelId, "general");
  assert.equal(reply.content, "No access.");
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

test("mock transport captures sends and emits injected runtime events", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const events: string[] = [];

  client.on("gatewayStateChange", ({ state }) => {
    events.push(`state:${state}`);
  });

  client.on("gatewaySessionUpdate", ({ sessionId, sequence }) => {
    events.push(`session:${sessionId}:${sequence}`);
  });

  client.on("debug", ({ event }) => {
    events.push(`debug:${event}`);
  });

  await client.connect();
  await client.sendMessage("general", "pong");
  await transport.injectGatewayStateChange({
    previousState: "connected",
    state: "ready"
  });
  await transport.injectGatewaySessionUpdate({
    sessionId: "session_1",
    sequence: 2,
    resumable: true
  });
  await transport.injectDebug({
    scope: "gateway",
    event: "test_event",
    timestamp: new Date().toISOString()
  });

  assert.deepEqual(transport.sentMessages, [
    {
      channelId: "general",
      content: "pong"
    }
  ]);
  assert.ok(events.includes("state:ready"));
  assert.ok(events.includes("session:session_1:2"));
  assert.ok(events.includes("debug:test_event"));
});

test("emits structured debug events for client and command lifecycles", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const bot = new FluxerBot({
    name: "DebugBot",
    prefix: "!"
  });
  const events: string[] = [];

  attachDebugHandler(client, (event) => {
    events.push(`${event.scope}:${event.event}:${event.level ?? "debug"}`);
  });

  bot.command({
    name: "ping",
    execute: async ({ reply }) => {
      await reply("pong");
    }
  });

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!ping"));
  await client.disconnect();

  assert.ok(events.includes("client:bot_registered:info"));
  assert.ok(events.includes("client:connect_started:info"));
  assert.ok(events.includes("client:send_message_started:debug"));
  assert.ok(events.includes("command:command_started:info"));
  assert.ok(events.includes("command:command_finished:info"));
  assert.ok(events.includes("client:disconnect_succeeded:info"));
});

test("filters debug events by level", () => {
  assert.equal(
    shouldLogDebugEvent(
      {
        scope: "client",
        event: "send_message_started",
        level: "debug",
        timestamp: new Date().toISOString()
      },
      "info"
    ),
    false
  );

  assert.equal(
    shouldLogDebugEvent(
      {
        scope: "command",
        event: "command_failed",
        level: "error",
        timestamp: new Date().toISOString()
      },
      "info"
    ),
    true
  );
});

test("formats console debug output", () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    lines.push(String(message));
  };

  try {
    const handler = createConsoleDebugHandler({
      minLevel: "debug",
      includeData: true
    });

    handler({
      scope: "command",
      event: "command_finished",
      level: "info",
      timestamp: new Date().toISOString(),
      data: {
        commandName: "ping",
        durationMs: 1
      }
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[Fluxer\]\[command\]\[info\] command_finished/);
  assert.match(lines[0], /"commandName":"ping"/);
});

test("test runtime builds fixtures and drives bot interactions deterministically", async () => {
  const runtime = new FluxerTestRuntime();
  const bot = new FluxerBot({
    name: "RuntimeBot",
    prefix: "!"
  });
  const deletedMessages: string[] = [];

  bot.command({
    name: "ping",
    execute: async ({ reply }) => {
      await reply("pong");
    }
  });

  runtime.client.on("messageDelete", ({ id }) => {
    deletedMessages.push(id);
  });

  runtime.registerBot(bot);
  await runtime.connect();
  await runtime.injectMessage("!ping");
  await runtime.injectMessage(createTestMessage("!ping", { id: "fixture_msg" }));
  await runtime.injectGatewayDispatch(
    createTestGatewayDispatch("MESSAGE_DELETE", {
      id: "msg_deleted",
      channel_id: "general"
    })
  );

  assert.deepEqual(
    runtime.sentMessages.map((payload) => payload.content),
    ["pong", "pong"]
  );
  assert.deepEqual(deletedMessages, ["msg_deleted"]);
  assert.equal(runtime.createMessage("!ping").id, "msg_2");
});

test("parses schema-based command args and flags", () => {
  const schema = {
    args: [
      { name: "target", required: true },
      { name: "amount", type: "number", required: true },
      { name: "reason", rest: true }
    ],
    flags: [
      { name: "silent", short: "s" },
      { name: "timeout", short: "t", type: "number" },
      { name: "tag", type: "string", multiple: true }
    ],
    allowUnknownFlags: false
  } as const;

  const parsed = parseCommandSchemaInput(
    ["user_2", "7", "rule", "violation", "--silent", "--timeout=30", "--tag", "spam", "--tag", "urgent"],
    schema,
    { prefix: "!", commandName: "ban" }
  );

  assert.deepEqual(parsed, {
    args: {
      target: "user_2",
      amount: 7,
      reason: ["rule", "violation"]
    },
    flags: {
      silent: true,
      timeout: 30,
      tag: ["spam", "urgent"]
    },
    rawArgs: [
      "user_2",
      "7",
      "rule",
      "violation",
      "--silent",
      "--timeout=30",
      "--tag",
      "spam",
      "--tag",
      "urgent"
    ],
    unknownFlags: []
  });
});

test("applies schema defaults, enum validation, and custom coercion", () => {
  const parsed = parseCommandSchemaInput(
    ["yes", "--mode", "slow", "--duration", "5m"],
    {
      args: [
        { name: "enabled", type: "boolean", defaultValue: false },
        { name: "priority", enum: ["low", "normal", "high"] as const, defaultValue: "normal" }
      ] as const,
      flags: [
        { name: "mode", enum: ["fast", "slow"] as const, defaultValue: "fast" },
        {
          name: "duration",
          type: "number",
          coerce: (value) => {
            if (!value.endsWith("m")) {
              throw new Error('Duration must end with "m".');
            }

            return Number(value.slice(0, -1));
          }
        }
      ] as const,
      allowUnknownFlags: false
    },
    { prefix: "!", commandName: "schedule" }
  );

  assert.deepEqual(parsed, {
    args: {
      enabled: true,
      priority: "normal"
    },
    flags: {
      mode: "slow",
      duration: 5
    },
    rawArgs: ["yes", "--mode", "slow", "--duration", "5m"],
    unknownFlags: []
  });

  assert.throws(() => {
    parseCommandSchemaInput(
      ["maybe"],
      {
        args: [
          { name: "priority", enum: ["low", "normal", "high"] as const }
        ] as const
      },
      { prefix: "!", commandName: "schedule" }
    );
  }, /Expected one of: low, normal, high/);
});

test("replies with schema validation errors and exposes typed parsed input", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const replies: Array<Omit<SendMessagePayload, "channelId">> = [];
  const invalidErrors: Error[] = [];
  const executions: string[] = [];

  client.sendMessage = async (_channelId, message) => {
    if (typeof message === "string") {
      replies.push({ content: message });
      return;
    }

    if ("toJSON" in message && typeof message.toJSON === "function") {
      replies.push(message.toJSON());
      return;
    }

    replies.push(message as Omit<SendMessagePayload, "channelId">);
  };

  const bot = new FluxerBot({
    name: "SchemaBot",
    prefix: "!",
    hooks: {
      commandInvalid: ({ error }) => {
        invalidErrors.push(error);
      }
    }
  });

  bot.command(
    defineCommand({
      name: "ban",
      schema: {
        args: [
          { name: "target", required: true },
          { name: "days", type: "number", required: true }
        ],
        flags: [
          { name: "silent", short: "s" }
        ],
        allowUnknownFlags: false
      },
      execute: async ({ input }) => {
        executions.push(
          `${input.args.target}:${input.args.days}:${input.flags.silent}`
        );
      }
    })
  );

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!ban user_2 3 --silent"));
  await transport.injectMessage(createMessage("!ban user_2 nope"));

  assert.deepEqual(executions, ["user_2:3:true"]);
  assert.equal(invalidErrors.length, 1);
  assert.ok(invalidErrors[0] instanceof CommandSchemaError);
  assert.equal(
    replies[0]?.content,
    'Invalid number for argument "days".\nUsage: !ban <target> <days> [-s, --silent]'
  );
});

test("uses schema defaults and coercion during command execution", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const replies: Array<Omit<SendMessagePayload, "channelId">> = [];

  client.sendMessage = async (_channelId, message) => {
    if (typeof message === "string") {
      replies.push({ content: message });
      return;
    }

    if ("toJSON" in message && typeof message.toJSON === "function") {
      replies.push(message.toJSON());
      return;
    }

    replies.push(message as Omit<SendMessagePayload, "channelId">);
  };

  const bot = new FluxerBot({
    name: "SchemaBot",
    prefix: "!"
  });

  bot.command(
    defineCommand({
      name: "schedule",
      schema: {
        args: [
          { name: "task", required: true },
          { name: "priority", enum: ["low", "normal", "high"] as const, defaultValue: "normal" }
        ] as const,
        flags: [
          {
            name: "delay",
            type: "number",
            defaultValue: 0,
            coerce: (value) => {
              if (!value.endsWith("m")) {
                throw new Error('Delay must end with "m".');
              }

              return Number(value.slice(0, -1));
            }
          }
        ] as const,
        allowUnknownFlags: false
      },
      execute: async ({ input, reply }) => {
        await reply(
          `${input.args.task}:${input.args.priority}:${input.flags.delay}`
        );
      }
    })
  );

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!schedule backups"));
  await transport.injectMessage(createMessage("!schedule backups high --delay 10m"));

  assert.deepEqual(replies, [
    { content: "backups:normal:0" },
    { content: "backups:high:10" }
  ]);
});

test("waits for a matching message", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  await client.connect();

  const waitPromise = waitForMessage(client, {
    authorId: "user_2",
    channelId: "general",
    timeoutMs: 1000
  });

  await transport.injectMessage(
    createMessage("not this one", {
      author: {
        id: "user_1",
        username: "fluxguy"
      }
    })
  );

  await transport.injectMessage(
    createMessage("this one", {
      id: "msg_wait",
      author: {
        id: "user_2",
        username: "replyguy"
      }
    })
  );

  const message = await waitPromise;
  assert.equal(message.id, "msg_wait");
});

test("times out when waiting for a message", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  await client.connect();

  await assert.rejects(
    () =>
      client.waitForMessage({
        authorId: "user_9",
        timeoutMs: 10
      }),
    WaitForTimeoutError
  );
});

test("rejects waitFor with a typed abort error", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const controller = new AbortController();

  await client.connect();

  const waitPromise = client.waitFor("messageCreate", {
    signal: controller.signal
  });

  controller.abort();

  await assert.rejects(async () => {
    await waitPromise;
  }, (error: unknown) => {
    assert.ok(error instanceof FluxerError);
    assert.equal(error.code, "WAIT_FOR_ABORTED");
    assert.equal(error.message, 'Waiting for event "messageCreate" was aborted.');
    return true;
  });
});

test("rejects waitForMessage immediately when the abort signal is already aborted", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const controller = new AbortController();

  await client.connect();
  controller.abort();

  await assert.rejects(async () => {
    await client.waitForMessage({
      signal: controller.signal
    });
  }, (error: unknown) => {
    assert.ok(error instanceof FluxerError);
    assert.equal(error.code, "WAIT_FOR_ABORTED");
    assert.equal(error.message, 'Waiting for event "messageCreate" was aborted.');
    return true;
  });
});

test("collects messages until the max is reached", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  await client.connect();

  const collector = new FluxerMessageCollector(client, {
    channelId: "general",
    max: 2
  });

  await transport.injectMessage(createMessage("first"));
  await transport.injectMessage(createMessage("second"));

  const result = await collector.wait();
  assert.equal(result.reason, "limit");
  assert.deepEqual(
    result.collected.map((message) => message.content),
    ["first", "second"]
  );
});

test("collectors stop on idle timeout after collecting matching messages", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  await client.connect();

  const collector = client.createMessageCollector({
    channelId: "general",
    idleMs: 10
  });

  await transport.injectMessage(createMessage("first"));

  const result = await collector.wait();
  assert.equal(result.reason, "idle");
  assert.deepEqual(
    result.collected.map((message) => message.content),
    ["first"]
  );
});

test("collectors stop on abort signals", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const controller = new AbortController();

  await client.connect();

  const collector = client.createMessageCollector({
    channelId: "general",
    signal: controller.signal
  });

  await transport.injectMessage(createMessage("first"));
  controller.abort();

  const result = await collector.wait();
  assert.equal(result.reason, "abort");
  assert.deepEqual(
    result.collected.map((message) => message.content),
    ["first"]
  );
});

test("waitForMessage ignores bot messages by default and can opt in", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  await client.connect();

  const nonBotWait = client.waitForMessage({
    channelId: "general",
    timeoutMs: 1000
  });

  await transport.injectMessage(createMessage("bot ping", {
    id: "msg_bot",
    author: {
      id: "bot_1",
      username: "helperbot",
      isBot: true
    }
  }));

  await transport.injectMessage(createMessage("human ping", {
    id: "msg_human"
  }));

  const humanMessage = await nonBotWait;
  assert.equal(humanMessage.id, "msg_human");

  const botWait = client.waitForMessage({
    channelId: "general",
    includeBots: true,
    timeoutMs: 1000
  });

  await transport.injectMessage(createMessage("bot yes", {
    id: "msg_bot_yes",
    author: {
      id: "bot_2",
      username: "relaybot",
      isBot: true
    }
  }));

  const botMessage = await botWait;
  assert.equal(botMessage.id, "msg_bot_yes");
});

test("supports conversational command replies through awaitReply", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const replies: Array<Omit<SendMessagePayload, "channelId">> = [];

  client.sendMessage = async (_channelId, message) => {
    if (typeof message === "string") {
      replies.push({ content: message });
      return;
    }

    if ("toJSON" in message && typeof message.toJSON === "function") {
      replies.push(message.toJSON());
      return;
    }

    replies.push(message as Omit<SendMessagePayload, "channelId">);
  };

  const bot = new FluxerBot({
    name: "ConversationBot",
    prefix: "!"
  });

  bot.command({
    name: "confirm",
    execute: async ({ reply, awaitReply }) => {
      await reply("Reply with yes to confirm.");
      const response = await awaitReply({
        timeoutMs: 1000,
        filter: (message) => message.content.toLowerCase() === "yes"
      });
      await reply(`confirmed:${response.content}`);
    }
  });

  client.registerBot(bot);
  await client.connect();

  const commandPromise = transport.injectMessage(createMessage("!confirm"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await transport.injectMessage(createMessage("yes", { id: "msg_yes" }));
  await commandPromise;

  assert.deepEqual(replies, [
    { content: "Reply with yes to confirm." },
    { content: "confirmed:yes" }
  ]);
});

test("awaitReply defaults to the invoking author and channel", async () => {
  const runtime = new FluxerTestRuntime();
  const bot = new FluxerBot({
    name: "ConversationBot",
    prefix: "!"
  });

  bot.command({
    name: "confirm",
    execute: async ({ reply, awaitReply }) => {
      await reply("Reply with yes to confirm.");
      const response = await awaitReply({
        timeoutMs: 1000,
        filter: (message) => message.content.toLowerCase() === "yes"
      });
      await reply(`confirmed:${response.id}`);
    }
  });

  runtime.registerBot(bot);
  await runtime.connect();

  const promptPromise = runtime.waitForSentMessage({
    filter: (payload) => payload.content === "Reply with yes to confirm."
  });
  const confirmationPromise = runtime.waitForSentMessage({
    filter: (payload) => typeof payload.content === "string" && payload.content.startsWith("confirmed:")
  });

  const commandPromise = runtime.injectMessage(runtime.createMessage("!confirm", {
    id: "msg_command",
    author: {
      id: "user_confirm",
      username: "fluxguy"
    },
    channel: {
      id: "general",
      name: "general",
      type: "text"
    }
  }));

  await promptPromise;
  await new Promise((resolve) => setTimeout(resolve, 0));

  await runtime.injectMessage(runtime.createMessage("yes", {
    id: "msg_wrong_author",
    author: {
      id: "user_other",
      username: "otherguy"
    },
    channel: {
      id: "general",
      name: "general",
      type: "text"
    }
  }));

  await runtime.injectMessage(runtime.createMessage("yes", {
    id: "msg_wrong_channel",
    author: {
      id: "user_confirm",
      username: "fluxguy"
    },
    channel: {
      id: "random",
      name: "random",
      type: "text"
    }
  }));

  await runtime.injectMessage(runtime.createMessage("yes", {
    id: "msg_bot",
    author: {
      id: "bot_reply",
      username: "helperbot",
      isBot: true
    },
    channel: {
      id: "general",
      name: "general",
      type: "text"
    }
  }));

  await runtime.injectMessage(runtime.createMessage("yes", {
    id: "msg_valid_reply",
    author: {
      id: "user_confirm",
      username: "fluxguy"
    },
    channel: {
      id: "general",
      name: "general",
      type: "text"
    }
  }));

  const confirmation = await confirmationPromise;
  await commandPromise;
  assert.equal(confirmation.channelId, "general");
  assert.equal(confirmation.content, "confirmed:msg_valid_reply");
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

test("awaits async module setup through installModule", async () => {
  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!"
  });

  const calls: string[] = [];

  await bot.installModule({
    name: "async-module",
    setup: async () => {
      calls.push("setup");
    }
  });

  assert.deepEqual(calls, ["setup"]);
  assert.deepEqual(bot.modules, ["async-module"]);
});

test("rejects async module setup through module()", () => {
  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!"
  });

  assert.throws(() => {
    bot.module({
      name: "async-module",
      setup: async () => {}
    });
  }, /Use installModule\(\)/);
});

test("builds rich message payloads with embeds", () => {
  const payload = new MessageBuilder()
    .setContent("hello")
    .addEmbed(
      new EmbedBuilder()
        .setTitle("Status")
        .setDescription("All systems operational")
        .addField({ name: "Latency", value: "42ms", inline: true })
    )
    .toJSON();

  assert.equal(payload.content, "hello");
  assert.equal(payload.embeds?.[0]?.title, "Status");
  assert.equal(payload.embeds?.[0]?.fields?.[0]?.value, "42ms");
});

test("builds attachment payloads and attachment-backed embed references", () => {
  const payload = new MessageBuilder()
    .setContent("report")
    .addAttachment(
      new AttachmentBuilder()
        .setFilename("graph.png")
        .setContentType("image/png")
        .setData(new Uint8Array([1, 2, 3]))
    )
    .addAttachment(
      new AttachmentBuilder()
        .setFilename("report.txt")
        .setText("uptime=ok")
    )
    .addEmbed(
      new EmbedBuilder()
        .setTitle("Status")
        .setAttachmentImage("graph.png")
        .setFooter("Generated by Fluxer.JS")
    )
    .toJSON();

  assert.equal(payload.attachments?.length, 2);
  assert.equal(payload.attachments?.[0]?.filename, "graph.png");
  assert.equal(payload.embeds?.[0]?.image?.url, "attachment://graph.png");
  assert.equal(payload.embeds?.[0]?.footer?.text, "Generated by Fluxer.JS");
});

test("supports richer embed ergonomics and attachment json payloads", () => {
  const payload = new MessageBuilder()
    .setContent("report")
    .addAttachment(
      new AttachmentBuilder()
        .setFilename("report.json")
        .setJson({ ok: true }, 2)
    )
    .addEmbed(
      new EmbedBuilder()
        .setTitle("Metrics")
        .setColorHex("#ff8800")
        .setTimestampNow()
        .addInlineField("Latency", "42ms")
        .addFieldsFromRecord(
          {
            Region: "us-east",
            Healthy: true
          },
          { inline: true }
        )
    )
    .toJSON();

  assert.equal(payload.attachments?.[0]?.contentType, "application/json; charset=utf-8");
  assert.equal(payload.embeds?.[0]?.color, 0xff8800);
  assert.equal(payload.embeds?.[0]?.fields?.[0]?.inline, true);
  assert.equal(payload.embeds?.[0]?.fields?.[2]?.value, "true");
  assert.ok(typeof payload.embeds?.[0]?.timestamp === "string");
});

test("rejects invalid embed hex colors", () => {
  assert.throws(() => {
    new EmbedBuilder().setColorHex("#zzzzzz");
  }, (error: unknown) => {
    assert.ok(error instanceof PayloadValidationError);
    assert.equal(error.code, "PAYLOAD_EMBED_COLOR_INVALID");
    return true;
  });
});

test("normalizes string and builder message payloads", () => {
  const fromString = resolveMessagePayload("pong");
  const fromBuilder = resolveMessagePayload(
    new MessageBuilder().setContent("pong").addEmbed(new EmbedBuilder().setTitle("Info"))
  );

  assert.deepEqual(fromString, { content: "pong" });
  assert.equal(fromBuilder.content, "pong");
  assert.equal(fromBuilder.embeds?.[0]?.title, "Info");
});

test("validates attachment references and empty message payloads", () => {
  assert.throws(() => {
    validateMessagePayload({});
  }, (error: unknown) => {
    assert.ok(error instanceof PayloadValidationError);
    assert.equal(error.code, "PAYLOAD_EMPTY_MESSAGE");
    return true;
  });

  assert.throws(() => {
    validateMessagePayload({
      embeds: [
        new EmbedBuilder()
          .setTitle("Status")
          .setImage(createAttachmentUrl("missing.png"))
          .toJSON()
      ]
    });
  }, (error: unknown) => {
    assert.ok(error instanceof PayloadValidationError);
    assert.equal(error.code, "PAYLOAD_ATTACHMENT_REFERENCE_MISSING");
    return true;
  });
});

test("creates message templates from validated base payloads", () => {
  const template = createMessageTemplate(
    new MessageBuilder()
      .setContent("base")
      .addEmbed(new EmbedBuilder().setTitle("Base"))
  );

  const payload = template({
    content: "override"
  });

  assert.equal(payload.content, "override");
  assert.equal(payload.embeds?.[0]?.title, "Base");
});

test("creates embed templates and serializer payload previews", () => {
  const template = createEmbedTemplate(
    new EmbedBuilder()
      .setTitle("Base")
      .setFooter("Template footer")
      .addInlineField("Base", "yes")
  );

  const embed = template(new EmbedBuilder().setDescription("Override"));
  const payload = serializeMessagePayload({
    content: "hello",
    embeds: [embed],
    attachments: [
      new AttachmentBuilder()
        .setFilename("graph.png")
        .setContentType("image/png")
        .setData(new Uint8Array([1, 2, 3]))
        .toJSON()
    ]
  });

  assert.equal(embed.title, "Base");
  assert.equal(embed.description, "Override");
  assert.equal(embed.footer?.text, "Template footer");
  assert.equal(payload.attachments?.[0]?.id, 0);
  assert.equal(payload.attachments?.[0]?.filename, "graph.png");
  assert.equal(payload.embeds?.[0]?.footer?.text, "Template footer");
});

test("installs plugins and exposes their commands", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const replies: Array<Omit<SendMessagePayload, "channelId">> = [];

  client.sendMessage = async (_channelId, message) => {
    if (typeof message === "string") {
      replies.push({ content: message });
      return;
    }

    if ("toJSON" in message && typeof message.toJSON === "function") {
      replies.push(message.toJSON());
      return;
    }

    replies.push(message as Omit<SendMessagePayload, "channelId">);
  };

  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!"
  });

  bot.plugin(
    createEssentialsPlugin({
      aboutText: "Fluxer.JS keeps the core sharp."
    })
  );

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!about"));

  assert.deepEqual(bot.plugins, ["essentials"]);
  assert.deepEqual(replies, [{ content: "Fluxer.JS keeps the core sharp." }]);
});

test("generates rich help output from command metadata", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const replies: Array<Omit<SendMessagePayload, "channelId">> = [];

  client.sendMessage = async (_channelId, message) => {
    if (typeof message === "string") {
      replies.push({ content: message });
      return;
    }

    if ("toJSON" in message && typeof message.toJSON === "function") {
      replies.push(message.toJSON());
      return;
    }

    replies.push(message as Omit<SendMessagePayload, "channelId">);
  };

  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!"
  });

  bot.command(
    defineCommand({
      name: "echo",
      aliases: ["say"],
      description: "Echoes text back to the current channel.",
      examples: ["!echo hello world", "!echo --upper hello world"],
      schema: {
        args: [{ name: "text", required: true, rest: true, description: "The text to echo back." }] as const,
        flags: [{ name: "upper", short: "u", description: "Convert the output to uppercase." }] as const,
        allowUnknownFlags: false
      },
      execute: async () => {}
    })
  );

  bot.command({
    name: "secret",
    hidden: true,
    execute: async () => {}
  });

  bot.plugin(createEssentialsPlugin());

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!help"));
  await transport.injectMessage(createMessage("!help echo"));

  assert.equal(
    replies[0]?.content,
    "Commands:\n!about - Show information about the bot.\n!echo <text...> [-u, --upper] - Echoes text back to the current channel.\n!help [command...] - Show the available commands for the current bot."
  );
  assert.equal(
    replies[1]?.content,
    "Usage: !echo <text...> [-u, --upper]\nEchoes text back to the current channel.\nAliases: say\nArguments:\n- text (required, rest): The text to echo back.\nFlags:\n- -u, --upper (optional): Convert the output to uppercase.\nExamples: !echo hello world | !echo --upper hello world"
  );
});

test("supports command groups and multi-word subcommands", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const replies: Array<Omit<SendMessagePayload, "channelId">> = [];

  client.sendMessage = async (_channelId, message) => {
    if (typeof message === "string") {
      replies.push({ content: message });
      return;
    }

    if ("toJSON" in message && typeof message.toJSON === "function") {
      replies.push(message.toJSON());
      return;
    }

    replies.push(message as Omit<SendMessagePayload, "channelId">);
  };

  const bot = new FluxerBot({
    name: "TestBot",
    prefix: "!"
  });

  bot.module({
    name: "admin",
    commands: [
      defineCommandGroup({
        name: "admin",
        description: "Administrative commands.",
        examples: ["!admin ban fluxguy", "!admin audit-log"],
        aliases: ["mod"],
        commands: [
          defineCommand({
            name: "ban",
            description: "Ban a member.",
            schema: {
              args: [{ name: "target", required: true, description: "The member to ban." }] as const
            },
            execute: async ({ input, reply }) => {
              await reply(`banned:${input.args.target}`);
            }
          }),
          defineCommand({
            name: "audit-log",
            aliases: ["logs"],
            description: "View the audit log.",
            execute: async ({ reply }) => {
              await reply("audit-log");
            }
          })
        ]
      })
    ]
  });

  bot.plugin(createEssentialsPlugin());

  client.registerBot(bot);
  await client.connect();
  await transport.injectMessage(createMessage("!admin ban fluxguy"));
  await transport.injectMessage(createMessage("!mod logs"));
  await transport.injectMessage(createMessage("!help"));
  await transport.injectMessage(createMessage("!help admin"));
  await transport.injectMessage(createMessage("!help admin ban"));

  assert.equal(replies[0]?.content, "banned:fluxguy");
  assert.equal(replies[1]?.content, "audit-log");
  assert.equal(
    replies[2]?.content,
    "Commands:\n!about - Show information about the bot.\n!help [command...] - Show the available commands for the current bot.\n\nGroups:\n!admin <subcommand> - Administrative commands."
  );
  assert.equal(
    replies[3]?.content,
    "Usage: !admin <subcommand>\nAdministrative commands.\nAliases: mod\nSubcommands:\n- !admin ban <target> - Ban a member.\n- !admin audit-log - View the audit log.\nExamples: !admin ban fluxguy | !admin audit-log"
  );
  assert.equal(
    replies[4]?.content,
    "Usage: !admin ban <target>\nBan a member.\nAliases: mod ban\nArguments:\n- target (required): The member to ban."
  );
  assert.equal(bot.resolveCommandFromInput("admin ban")?.name, "admin ban");
  assert.equal(bot.resolveCommandGroup("mod")?.name, "admin");
});

test("creates structured command catalogs from bot metadata", () => {
  const bot = new FluxerBot({
    name: "CatalogBot",
    prefix: "!"
  });

  bot.command(
    defineCommand({
      name: "echo",
      description: "Echo text back.",
      schema: {
        args: [
          {
            name: "text",
            description: "The text to send back.",
            required: true,
            rest: true
          }
        ] as const,
        flags: [
          {
            name: "upper",
            short: "u",
            description: "Convert the text to uppercase."
          }
        ] as const
      },
      execute: async () => {}
    })
  );

  bot.command(
    defineCommandGroup({
      name: "admin",
      description: "Administrative commands.",
      aliases: ["mod"],
      commands: [
        defineCommand({
          name: "ban",
          description: "Ban a member.",
          execute: async () => {}
        })
      ]
    })
  );

  const catalog = bot.createCommandCatalog();

  assert.deepEqual(catalog.commands, [
    {
      name: "echo",
      description: "Echo text back.",
      usage: "Usage: !echo <text...> [-u, --upper]",
      aliases: [],
      examples: [],
      hidden: false,
      group: undefined,
      subcommand: undefined,
      args: [
        {
          name: "text",
          description: "The text to send back.",
          required: true,
          rest: true,
          type: "string",
          defaultValue: undefined,
          enum: undefined,
          coerced: false
        }
      ],
      flags: [
        {
          name: "upper",
          short: "u",
          description: "Convert the text to uppercase.",
          required: false,
          multiple: false,
          type: "boolean",
          defaultValue: undefined,
          enum: undefined,
          coerced: false
        }
      ]
    }
  ]);
  assert.deepEqual(catalog.groups, [
    {
      name: "admin",
      description: "Administrative commands.",
      usage: "Usage: !admin <subcommand>",
      aliases: ["mod"],
      examples: [],
      hidden: false,
      commands: [
        {
          name: "admin ban",
          description: "Ban a member.",
          usage: "Usage: !admin ban",
          aliases: ["mod ban"],
          examples: [],
          hidden: false,
          group: "admin",
          subcommand: "ban",
          args: [],
          flags: []
        }
      ]
    }
  ]);
});

test("resolves command and group descriptors directly from the bot", () => {
  const bot = new FluxerBot({
    name: "LookupBot",
    prefix: "!"
  });

  bot.command(
    defineCommandGroup({
      name: "admin",
      aliases: ["mod"],
      commands: [
        defineCommand({
          name: "ban",
          aliases: ["remove"],
          description: "Ban a member.",
          schema: {
            args: [{ name: "target", required: true }] as const
          },
          execute: async () => {}
        })
      ]
    })
  );

  const commandDescriptor = bot.getCommandDescriptor("mod remove");
  const groupDescriptor = bot.getCommandGroupDescriptor("mod");

  assert.equal(commandDescriptor?.name, "admin ban");
  assert.deepEqual(commandDescriptor?.aliases, ["admin remove", "mod ban", "mod remove"]);
  assert.equal(groupDescriptor?.name, "admin");
  assert.deepEqual(groupDescriptor?.aliases, ["mod"]);
});


