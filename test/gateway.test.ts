import test from 'node:test';
import assert from 'node:assert/strict';
import { FluxerClient } from '../src/core/Client.js';
import { createInstanceInfo, detectInstanceCapabilities } from '../src/core/Instance.js';
import { createFluxerPlatformTransport, defaultParseDispatchEvent, defaultParseMessageEvent } from '../src/core/createPlatformTransport.js';
import { GatewayProtocolError, GatewayTransportError, PlatformBootstrapError } from '../src/core/errors.js';
import { GatewayTransport } from '../src/core/GatewayTransport.js';
import { MockTransport } from '../src/core/MockTransport.js';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  public readyState = FakeWebSocket.CONNECTING;
  public readonly sent: string[] = [];
  readonly #listeners = new Map<string, Array<(event?: { data?: unknown; code?: number; reason?: string; wasClean?: boolean }) => void>>();
  public addEventListener(type: string, listener: (event?: { data?: unknown; code?: number; reason?: string; wasClean?: boolean }) => void): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }
  public send(data: string): void {
    this.sent.push(data);
  }
  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.#emit('close');
  }
  public emitClose(options?: { code?: number; reason?: string; wasClean?: boolean }): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.#emit('close', options);
  }
  public emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.#emit('open');
  }
  public emitMessage(data: unknown): void {
    this.#emit('message', { data: JSON.stringify(data) });
  }
  public emitRawMessage(data: unknown): void {
    this.#emit('message', { data });
  }
  public emitError(): void {
    this.#emit('error');
  }
  #emit(type: string, event?: { data?: unknown; code?: number; reason?: string; wasClean?: boolean }): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function parseSentPayloads(socket: FakeWebSocket): Array<{ op?: number; d?: unknown }> {
  return socket.sent.map((payload) => JSON.parse(payload) as { op?: number; d?: unknown });
}

function findSentPayloadByOpcode(socket: FakeWebSocket, opcode: number): { op?: number; d?: unknown } | undefined {
  return parseSentPayloads(socket).find((payload) => payload.op === opcode);
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitForCondition(
  predicate: () => boolean,
  options?: {
    timeoutMs?: number;
    stepMs?: number;
    message?: string;
  }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 250;
  const stepMs = options?.stepMs ?? 1;
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      assert.fail(options?.message ?? "Timed out waiting for test condition.");
    }

    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

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
  const debugEvents: Array<{ event: string; data?: Record<string, unknown> }> = [];
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
      debugEvents.push({
        event: event.event,
        data: event.data
      });
    },
    onInstanceInfo: (instanceInfo) => {
      receivedInstanceInfo = instanceInfo;
    }
  });

  assert.ok(transport);
  assert.equal(fetchCalls, 1);
  assert.equal(receivedInstanceInfo?.isSelfHosted, true);
  assert.equal(receivedInstanceInfo?.apiCodeVersion, 7);
  const detectedEvent = debugEvents.find((event) => event.event === "instance_detected");
  assert.deepEqual(detectedEvent?.data, {
    instanceUrl: "https://fluxer.local",
    apiBaseUrl: "https://fluxer.local/public-api",
    apiCodeVersion: 7,
    isSelfHosted: true,
    capabilities: [
      "invites",
      "media",
      "gateway",
      "gatewayBot",
      "botAuth",
      "attachments"
    ]
  });
  const bootstrappedEvent = debugEvents.find((event) => event.event === "platform_transport_bootstrapped");
  assert.deepEqual(bootstrappedEvent?.data, {
    instanceUrl: "https://fluxer.local",
    apiBaseUrl: "https://fluxer.local/public-api",
    gatewayUrl: "wss://fluxer.local/gateway/bot"
  });
});

test("emits typed diagnostics when discovery bootstrap fails", async () => {
  const debugEvents: Array<{ event: string; data?: Record<string, unknown> }> = [];

  await assert.rejects(async () => {
    await createFluxerPlatformTransport({
      auth: { token: "bot-token" },
      instanceUrl: "https://fluxer.local",
      fetchImpl: async () => {
        throw new Error("network down");
      },
      debug: (event) => {
        debugEvents.push({
          event: event.event,
          data: event.data
        });
      }
    });
  }, (error: unknown) => {
    assert.ok(error instanceof PlatformBootstrapError);
    assert.equal(error.code, "PLATFORM_DISCOVERY_FAILED");
    assert.equal(error.retryable, true);
    assert.equal(error.details?.instanceUrl, "https://fluxer.local");
    assert.equal(error.details?.message, "Failed to fetch the Fluxer discovery document.");
    return true;
  });

  const debugEvent = debugEvents.find((event) => event.event === "platform_transport_discovery_failed");
  assert.deepEqual(debugEvent?.data, {
    instanceUrl: "https://fluxer.local",
    message: "Failed to fetch the Fluxer discovery document."
  });
});

test("emits typed diagnostics when gateway info bootstrap fails", async () => {
  const debugEvents: Array<{ event: string; data?: Record<string, unknown> }> = [];

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

  await assert.rejects(async () => {
    await createFluxerPlatformTransport({
      auth: { token: "bot-token" },
      instanceUrl: "https://fluxer.local",
      discovery,
      fetchImpl: async () =>
        new Response("gateway unavailable", {
          status: 503,
          statusText: "Service Unavailable"
        }),
      debug: (event) => {
        debugEvents.push({
          event: event.event,
          data: event.data
        });
      }
    });
  }, (error: unknown) => {
    assert.ok(error instanceof PlatformBootstrapError);
    assert.equal(error.code, "PLATFORM_GATEWAY_INFO_FAILED");
    assert.equal(error.retryable, true);
    assert.equal(error.details?.instanceUrl, "https://fluxer.local");
    assert.equal(error.details?.apiBaseUrl, "https://fluxer.local/public-api");
    assert.match(String(error.details?.message), /503 Service Unavailable/);
    return true;
  });

  const detectedEvent = debugEvents.find((event) => event.event === "instance_detected");
  assert.deepEqual(detectedEvent?.data, {
    instanceUrl: "https://fluxer.local",
    apiBaseUrl: "https://fluxer.local/public-api",
    apiCodeVersion: 7,
    isSelfHosted: true,
    capabilities: ["invites", "media", "gateway", "gatewayBot", "botAuth", "attachments"]
  });
  const debugEvent = debugEvents.find((event) => event.event === "platform_transport_gateway_info_failed");
  assert.deepEqual(debugEvent?.data, {
    instanceUrl: "https://fluxer.local",
    apiBaseUrl: "https://fluxer.local/public-api",
    message: "Failed to fetch Fluxer gateway bootstrap information: 503 Service Unavailable"
  });
});

test("blocks platform transport bootstrap when discovery lacks a gateway endpoint", async () => {
  let fetchCalls = 0;
  const debugEvents: Array<{ event: string; data?: Record<string, unknown> }> = [];

  const discovery = {
    api_code_version: 7,
    endpoints: {
      api: "https://fluxer.local/api",
      api_client: "https://fluxer.local/client-api",
      api_public: "https://fluxer.local/public-api",
      gateway: "",
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

  await assert.rejects(async () => {
    await createFluxerPlatformTransport({
      auth: { token: "bot-token" },
      instanceUrl: "https://fluxer.local",
      discovery,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("Gateway fetch should not be attempted.");
      },
      debug: (event) => {
        debugEvents.push({
          event: event.event,
          data: event.data
        });
      }
    });
  }, (error: unknown) => {
    assert.ok(error instanceof PlatformBootstrapError);
    assert.equal(error.code, "INSTANCE_CAPABILITY_UNSUPPORTED");
    assert.equal(error.retryable, false);
    assert.equal(error.details?.instanceUrl, "https://fluxer.local");
    assert.deepEqual(error.details?.missingCapabilities, ["gateway"]);
    assert.match(error.message, /Missing capabilities: gateway/);
    return true;
  });

  assert.equal(fetchCalls, 0);
  const detectedEvent = debugEvents.find((event) => event.event === "instance_detected");
  assert.deepEqual(detectedEvent?.data, {
    instanceUrl: "https://fluxer.local",
    apiBaseUrl: "https://fluxer.local/public-api",
    apiCodeVersion: 7,
    isSelfHosted: true,
    capabilities: ["invites", "media", "gatewayBot", "botAuth", "attachments"]
  });
  const debugEvent = debugEvents.find((event) => event.event === "platform_transport_bootstrap_blocked");
  assert.deepEqual(debugEvent?.data, {
    instanceUrl: "https://fluxer.local",
    missingCapabilities: ["gateway"]
  });
});

test("blocks platform transport bootstrap when discovery lacks bot gateway support", async () => {
  let fetchCalls = 0;

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
      gateway_bot: false
    }
  } as const;

  await assert.rejects(async () => {
    await createFluxerPlatformTransport({
      auth: { token: "bot-token" },
      instanceUrl: "https://fluxer.local",
      discovery,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("Gateway fetch should not be attempted.");
      }
    });
  }, (error: unknown) => {
    assert.ok(error instanceof PlatformBootstrapError);
    assert.equal(error.code, "INSTANCE_CAPABILITY_UNSUPPORTED");
    assert.equal(error.retryable, false);
    assert.equal(error.details?.instanceUrl, "https://fluxer.local");
    assert.deepEqual(error.details?.missingCapabilities, ["gatewayBot"]);
    assert.match(error.message, /Missing capabilities: gatewayBot/);
    return true;
  });

  assert.equal(fetchCalls, 0);
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

  client.on("messageDeleteBulk", (payload) => {
    events.push(`message-delete-bulk:${payload.channelId}:${payload.ids.join(",")}`);
  });

  client.on("channelPinsUpdate", (payload) => {
    events.push(`pins:${payload.channelId}:${payload.lastPinTimestamp?.toISOString() ?? "none"}`);
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

  await client.receiveGatewayDispatch({
    type: "MESSAGE_DELETE_BULK",
    sequence: 3,
    data: {
      ids: ["msg_10", "msg_11"],
      channel_id: "general"
    },
    raw: {
      op: 0,
      d: {
        ids: ["msg_10", "msg_11"],
        channel_id: "general"
      },
      s: 3,
      t: "MESSAGE_DELETE_BULK"
    }
  });

  await client.receiveGatewayDispatch({
    type: "CHANNEL_PINS_UPDATE",
    sequence: 4,
    data: {
      channel_id: "general",
      last_pin_timestamp: "2026-03-18T22:00:00.000Z"
    },
    raw: {
      op: 0,
      d: {
        channel_id: "general",
        last_pin_timestamp: "2026-03-18T22:00:00.000Z"
      },
      s: 4,
      t: "CHANNEL_PINS_UPDATE"
    }
  });

  assert.deepEqual(events, [
    "dispatch:GUILD_CREATE",
    "guild:guild_1",
    "dispatch:MESSAGE_DELETE",
    "message-delete:msg_9",
    "dispatch:MESSAGE_DELETE_BULK",
    "message-delete-bulk:general:msg_10,msg_11",
    "dispatch:CHANNEL_PINS_UPDATE",
    "pins:general:2026-03-18T22:00:00.000Z"
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

test("parses valid MESSAGE_CREATE payloads through the default parser", () => {
  const message = defaultParseMessageEvent({
    op: 0,
    t: "MESSAGE_CREATE",
    s: 15,
    d: {
      id: "msg_1",
      content: "hello",
      author: {
        id: "user_1",
        username: "fluxguy",
        global_name: "Flux Guy",
        bot: false
      },
      channel_id: "general",
      timestamp: "2026-03-18T22:00:00.000Z"
    }
  });

  assert.deepEqual(message, {
    id: "msg_1",
    content: "hello",
    author: {
      id: "user_1",
      username: "fluxguy",
      displayName: "Flux Guy",
      isBot: false
    },
    channel: {
      id: "general",
      name: "general",
      type: "text"
    },
    createdAt: new Date("2026-03-18T22:00:00.000Z")
  });
});

test("rejects malformed MESSAGE_CREATE payloads through the default parser", () => {
  assert.throws(() => {
    defaultParseMessageEvent({
      op: 0,
      t: "MESSAGE_CREATE",
      s: 16,
      d: {
        id: "msg_1",
        author: {
          id: "user_1",
          username: "fluxguy"
        },
        channel_id: "general",
        timestamp: "not-a-date"
      }
    });
  }, (error: unknown) => {
    assert.ok(error instanceof GatewayProtocolError);
    assert.equal(error.code, "GATEWAY_MESSAGE_CREATE_INVALID");
    assert.equal(error.eventType, "MESSAGE_CREATE");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("emits message events through GatewayTransport when using the default parser", async () => {
  const sockets: FakeWebSocket[] = [];
  const transport = new GatewayTransport({
    url: "wss://gateway.fluxer.test",
    auth: { token: "bot-token" },
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    buildIdentifyPayload: ({ auth }) => ({
      op: 2,
      d: { token: auth?.token }
    }),
    parseMessageEvent: defaultParseMessageEvent
  });

  const messages: string[] = [];
  transport.onMessage((message) => {
    messages.push(`${message.id}:${message.content}`);
  });

  const connectPromise = transport.connect();
  await flushAsyncWork();
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await waitForCondition(() => findSentPayloadByOpcode(socket, 2)?.op === 2, {
    message: "Expected identify payload before message ingress test."
  });

  socket.emitMessage({
    op: 0,
    t: "MESSAGE_CREATE",
    s: 17,
    d: {
      id: "msg_7",
      content: "pong",
      author: {
        id: "user_7",
        username: "fluxfriend"
      },
      channel_id: "general",
      timestamp: "2026-03-18T22:00:00.000Z"
    }
  });

  await waitForCondition(() => messages.length === 1, {
    message: "Expected default parser to emit a message event."
  });

  assert.deepEqual(messages, ["msg_7:pong"]);
});

test("emits typed protocol errors for malformed MESSAGE_CREATE payloads in GatewayTransport", async () => {
  const sockets: FakeWebSocket[] = [];
  const transport = new GatewayTransport({
    url: "wss://gateway.fluxer.test",
    auth: { token: "bot-token" },
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    buildIdentifyPayload: ({ auth }) => ({
      op: 2,
      d: { token: auth?.token }
    }),
    parseMessageEvent: defaultParseMessageEvent
  });

  const errors: Error[] = [];
  transport.onError((error) => {
    errors.push(error);
  });

  const connectPromise = transport.connect();
  await flushAsyncWork();
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await waitForCondition(() => findSentPayloadByOpcode(socket, 2)?.op === 2, {
    message: "Expected identify payload before malformed message ingress test."
  });

  socket.emitMessage({
    op: 0,
    t: "MESSAGE_CREATE",
    s: 18,
    d: {
      id: "msg_8",
      author: {
        id: "user_8",
        username: "fluxfriend"
      },
      channel_id: "general",
      timestamp: "not-a-date"
    }
  });

  await waitForCondition(() =>
    errors.some((candidate) =>
      candidate instanceof GatewayProtocolError
      && candidate.code === "GATEWAY_MESSAGE_CREATE_INVALID"
    ), {
      message: "Expected malformed MESSAGE_CREATE payload to emit a typed protocol error."
    }
  );

  const error = errors.find((candidate) =>
    candidate instanceof GatewayProtocolError
    && candidate.code === "GATEWAY_MESSAGE_CREATE_INVALID"
  );

  assert.ok(error instanceof GatewayProtocolError);
  assert.equal(error.eventType, "MESSAGE_CREATE");
  assert.equal(error.retryable, false);
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

test("maps channel gateway events with numeric channel types", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);
  const events: string[] = [];

  client.on("channelCreate", (channel) => {
    events.push(`create:${channel.id}:${channel.type}:${channel.name}`);
  });

  client.on("channelUpdate", (channel) => {
    events.push(`update:${channel.id}:${channel.type}:${channel.name}`);
  });

  await client.receiveGatewayDispatch({
    type: "CHANNEL_CREATE",
    sequence: 6,
    data: {
      id: "channel_text",
      name: "general",
      type: 0
    },
    raw: {
      op: 0,
      d: {
        id: "channel_text",
        name: "general",
        type: 0
      },
      s: 6,
      t: "CHANNEL_CREATE"
    }
  });

  await client.receiveGatewayDispatch({
    type: "CHANNEL_UPDATE",
    sequence: 7,
    data: {
      id: "channel_dm",
      type: 1
    },
    raw: {
      op: 0,
      d: {
        id: "channel_dm",
        type: 1
      },
      s: 7,
      t: "CHANNEL_UPDATE"
    }
  });

  assert.deepEqual(events, [
    "create:channel_text:text:general",
    "update:channel_dm:dm:channel_dm"
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
  await flushAsyncWork();
  const firstSocket = sockets[0];
  firstSocket.emitOpen();
  await connectPromise;

  firstSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await waitForCondition(() => findSentPayloadByOpcode(firstSocket, 2)?.op === 2, {
    message: "Expected identify payload after HELLO."
  });

  assert.equal(findSentPayloadByOpcode(firstSocket, 2)?.op, 2);

  firstSocket.emitMessage({
    op: 0,
    t: "READY",
    s: 1,
    d: {
      session_id: "session_1"
    }
  });
  await waitForCondition(() => sessions.at(-1)?.sessionId === "session_1", {
    message: "Expected READY to update the tracked session."
  });

  firstSocket.close();
  await waitForCondition(() => sockets.length >= 2, {
    message: "Expected reconnect to create a second socket."
  });

  const secondSocket = sockets[1];
  secondSocket.emitOpen();
  secondSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await waitForCondition(() => findSentPayloadByOpcode(secondSocket, 6)?.op === 6, {
    message: "Expected resume payload on reconnect."
  });

  assert.equal(findSentPayloadByOpcode(secondSocket, 6)?.op, 6);

  secondSocket.emitMessage({
    op: 0,
    t: "RESUMED",
    s: 2,
    d: {}
  });
  await waitForCondition(
    () => sessions.at(-1)?.sequence === 2 && states.at(-1) === "ready",
    {
      message: "Expected RESUMED to update session sequence and return the transport to ready."
    }
  );

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
  const sessions: Array<{ sessionId?: string; sequence: number | null; resumable: boolean }> = [];

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
  transport.onGatewaySessionUpdate((session) => {
    sessions.push(session);
  });

  const connectPromise = transport.connect();
  await flushAsyncWork();
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
    op: 0,
    t: "READY",
    s: 1,
    d: {
      session_id: "session_1"
    }
  });

  socket.emitMessage({
    op: 9,
    d: false
  });
  await waitForCondition(() => errors.length > 0 && sessions.at(-1)?.resumable === false, {
    message: "Expected invalid session to emit an error and clear resumability."
  });

  assert.ok(errors.some((error) => error instanceof GatewayProtocolError));
  assert.ok(errors.some((error) => error instanceof GatewayTransportError));
  assert.equal(sessions.at(-1)?.sessionId, undefined);
  assert.equal(sessions.at(-1)?.resumable, false);
});

test("resumes after a resumable invalid session", async () => {
  const sockets: FakeWebSocket[] = [];

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

  const connectPromise = transport.connect();
  await flushAsyncWork();
  const firstSocket = sockets[0];
  firstSocket.emitOpen();
  await connectPromise;

  firstSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await waitForCondition(() => findSentPayloadByOpcode(firstSocket, 2)?.op === 2, {
    message: "Expected identify payload after initial HELLO."
  });

  firstSocket.emitMessage({
    op: 0,
    t: "READY",
    s: 1,
    d: {
      session_id: "session_1"
    }
  });
  await flushAsyncWork();

  firstSocket.emitMessage({
    op: 9,
    d: true
  });
  await waitForCondition(() => sockets.length >= 2, {
    message: "Expected resumable invalid session to reconnect."
  });

  const secondSocket = sockets[1];
  secondSocket.emitOpen();
  secondSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await waitForCondition(() => findSentPayloadByOpcode(secondSocket, 6)?.op === 6, {
    message: "Expected resume payload after resumable invalid session."
  });

  assert.equal(findSentPayloadByOpcode(secondSocket, 6)?.op, 6);
});

test("re-identifies after a non-resumable invalid session", async () => {
  const sockets: FakeWebSocket[] = [];

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

  const connectPromise = transport.connect();
  await flushAsyncWork();
  const firstSocket = sockets[0];
  firstSocket.emitOpen();
  await connectPromise;

  firstSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await waitForCondition(() => findSentPayloadByOpcode(firstSocket, 2)?.op === 2, {
    message: "Expected identify payload after initial HELLO."
  });

  firstSocket.emitMessage({
    op: 0,
    t: "READY",
    s: 1,
    d: {
      session_id: "session_1"
    }
  });
  await flushAsyncWork();

  firstSocket.emitMessage({
    op: 9,
    d: false
  });
  await waitForCondition(() => sockets.length >= 2, {
    message: "Expected non-resumable invalid session to reconnect."
  });

  const secondSocket = sockets[1];
  secondSocket.emitOpen();
  secondSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await waitForCondition(() => findSentPayloadByOpcode(secondSocket, 2)?.op === 2, {
    message: "Expected identify payload after non-resumable invalid session."
  });

  assert.equal(findSentPayloadByOpcode(secondSocket, 2)?.op, 2);
});

test("reconnects after heartbeat timeout and resumes the session", async () => {
  const sockets: FakeWebSocket[] = [];
  const errors: Error[] = [];
  const states: string[] = [];

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

  transport.onError((error) => {
    errors.push(error);
  });
  transport.onGatewayStateChange(({ state }) => {
    states.push(state);
  });

  const connectPromise = transport.connect();
  await flushAsyncWork();
  const firstSocket = sockets[0];
  firstSocket.emitOpen();
  await connectPromise;

  firstSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 5
    }
  });
  await waitForCondition(() => findSentPayloadByOpcode(firstSocket, 2)?.op === 2, {
    message: "Expected identify payload before heartbeat timeout path."
  });

  firstSocket.emitMessage({
    op: 0,
    t: "READY",
    s: 1,
    d: {
      session_id: "session_1"
    }
  });
  await waitForCondition(() => sockets.length >= 2, {
    timeoutMs: 500,
    stepMs: 5,
    message: "Expected heartbeat timeout to trigger reconnect."
  });

  const secondSocket = sockets[1];
  assert.ok(secondSocket);
  secondSocket.emitOpen();
  secondSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await waitForCondition(() => findSentPayloadByOpcode(secondSocket, 6)?.op === 6, {
    message: "Expected resume payload after heartbeat-timeout reconnect."
  });

  assert.equal(findSentPayloadByOpcode(secondSocket, 6)?.op, 6);
  assert.ok(errors.some((error) =>
    error instanceof GatewayTransportError
    && error.message.includes("heartbeat was not acknowledged")
  ));
  assert.ok(states.includes("reconnecting"));
});

test("emits typed diagnostics for invalid JSON payloads", async () => {
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
    buildIdentifyPayload: ({ auth }) => ({
      op: 2,
      d: { token: auth?.token }
    }),
    parseMessageEvent: () => null
  });

  transport.onError((error) => {
    errors.push(error);
  });

  const connectPromise = transport.connect();
  await flushAsyncWork();
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.emitRawMessage("{not-json");
  await waitForCondition(() =>
    errors.some((candidate) =>
      candidate instanceof GatewayProtocolError
      && candidate.code === "GATEWAY_PAYLOAD_PARSE_FAILED"
    ), {
      message: "Expected invalid JSON payload to emit a typed protocol error."
    }
  );

  const error = errors.find((candidate) =>
    candidate instanceof GatewayProtocolError
    && candidate.code === "GATEWAY_PAYLOAD_PARSE_FAILED"
  );

  assert.ok(error instanceof GatewayProtocolError);
  assert.equal(error.retryable, false);
  assert.equal(error.details?.rawData, "{not-json");
});

test("emits typed diagnostics for malformed hello payloads", async () => {
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
    buildIdentifyPayload: ({ auth }) => ({
      op: 2,
      d: { token: auth?.token }
    }),
    parseMessageEvent: () => null
  });

  transport.onError((error) => {
    errors.push(error);
  });

  const connectPromise = transport.connect();
  await flushAsyncWork();
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.emitMessage({
    op: 10,
    d: {}
  });
  await waitForCondition(() =>
    errors.some((candidate) =>
      candidate instanceof GatewayProtocolError
      && candidate.code === "GATEWAY_HELLO_INVALID"
    ), {
      message: "Expected malformed HELLO to emit a typed protocol error."
    }
  );

  const error = errors.find((candidate) =>
    candidate instanceof GatewayProtocolError
    && candidate.code === "GATEWAY_HELLO_INVALID"
  );

  assert.ok(error instanceof GatewayProtocolError);
  assert.equal(error.retryable, true);
  assert.equal(error.details?.heartbeatInterval, null);
});

test("emits typed diagnostics when identify payload cannot be built", async () => {
  const sockets: FakeWebSocket[] = [];
  const errors: Error[] = [];

  const transport = new GatewayTransport({
    url: "wss://gateway.fluxer.test",
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
  await flushAsyncWork();
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await waitForCondition(() =>
    errors.some((candidate) =>
      candidate instanceof GatewayTransportError
      && candidate.code === "GATEWAY_IDENTIFY_UNAVAILABLE"
    ), {
      message: "Expected missing identify payload to emit a transport error."
    }
  );

  const error = errors.find((candidate) =>
    candidate instanceof GatewayTransportError
    && candidate.code === "GATEWAY_IDENTIFY_UNAVAILABLE"
  );

  assert.ok(error instanceof GatewayTransportError);
  assert.equal(error.retryable, false);
  assert.deepEqual(error.details, {
    hasIdentifyPayload: false,
    hasIdentifyBuilder: false,
    hasAuth: false
  });
  await flushAsyncWork();
  assert.equal(sockets.length, 1);
});

test("emits typed diagnostics when reconnect attempts are exhausted", async () => {
  const sockets: FakeWebSocket[] = [];
  const errors: Error[] = [];

  const transport = new GatewayTransport({
    url: "wss://gateway.fluxer.test",
    auth: { token: "bot-token" },
    reconnect: {
      baseDelayMs: 0,
      maxDelayMs: 0,
      maxAttempts: 0
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

  transport.onError((error) => {
    errors.push(error);
  });

  const connectPromise = transport.connect();
  await flushAsyncWork();
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.close();
  await waitForCondition(() =>
    errors.some((candidate) =>
      candidate instanceof GatewayTransportError
      && candidate.code === "GATEWAY_RECONNECT_EXHAUSTED"
    ), {
      message: "Expected reconnect exhaustion to emit a transport error."
    }
  );

  const error = errors.find((candidate) =>
    candidate instanceof GatewayTransportError
    && candidate.code === "GATEWAY_RECONNECT_EXHAUSTED"
  );

  assert.ok(error instanceof GatewayTransportError);
  assert.equal(error.retryable, false);
  assert.equal(error.details?.maxAttempts, 0);
});

test("includes close details when the gateway disconnects unexpectedly", async () => {
  const sockets: FakeWebSocket[] = [];
  const errors: Error[] = [];

  const transport = new GatewayTransport({
    url: "wss://gateway.fluxer.test",
    auth: { token: "bot-token" },
    reconnect: {
      maxAttempts: 0
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

  transport.onError((error) => {
    errors.push(error);
  });

  const connectPromise = transport.connect();
  await flushAsyncWork();
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.emitClose({
    code: 4001,
    reason: "Auth failed",
    wasClean: false
  });

  await waitForCondition(() =>
    errors.some((candidate) =>
      candidate instanceof GatewayTransportError
      && candidate.code === "GATEWAY_DISCONNECTED"
    ), {
      message: "Expected disconnect to emit a typed transport error."
    }
  );

  const error = errors.find((candidate) =>
    candidate instanceof GatewayTransportError
    && candidate.code === "GATEWAY_DISCONNECTED"
  );

  assert.ok(error instanceof GatewayTransportError);
  assert.equal(error.details?.closeCode, 4001);
  assert.equal(error.details?.closeReason, "Auth failed");
  assert.equal(error.details?.wasClean, false);
});



