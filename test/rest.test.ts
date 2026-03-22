import test from 'node:test';
import assert from 'node:assert/strict';
import { AttachmentBuilder, EmbedBuilder } from '../src/core/builders.js';
import { FluxerClient } from '../src/core/Client.js';
import { RestTransportError } from '../src/core/errors.js';
import { MockTransport } from '../src/core/MockTransport.js';
import { RestTransport } from '../src/core/RestTransport.js';

function createRestMessageResponse(overrides: Partial<{
  id: string;
  content: string;
  channel_id: string;
  timestamp: string;
  author: {
    id: string;
    username: string;
    global_name?: string;
    bot?: boolean;
  };
}> = {}): Response {
  return new Response(JSON.stringify({
    id: "msg_1",
    content: "hello",
    channel_id: "general",
    timestamp: "2026-03-18T22:00:00.000Z",
    author: {
      id: "user_1",
      username: "fluxguy"
    },
    ...overrides
  }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createRestChannelResponse(overrides: Partial<{
  id: string;
  name: string | null;
  type: number | string;
}> = {}): Response {
  return new Response(JSON.stringify({
    id: "general",
    name: "general",
    type: 0,
    ...overrides
  }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createRestGuildResponse(overrides: Partial<{
  id: string;
  name: string;
  icon: string | null;
}> = {}): Response {
  return new Response(JSON.stringify({
    id: "guild_1",
    name: "Fluxer Guild",
    icon: "https://cdn.fluxer.local/icon.png",
    ...overrides
  }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createRestMessageListResponse(): Response {
  return new Response(JSON.stringify([
    {
      id: "msg_2",
      content: "second",
      channel_id: "general",
      timestamp: "2026-03-18T22:01:00.000Z",
      author: {
        id: "user_1",
        username: "fluxguy"
      }
    },
    {
      id: "msg_1",
      content: "first",
      channel_id: "general",
      timestamp: "2026-03-18T22:00:00.000Z",
      author: {
        id: "user_2",
        username: "otherguy"
      }
    }
  ]), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createRestPinnedMessageListResponse(): Response {
  return new Response(JSON.stringify({
    items: [
      {
        message: {
          id: "msg_2",
          content: "pinned second",
          channel_id: "general",
          timestamp: "2026-03-18T22:01:00.000Z",
          author: {
            id: "user_1",
            username: "fluxguy"
          }
        },
        pinned_at: "2026-03-18T22:10:00.000Z"
      },
      {
        message: {
          id: "msg_1",
          content: "pinned first",
          channel_id: "general",
          timestamp: "2026-03-18T22:00:00.000Z",
          author: {
            id: "user_2",
            username: "otherguy"
          }
        },
        pinned_at: "2026-03-18T22:05:00.000Z"
      }
    ],
    has_more: true
  }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("emits typed diagnostics for invalid rest transport configuration", async () => {
  const transport = new RestTransport({});

  await assert.rejects(async () => {
    await transport.connect();
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_CONFIGURATION_INVALID");
    assert.equal(error.retryable, false);
    assert.deepEqual(error.details, {
      hasBaseUrl: false,
      hasDiscovery: false,
      hasInstanceUrl: false
    });
    return true;
  });
});

test("emits typed diagnostics when discovery fetch fails", async () => {
  const transport = new RestTransport({
    instanceUrl: "https://fluxer.local",
    fetchImpl: async () => {
      throw new Error("network down");
    }
  });

  await assert.rejects(async () => {
    await transport.connect();
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_DISCOVERY_FAILED");
    assert.equal(error.retryable, true);
    assert.equal(error.details?.instanceUrl, "https://fluxer.local");
    assert.equal(error.details?.message, "Failed to fetch the Fluxer discovery document.");
    return true;
  });
});

test("emits typed diagnostics when rest requests fail before a response", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async () => {
      throw new Error("socket hang up");
    }
  });

  await assert.rejects(async () => {
    await transport.sendMessage({
      channelId: "general",
      content: "hello"
    });
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_REQUEST_FAILED");
    assert.equal(error.retryable, true);
    assert.equal(error.details?.url, "https://fluxer.local/api/v1/channels/general/messages");
    assert.equal(error.details?.channelId, "general");
    assert.equal(error.details?.message, "socket hang up");
    return true;
  });
});

test("emits typed diagnostics for rest http failures", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async () =>
      new Response("denied", {
        status: 403,
        statusText: "Forbidden"
      })
  });

  await assert.rejects(async () => {
    await transport.sendMessage({
      channelId: "general",
      content: "hello"
    });
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_HTTP_ERROR");
    assert.equal(error.status, 403);
    assert.equal(error.retryable, false);
    assert.equal(error.details?.statusText, "Forbidden");
    assert.equal(error.details?.responseBody, "denied");
    return true;
  });
});

test("emits typed diagnostics for rest rate limits with retry metadata", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async () =>
      new Response(JSON.stringify({
        retry_after: 1.5,
        global: true
      }), {
        status: 429,
        statusText: "Too Many Requests",
        headers: {
          "content-type": "application/json",
          "retry-after": "2",
          "x-ratelimit-bucket": "messages:general"
        }
      })
  });

  await assert.rejects(async () => {
    await transport.sendMessage({
      channelId: "general",
      content: "hello"
    });
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_RATE_LIMITED");
    assert.equal(error.status, 429);
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 2000);
    assert.equal(error.details?.retryAfterMs, 2000);
    assert.equal(error.details?.retryAfterSource, "header");
    assert.equal(error.details?.bucket, "messages:general");
    assert.equal(error.details?.global, true);
    return true;
  });
});

test("serializes attachment payloads as multipart form data for rest transport", async () => {
  let requestBody: BodyInit | null | undefined;
  let requestHeaders: HeadersInit | undefined;

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (_url, init) => {
      requestBody = init?.body;
      requestHeaders = init?.headers;
      return new Response(null, {
        status: 200
      });
    }
  });

  await transport.sendMessage({
    channelId: "general",
    content: "report",
    attachments: [
      new AttachmentBuilder()
        .setFilename("graph.png")
        .setContentType("image/png")
        .setData(new Uint8Array([1, 2, 3]))
        .toJSON()
    ],
    embeds: [
      new EmbedBuilder()
        .setTitle("Graph")
        .setAttachmentImage("graph.png")
        .toJSON()
    ]
  });

  assert.ok(requestBody instanceof FormData);
  const payloadJson = requestBody.get("payload_json");
  assert.equal(typeof payloadJson, "string");
  const parsedPayload = JSON.parse(payloadJson as string) as {
    attachments?: Array<{ id: number; filename: string; description?: string }>;
    embeds?: Array<{ image?: { url?: string } }>;
  };
  assert.equal(parsedPayload.attachments?.[0]?.id, 0);
  assert.equal(parsedPayload.attachments?.[0]?.filename, "graph.png");
  assert.equal(parsedPayload.embeds?.[0]?.image?.url, "attachment://graph.png");

  const uploadedFile = requestBody.get("files[0]");
  assert.ok(uploadedFile instanceof File);
  assert.equal(uploadedFile.name, "graph.png");
  assert.equal(uploadedFile.type, "image/png");

  const normalizedHeaders = new Headers(requestHeaders);
  assert.equal(normalizedHeaders.has("content-type"), false);
});

test("fetches, edits, and deletes messages through rest transport lifecycle endpoints", async () => {
  const requests: Array<{ method?: string; url: string; body?: BodyInit | null }> = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input, init) => {
      const url = String(input);
      requests.push({
        method: init?.method,
        url,
        body: init?.body
      });

      if (init?.method === "GET") {
        return createRestMessageResponse();
      }

      if (init?.method === "PATCH") {
        return createRestMessageResponse({
          content: "updated"
        });
      }

      if (init?.method === "DELETE") {
        return new Response(null, {
          status: 204
        });
      }

      throw new Error(`Unexpected method: ${init?.method}`);
    }
  });

  const fetched = await transport.fetchMessage("general", "msg_1");
  const edited = await transport.editMessage("general", "msg_1", {
    content: "updated"
  });
  await transport.deleteMessage("general", "msg_1");

  assert.equal(fetched.id, "msg_1");
  assert.equal(fetched.content, "hello");
  assert.equal(edited.content, "updated");
  assert.deepEqual(
    requests.map(({ method, url }) => ({ method, url })),
    [
      {
        method: "GET",
        url: "https://fluxer.local/api/v1/channels/general/messages/msg_1"
      },
      {
        method: "PATCH",
        url: "https://fluxer.local/api/v1/channels/general/messages/msg_1"
      },
      {
        method: "DELETE",
        url: "https://fluxer.local/api/v1/channels/general/messages/msg_1"
      }
    ]
  );
  assert.equal(requests[1]?.body, JSON.stringify({ content: "updated" }));
});

test("fetches channels through rest transport and normalizes channel type", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestChannelResponse({
        id: "dm_1",
        name: null,
        type: 1
      });
    }
  });

  const channel = await transport.fetchChannel("dm_1");

  assert.equal(requests[0], "https://fluxer.local/api/v1/channels/dm_1");
  assert.deepEqual(channel, {
    id: "dm_1",
    name: "dm_1",
    type: "dm"
  });
});

test("fetches guilds through rest transport", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestGuildResponse({
        id: "guild_42",
        name: "Fluxer HQ"
      });
    }
  });

  const guild = await transport.fetchGuild("guild_42");

  assert.equal(requests[0], "https://fluxer.local/api/v1/guilds/guild_42");
  assert.deepEqual(guild, {
    id: "guild_42",
    name: "Fluxer HQ",
    iconUrl: "https://cdn.fluxer.local/icon.png"
  });
});

test("lists pinned messages through rest transport with pagination query params", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestPinnedMessageListResponse();
    }
  });

  const pinnedMessages = await transport.listPinnedMessages("general", {
    limit: 2,
    before: new Date("2026-03-19T00:00:00.000Z")
  });

  assert.equal(
    requests[0],
    "https://fluxer.local/api/v1/channels/general/messages/pins?limit=2&before=2026-03-19T00%3A00%3A00.000Z"
  );
  assert.equal(pinnedMessages.hasMore, true);
  assert.deepEqual(
    pinnedMessages.items.map((item) => ({
      id: item.message.id,
      content: item.message.content,
      pinnedAt: item.pinnedAt.toISOString()
    })),
    [
      { id: "msg_2", content: "pinned second", pinnedAt: "2026-03-18T22:10:00.000Z" },
      { id: "msg_1", content: "pinned first", pinnedAt: "2026-03-18T22:05:00.000Z" }
    ]
  );
});

test("indicates typing activity through rest transport", async () => {
  const requests: Array<{ method?: string; url: string }> = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input, init) => {
      requests.push({
        method: init?.method,
        url: String(input)
      });
      return new Response(null, {
        status: 204
      });
    }
  });

  await transport.indicateTyping("general");

  assert.deepEqual(requests, [
    {
      method: "POST",
      url: "https://fluxer.local/api/v1/channels/general/typing"
    }
  ]);
});

test("client proxies message lifecycle operations through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  await client.connect();
  await client.sendMessage("general", "first");

  const fetched = await client.fetchMessage("general", "mock_msg_1");
  const edited = await client.editMessage("general", "mock_msg_1", "updated");
  const fetchedAgain = await client.fetchMessage("general", "mock_msg_1");
  await client.deleteMessage("general", "mock_msg_1");

  assert.equal(fetched.content, "first");
  assert.equal(edited.content, "updated");
  assert.equal(fetchedAgain.content, "updated");

  await assert.rejects(async () => {
    await client.fetchMessage("general", "mock_msg_1");
  }, /could not find the requested message/i);
});

test("client fetches channels through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  await client.connect();
  await client.sendMessage("general", "first");

  const channel = await client.fetchChannel("general");

  assert.deepEqual(channel, {
    id: "general",
    name: "general",
    type: "text"
  });
});

test("client fetches guilds through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  transport.setGuild({
    id: "guild_1",
    name: "Fluxer Guild",
    iconUrl: "https://cdn.fluxer.local/icon.png"
  });

  await client.connect();

  assert.deepEqual(await client.fetchGuild("guild_1"), {
    id: "guild_1",
    name: "Fluxer Guild",
    iconUrl: "https://cdn.fluxer.local/icon.png"
  });
});

test("client lists pinned messages through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  await client.connect();
  await client.sendMessage("general", "first");
  await client.sendMessage("general", "second");
  transport.pinMessage("general", "mock_msg_1", new Date("2026-03-18T22:05:00.000Z"));
  transport.pinMessage("general", "mock_msg_2", new Date("2026-03-18T22:10:00.000Z"));

  const pinnedMessages = await client.listPinnedMessages("general", {
    limit: 1
  });

  assert.equal(pinnedMessages.hasMore, true);
  assert.deepEqual(
    pinnedMessages.items.map((item) => ({
      id: item.message.id,
      content: item.message.content,
      pinnedAt: item.pinnedAt.toISOString()
    })),
    [
      { id: "mock_msg_2", content: "second", pinnedAt: "2026-03-18T22:10:00.000Z" }
    ]
  );
});

test("client indicates typing through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  await client.connect();
  await client.indicateTyping("general");

  assert.deepEqual(transport.typingChannelIds, ["general"]);
  assert.deepEqual(await client.fetchChannel("general"), {
    id: "general",
    name: "general",
    type: "text"
  });
});

test("lists channel messages through rest transport with pagination query params", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestMessageListResponse();
    }
  });

  const messages = await transport.listMessages("general", {
    limit: 2,
    before: "msg_99"
  });

  assert.equal(requests[0], "https://fluxer.local/api/v1/channels/general/messages?limit=2&before=msg_99");
  assert.deepEqual(
    messages.map((message) => ({
      id: message.id,
      content: message.content,
      authorId: message.author.id
    })),
    [
      { id: "msg_2", content: "second", authorId: "user_1" },
      { id: "msg_1", content: "first", authorId: "user_2" }
    ]
  );
});

test("client lists messages through mock transport in reverse chronological order", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  await client.connect();
  await client.sendMessage("general", "first");
  await new Promise((resolve) => setTimeout(resolve, 2));
  await client.sendMessage("general", "second");

  const messages = await client.listMessages("general", {
    limit: 1
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, "second");
});

test("rejects invalid listMessages limits", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api"
  });

  await assert.rejects(async () => {
    await transport.listMessages("general", { limit: 0 });
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_CONFIGURATION_INVALID");
    assert.equal(error.details?.limit, 0);
    return true;
  });
});

test("rejects invalid listPinnedMessages limits", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api"
  });

  await assert.rejects(async () => {
    await transport.listPinnedMessages("general", { limit: 0 });
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_CONFIGURATION_INVALID");
    assert.equal(error.details?.limit, 0);
    return true;
  });
});

