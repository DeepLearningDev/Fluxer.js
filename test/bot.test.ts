import test from "node:test";
import assert from "node:assert/strict";
import { FluxerBot } from "../src/core/Bot.js";
import { EmbedBuilder, MessageBuilder, resolveMessagePayload } from "../src/core/builders.js";
import { parseCommandInput } from "../src/core/CommandParser.js";
import {
  defineCommand,
  defineCommandGroup,
  parseCommandSchemaInput
} from "../src/core/CommandSchema.js";
import { FluxerClient } from "../src/core/Client.js";
import {
  FluxerMessageCollector,
  waitForMessage
} from "../src/core/Collectors.js";
import {
  attachDebugHandler,
  createConsoleDebugHandler,
  shouldLogDebugEvent
} from "../src/core/Diagnostics.js";
import { createInstanceInfo, detectInstanceCapabilities } from "../src/core/Instance.js";
import { defaultParseDispatchEvent } from "../src/core/createPlatformTransport.js";
import { createFluxerPlatformTransport } from "../src/core/createPlatformTransport.js";
import {
  CommandSchemaError,
  GatewayProtocolError,
  GatewayTransportError,
  WaitForTimeoutError
} from "../src/core/errors.js";
import { GatewayTransport } from "../src/core/GatewayTransport.js";
import { MockTransport } from "../src/core/MockTransport.js";
import { createPermissionGuard } from "../src/core/Permissions.js";
import { createEssentialsPlugin } from "../src/plugins/essentials.js";
import { FluxerTestRuntime } from "../src/testing/TestRuntime.js";
import { createTestGatewayDispatch, createTestMessage } from "../src/testing/fixtures.js";
import type { FluxerCommand, FluxerMessage, SendMessagePayload } from "../src/core/types.js";

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

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  public readyState = FakeWebSocket.CONNECTING;
  public readonly sent: string[] = [];
  readonly #listeners = new Map<string, Array<(event?: { data?: unknown }) => void>>();

  public addEventListener(type: string, listener: (event?: { data?: unknown }) => void): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.#emit("close");
  }

  public emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.#emit("open");
  }

  public emitMessage(data: unknown): void {
    this.#emit("message", { data: JSON.stringify(data) });
  }

  public emitError(): void {
    this.#emit("error");
  }

  #emit(type: string, event?: { data?: unknown }): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
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

  assert.deepEqual(replies, [{ content: "No access." }]);
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

test("detects self-hosted instance capabilities from discovery", () => {
  const discovery = {
    api_code_version: 42,
    endpoints: {
      api: "https://fluxer.local/api",
      api_client: "https://fluxer.local/client-api",
      api_public: "https://fluxer.local/public-api",
      gateway: "wss://fluxer.local/gateway",
      media: "https://fluxer.local/media",
      static_cdn: "https://fluxer.local/cdn",
      marketing: "https://fluxer.local",
      admin: "https://fluxer.local/admin",
      invite: "https://fluxer.local/invite",
      gift: "https://fluxer.local/gift",
      webapp: "https://fluxer.local/app"
    },
    features: {
      gateway_bot: true,
      attachments: true
    },
    federation: {
      enabled: true,
      version: 2
    }
  } as const;

  const capabilities = detectInstanceCapabilities(discovery);
  const instanceInfo = createInstanceInfo({
    instanceUrl: "https://fluxer.local",
    discovery
  });

  assert.deepEqual(capabilities, {
    federation: true,
    invites: true,
    media: true,
    gateway: true,
    gatewayBot: true,
    botAuth: true,
    attachments: true
  });
  assert.equal(instanceInfo.isSelfHosted, true);
  assert.equal(instanceInfo.apiCodeVersion, 42);
  assert.equal(instanceInfo.federationVersion, 2);
});

test("creates platform transport from provided discovery and reports instance info", async () => {
  let fetchCalls = 0;
  const debugEvents: string[] = [];
  let receivedInstanceInfo: ReturnType<typeof createInstanceInfo> | undefined;

  const discovery = {
    api_code_version: 7,
    endpoints: {
      api: "https://fluxer.local/api",
      api_client: "https://fluxer.local/client-api",
      api_public: "https://fluxer.local/public-api",
      gateway: "wss://fluxer.local/gateway",
      media: "https://fluxer.local/media",
      static_cdn: "https://fluxer.local/cdn",
      marketing: "https://fluxer.local",
      admin: "https://fluxer.local/admin",
      invite: "https://fluxer.local/invite",
      gift: "https://fluxer.local/gift",
      webapp: "https://fluxer.local/app"
    },
    features: {
      gateway_bot: true
    }
  } as const;

  const gatewayInfo = {
    url: "wss://fluxer.local/gateway/bot",
    shards: 1,
    session_start_limit: {
      total: 1000,
      remaining: 999,
      reset_after: 1000,
      max_concurrency: 1
    }
  };

  const fetchImpl: typeof fetch = async (input) => {
    fetchCalls += 1;
    if (String(input).endsWith("/v1/gateway/bot")) {
      return new Response(JSON.stringify(gatewayInfo), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }

    throw new Error(`Unexpected fetch: ${String(input)}`);
  };

  const transport = await createFluxerPlatformTransport({
    auth: { token: "bot-token" },
    instanceUrl: "https://fluxer.local",
    discovery,
    fetchImpl,
    debug: (event) => {
      debugEvents.push(event.event);
    },
    onInstanceInfo: (instanceInfo) => {
      receivedInstanceInfo = instanceInfo;
    },
    parseMessageEvent: () => null
  });

  assert.ok(transport);
  assert.equal(fetchCalls, 1);
  assert.equal(receivedInstanceInfo?.isSelfHosted, true);
  assert.equal(receivedInstanceInfo?.apiCodeVersion, 7);
  assert.ok(debugEvents.includes("instance_detected"));
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

test("normalizes string and builder message payloads", () => {
  const fromString = resolveMessagePayload("pong");
  const fromBuilder = resolveMessagePayload(
    new MessageBuilder().setContent("pong").addEmbed(new EmbedBuilder().setTitle("Info"))
  );

  assert.deepEqual(fromString, { content: "pong" });
  assert.equal(fromBuilder.content, "pong");
  assert.equal(fromBuilder.embeds?.[0]?.title, "Info");
});

test("maps gateway dispatch events onto client events", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const events: string[] = [];

  client.on("gatewayDispatch", ({ type }) => {
    events.push(`dispatch:${type}`);
  });

  client.on("guildCreate", (guild) => {
    events.push(`guild:${guild.id}`);
  });

  client.on("messageDelete", (message) => {
    events.push(`message-delete:${message.id}`);
  });

  await client.receiveGatewayDispatch({
    type: "GUILD_CREATE",
    sequence: 1,
    data: {
      id: "guild_1",
      name: "Fluxer HQ"
    },
    raw: {
      op: 0,
      d: {
        id: "guild_1",
        name: "Fluxer HQ"
      },
      s: 1,
      t: "GUILD_CREATE"
    }
  });

  await client.receiveGatewayDispatch({
    type: "MESSAGE_DELETE",
    sequence: 2,
    data: {
      id: "msg_9",
      channel_id: "general"
    },
    raw: {
      op: 0,
      d: {
        id: "msg_9",
        channel_id: "general"
      },
      s: 2,
      t: "MESSAGE_DELETE"
    }
  });

  assert.deepEqual(events, [
    "dispatch:GUILD_CREATE",
    "guild:guild_1",
    "dispatch:MESSAGE_DELETE",
    "message-delete:msg_9"
  ]);
});

test("parses raw gateway dispatch envelopes", () => {
  const event = defaultParseDispatchEvent({
    op: 0,
    d: { id: "guild_1" },
    s: 10,
    t: "GUILD_DELETE"
  });

  assert.equal(event?.type, "GUILD_DELETE");
  assert.equal(event?.sequence, 10);
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

test("maps member, presence, typing, and user gateway events", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const events: string[] = [];

  client.on("guildMemberAdd", (member) => {
    events.push(`member-add:${member.user.username}`);
  });

  client.on("presenceUpdate", (presence) => {
    events.push(`presence:${presence.userId}:${presence.status}`);
  });

  client.on("typingStart", (typing) => {
    events.push(`typing:${typing.userId}:${typing.channelId}`);
  });

  client.on("userUpdate", (user) => {
    events.push(`user:${user.username}`);
  });

  await client.receiveGatewayDispatch({
    type: "GUILD_MEMBER_ADD",
    sequence: 3,
    data: {
      guild_id: "guild_1",
      nick: "Flux Guy",
      roles: ["role_1"],
      joined_at: "2026-03-17T05:00:00.000Z",
      user: {
        id: "user_1",
        username: "fluxguy"
      }
    },
    raw: {
      op: 0,
      d: {
        guild_id: "guild_1",
        nick: "Flux Guy",
        roles: ["role_1"],
        joined_at: "2026-03-17T05:00:00.000Z",
        user: {
          id: "user_1",
          username: "fluxguy"
        }
      },
      s: 3,
      t: "GUILD_MEMBER_ADD"
    }
  });

  await client.receiveGatewayDispatch({
    type: "PRESENCE_UPDATE",
    sequence: 4,
    data: {
      user: { id: "user_1" },
      status: "online",
      activities: [{ name: "Building bots", type: 0 }]
    },
    raw: {
      op: 0,
      d: {
        user: { id: "user_1" },
        status: "online",
        activities: [{ name: "Building bots", type: 0 }]
      },
      s: 4,
      t: "PRESENCE_UPDATE"
    }
  });

  await client.receiveGatewayDispatch({
    type: "TYPING_START",
    sequence: 5,
    data: {
      channel_id: "general",
      user_id: "user_1",
      timestamp: 1_763_086_800
    },
    raw: {
      op: 0,
      d: {
        channel_id: "general",
        user_id: "user_1",
        timestamp: 1_763_086_800
      },
      s: 5,
      t: "TYPING_START"
    }
  });

  await client.receiveGatewayDispatch({
    type: "USER_UPDATE",
    sequence: 6,
    data: {
      id: "user_1",
      username: "fluxguy"
    },
    raw: {
      op: 0,
      d: {
        id: "user_1",
        username: "fluxguy"
      },
      s: 6,
      t: "USER_UPDATE"
    }
  });

  assert.deepEqual(events, [
    "member-add:fluxguy",
    "presence:user_1:online",
    "typing:user_1:general",
    "user:fluxguy"
  ]);
});

test("maps role, reaction, and voice gateway events", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const events: string[] = [];

  client.on("roleCreate", (role) => {
    events.push(`role:${role.id}:${role.name}`);
  });

  client.on("messageReactionAdd", (reaction) => {
    events.push(`reaction:${reaction.messageId}:${reaction.emoji.name}`);
  });

  client.on("voiceStateUpdate", (voiceState) => {
    events.push(`voice-state:${voiceState.userId}:${voiceState.channelId}`);
  });

  client.on("voiceServerUpdate", (voiceServer) => {
    events.push(`voice-server:${voiceServer.guildId}:${voiceServer.endpoint}`);
  });

  await client.receiveGatewayDispatch({
    type: "GUILD_ROLE_CREATE",
    sequence: 7,
    data: {
      guild_id: "guild_1",
      role: {
        id: "role_1",
        name: "moderator",
        color: 0xff0000
      }
    },
    raw: {
      op: 0,
      d: {
        guild_id: "guild_1",
        role: {
          id: "role_1",
          name: "moderator",
          color: 0xff0000
        }
      },
      s: 7,
      t: "GUILD_ROLE_CREATE"
    }
  });

  await client.receiveGatewayDispatch({
    type: "MESSAGE_REACTION_ADD",
    sequence: 8,
    data: {
      user_id: "user_1",
      channel_id: "general",
      message_id: "msg_1",
      emoji: {
        name: "wave"
      }
    },
    raw: {
      op: 0,
      d: {
        user_id: "user_1",
        channel_id: "general",
        message_id: "msg_1",
        emoji: {
          name: "wave"
        }
      },
      s: 8,
      t: "MESSAGE_REACTION_ADD"
    }
  });

  await client.receiveGatewayDispatch({
    type: "VOICE_STATE_UPDATE",
    sequence: 9,
    data: {
      guild_id: "guild_1",
      channel_id: "voice_1",
      user_id: "user_1",
      session_id: "session_1",
      self_mute: false
    },
    raw: {
      op: 0,
      d: {
        guild_id: "guild_1",
        channel_id: "voice_1",
        user_id: "user_1",
        session_id: "session_1",
        self_mute: false
      },
      s: 9,
      t: "VOICE_STATE_UPDATE"
    }
  });

  await client.receiveGatewayDispatch({
    type: "VOICE_SERVER_UPDATE",
    sequence: 10,
    data: {
      guild_id: "guild_1",
      token: "voice-token",
      endpoint: "voice.fluxer.app"
    },
    raw: {
      op: 0,
      d: {
        guild_id: "guild_1",
        token: "voice-token",
        endpoint: "voice.fluxer.app"
      },
      s: 10,
      t: "VOICE_SERVER_UPDATE"
    }
  });

  assert.deepEqual(events, [
    "role:role_1:moderator",
    "reaction:msg_1:wave",
    "voice-state:user_1:voice_1",
    "voice-server:guild_1:voice.fluxer.app"
  ]);
});

test("maps moderation and invite gateway events", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const events: string[] = [];

  client.on("guildBanAdd", (ban) => {
    events.push(`ban-add:${ban.guildId}:${ban.user.username}`);
  });

  client.on("guildBanRemove", (ban) => {
    events.push(`ban-remove:${ban.guildId}:${ban.user.username}`);
  });

  client.on("inviteCreate", (invite) => {
    events.push(`invite-create:${invite.code}:${invite.inviter?.username ?? "unknown"}`);
  });

  client.on("inviteDelete", (invite) => {
    events.push(`invite-delete:${invite.code}:${invite.channelId}`);
  });

  await client.receiveGatewayDispatch({
    type: "GUILD_BAN_ADD",
    sequence: 11,
    data: {
      guild_id: "guild_1",
      user: {
        id: "user_2",
        username: "modtarget"
      }
    },
    raw: {
      op: 0,
      d: {
        guild_id: "guild_1",
        user: {
          id: "user_2",
          username: "modtarget"
        }
      },
      s: 11,
      t: "GUILD_BAN_ADD"
    }
  });

  await client.receiveGatewayDispatch({
    type: "GUILD_BAN_REMOVE",
    sequence: 12,
    data: {
      guild_id: "guild_1",
      user: {
        id: "user_2",
        username: "modtarget"
      }
    },
    raw: {
      op: 0,
      d: {
        guild_id: "guild_1",
        user: {
          id: "user_2",
          username: "modtarget"
        }
      },
      s: 12,
      t: "GUILD_BAN_REMOVE"
    }
  });

  await client.receiveGatewayDispatch({
    type: "INVITE_CREATE",
    sequence: 13,
    data: {
      code: "welcome123",
      channel_id: "general",
      guild_id: "guild_1",
      inviter: {
        id: "user_1",
        username: "fluxguy"
      },
      uses: 0,
      max_uses: 5
    },
    raw: {
      op: 0,
      d: {
        code: "welcome123",
        channel_id: "general",
        guild_id: "guild_1",
        inviter: {
          id: "user_1",
          username: "fluxguy"
        },
        uses: 0,
        max_uses: 5
      },
      s: 13,
      t: "INVITE_CREATE"
    }
  });

  await client.receiveGatewayDispatch({
    type: "INVITE_DELETE",
    sequence: 14,
    data: {
      code: "welcome123",
      channel_id: "general",
      guild_id: "guild_1"
    },
    raw: {
      op: 0,
      d: {
        code: "welcome123",
        channel_id: "general",
        guild_id: "guild_1"
      },
      s: 14,
      t: "INVITE_DELETE"
    }
  });

  assert.deepEqual(events, [
    "ban-add:guild_1:modtarget",
    "ban-remove:guild_1:modtarget",
    "invite-create:welcome123:fluxguy",
    "invite-delete:welcome123:general"
  ]);
});

test("tracks gateway state and resumes sessions on reconnect", async () => {
  const sockets: FakeWebSocket[] = [];
  const states: string[] = [];
  const sessions: Array<{ sessionId?: string; sequence: number | null; resumable: boolean }> = [];
  const debugEvents: string[] = [];

  const transport = new GatewayTransport({
    url: "wss://gateway.fluxer.test",
    auth: { token: "bot-token" },
    reconnect: {
      baseDelayMs: 0,
      maxDelayMs: 0
    },
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    buildIdentifyPayload: ({ auth }) => ({
      op: 2,
      d: { token: auth?.token }
    }),
    parseMessageEvent: () => null
  });

  transport.onGatewayStateChange(({ state }) => {
    states.push(state);
  });

  transport.onGatewaySessionUpdate((session) => {
    sessions.push(session);
  });

  transport.onDebug((event) => {
    debugEvents.push(event.event);
  });

  const connectPromise = transport.connect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const firstSocket = sockets[0];
  firstSocket.emitOpen();
  await connectPromise;

  firstSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(JSON.parse(firstSocket.sent[0]).op, 2);

  firstSocket.emitMessage({
    op: 0,
    t: "READY",
    s: 1,
    d: {
      session_id: "session_1"
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  firstSocket.close();
  await new Promise((resolve) => setTimeout(resolve, 10));

  const secondSocket = sockets[1];
  secondSocket.emitOpen();
  secondSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(JSON.parse(secondSocket.sent[0]).op, 6);

  secondSocket.emitMessage({
    op: 0,
    t: "RESUMED",
    s: 2,
    d: {}
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(states[0], "connecting");
  assert.ok(states.includes("identifying"));
  assert.ok(states.includes("reconnecting"));
  assert.ok(states.includes("resuming"));
  assert.equal(states.at(-1), "ready");
  assert.equal(sessions.at(-1)?.sessionId, "session_1");
  assert.equal(sessions.at(-1)?.sequence, 2);
  assert.equal(sessions.at(-1)?.resumable, true);
  assert.ok(debugEvents.includes("resume_sent"));
});

test("emits typed protocol errors for invalid sessions", async () => {
  const sockets: FakeWebSocket[] = [];
  const errors: Error[] = [];

  const transport = new GatewayTransport({
    url: "wss://gateway.fluxer.test",
    auth: { token: "bot-token" },
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    parseMessageEvent: () => null
  });

  transport.onError((error) => {
    errors.push(error);
  });

  const connectPromise = transport.connect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });

  socket.emitMessage({
    op: 9,
    d: false
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(errors.some((error) => error instanceof GatewayProtocolError));
  assert.ok(errors.some((error) => error instanceof GatewayTransportError));
});
