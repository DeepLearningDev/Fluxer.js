import test from 'node:test';
import assert from 'node:assert/strict';
import { FluxerClient } from '../src/core/Client.js';
import { createInstanceInfo, detectInstanceCapabilities } from '../src/core/Instance.js';
import { defaultParseDispatchEvent, createFluxerPlatformTransport } from '../src/core/createPlatformTransport.js';
import { GatewayProtocolError, GatewayTransportError } from '../src/core/errors.js';
import { GatewayTransport } from '../src/core/GatewayTransport.js';
import { MockTransport } from '../src/core/MockTransport.js';
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
    this.#emit('close');
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
  #emit(type: string, event?: { data?: unknown }): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}test("detects self-hosted instance capabilities from discovery", () => {
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
    }
  });

  assert.ok(transport);
  assert.equal(fetchCalls, 1);
  assert.equal(receivedInstanceInfo?.isSelfHosted, true);
  assert.equal(receivedInstanceInfo?.apiCodeVersion, 7);
  assert.ok(debugEvents.includes("instance_detected"));
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
  await new Promise((resolve) => setTimeout(resolve, 0));

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

  firstSocket.emitMessage({
    op: 0,
    t: "READY",
    s: 1,
    d: {
      session_id: "session_1"
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  firstSocket.emitMessage({
    op: 9,
    d: true
  });
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

  firstSocket.emitMessage({
    op: 0,
    t: "READY",
    s: 1,
    d: {
      session_id: "session_1"
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  firstSocket.emitMessage({
    op: 9,
    d: false
  });
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

  assert.equal(JSON.parse(secondSocket.sent[0]).op, 2);
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  const firstSocket = sockets[0];
  firstSocket.emitOpen();
  await connectPromise;

  firstSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 5
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  firstSocket.emitMessage({
    op: 0,
    t: "READY",
    s: 1,
    d: {
      session_id: "session_1"
    }
  });

  for (let attempt = 0; attempt < 20 && !sockets[1]; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const secondSocket = sockets[1];
  assert.ok(secondSocket);
  secondSocket.emitOpen();
  secondSocket.emitMessage({
    op: 10,
    d: {
      heartbeat_interval: 1000
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(JSON.parse(secondSocket.sent[0]).op, 6);
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.emitRawMessage("{not-json");
  await new Promise((resolve) => setTimeout(resolve, 0));

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
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.emitMessage({
    op: 10,
    d: {}
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

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
  await new Promise((resolve) => setTimeout(resolve, 0));

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
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = sockets[0];
  socket.emitOpen();
  await connectPromise;

  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 10));

  const error = errors.find((candidate) =>
    candidate instanceof GatewayTransportError
    && candidate.code === "GATEWAY_RECONNECT_EXHAUSTED"
  );

  assert.ok(error instanceof GatewayTransportError);
  assert.equal(error.retryable, false);
  assert.equal(error.details?.maxAttempts, 0);
});


