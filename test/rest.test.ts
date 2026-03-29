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

function createRateLimitedResponse(options: {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
} = {}): Response {
  return new Response(
    options.body ? JSON.stringify(options.body) : null,
    {
      status: 429,
      statusText: "Too Many Requests",
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers
      }
    }
  );
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

function createRestCurrentUserResponse(overrides: Partial<{
  id: string;
  username: string;
  global_name: string | null;
  bot: boolean;
}> = {}): Response {
  return new Response(JSON.stringify({
    id: "bot_1",
    username: "fluxbot",
    global_name: "Flux Bot",
    bot: true,
    ...overrides
  }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createRestUserResponse(overrides: Partial<{
  id: string;
  username: string;
  global_name: string | null;
  bot: boolean;
}> = {}): Response {
  return new Response(JSON.stringify({
    id: "user_42",
    username: "fluxfriend",
    global_name: "Flux Friend",
    bot: false,
    ...overrides
  }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createRestInviteResponse(overrides: Partial<{
  code: string;
  guild: { id: string };
  channel: { id: string };
  inviter: {
    id: string;
    username: string;
    global_name?: string | null;
    bot?: boolean;
  };
  temporary: boolean;
  expires_at: string | null;
}> = {}): Response {
  return new Response(JSON.stringify({
    code: "fluxer",
    guild: {
      id: "guild_42"
    },
    channel: {
      id: "general"
    },
    inviter: {
      id: "user_1",
      username: "fluxguy",
      global_name: "Flux Guy",
      bot: false
    },
    temporary: false,
    expires_at: "2026-03-25T12:00:00.000Z",
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

function createRestGuildChannelListResponse(): Response {
  return new Response(JSON.stringify([
    {
      id: "general",
      name: "general",
      type: 0
    },
    {
      id: "mods",
      name: "mods",
      type: 0
    }
  ]), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createRestGuildMemberResponse(overrides: Partial<{
  nick: string | null;
  roles: string[];
  joined_at: string;
  user: {
    id: string;
    username: string;
    global_name?: string;
    bot?: boolean;
  };
}> = {}): Response {
  return new Response(JSON.stringify({
    nick: "Flux",
    roles: ["role_1", "role_2"],
    joined_at: "2026-03-18T21:00:00.000Z",
    user: {
      id: "user_42",
      username: "fluxguy",
      global_name: "Flux Guy"
    },
    ...overrides
  }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createRestRoleListResponse(): Response {
  return new Response(JSON.stringify([
    {
      id: "role_2",
      name: "Moderator",
      color: 255,
      position: 2,
      permissions: "1234"
    },
    {
      id: "role_1",
      name: "Member",
      color: 0,
      position: 1,
      permissions: "5678"
    }
  ]), {
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

test("prefers api_public from discovery for bot-auth rest requests", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    discovery: {
      api_code_version: 1,
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
    },
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestCurrentUserResponse();
    }
  });

  const user = await transport.fetchCurrentUser();

  assert.equal(user.id, "bot_1");
  assert.equal(requests[0], "https://fluxer.local/public-api/v1/users/@me");
});

test("deduplicates concurrent discovery fetches on first base-url resolution", async () => {
  let discoveryRequests = 0;

  const transport = new RestTransport({
    instanceUrl: "https://fluxer.local",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/.well-known/fluxer")) {
        discoveryRequests += 1;
        return new Response(JSON.stringify({
          api_code_version: 1,
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
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      return createRestCurrentUserResponse();
    }
  });

  const [first, second] = await Promise.all([
    transport.fetchCurrentUser(),
    transport.fetchCurrentUser()
  ]);

  assert.equal(first.id, "bot_1");
  assert.equal(second.id, "bot_1");
  assert.equal(discoveryRequests, 1);
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
  assert.ok(uploadedFile instanceof Blob);
  assert.equal(Object.prototype.toString.call(uploadedFile), "[object File]");
  assert.equal((uploadedFile as Blob & { name?: string }).name, "graph.png");
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

test("surfaces rate-limit metadata across message lifecycle endpoints", async () => {
  const scenarios = [
    {
      name: "listMessages",
      invoke: (transport: RestTransport) => transport.listMessages("general"),
      response: () =>
        createRateLimitedResponse({
          body: {
            global: false
          },
          headers: {
            "x-ratelimit-reset-after": "1.5",
            "x-ratelimit-bucket": "messages:general"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/channels/general/messages",
        retryAfterMs: 1500,
        retryAfterSource: "reset_after",
        global: false
      }
    },
    {
      name: "fetchMessage",
      invoke: (transport: RestTransport) => transport.fetchMessage("general", "msg_1"),
      response: () =>
        createRateLimitedResponse({
          body: {
            retry_after_ms: 1200,
            global: true
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/channels/general/messages/msg_1",
        messageId: "msg_1",
        retryAfterMs: 1200,
        retryAfterSource: "body",
        global: true
      }
    },
    {
      name: "editMessage",
      invoke: (transport: RestTransport) => transport.editMessage("general", "msg_1", {
        content: "updated"
      }),
      response: () =>
        createRateLimitedResponse({
          body: {
            retry_after: 1.5
          },
          headers: {
            "retry-after": "2"
          }
        }),
      expected: {
        method: "PATCH",
        url: "https://fluxer.local/api/v1/channels/general/messages/msg_1",
        messageId: "msg_1",
        retryAfterMs: 2000,
        retryAfterSource: "header"
      }
    },
    {
      name: "deleteMessage",
      invoke: (transport: RestTransport) => transport.deleteMessage("general", "msg_1"),
      response: () =>
        createRateLimitedResponse({
          headers: {
            "x-ratelimit-reset-after": "0.25"
          }
        }),
      expected: {
        method: "DELETE",
        url: "https://fluxer.local/api/v1/channels/general/messages/msg_1",
        messageId: "msg_1",
        retryAfterMs: 250,
        retryAfterSource: "reset_after"
      }
    }
  ] as const;

  for (const scenario of scenarios) {
    const transport = new RestTransport({
      baseUrl: "https://fluxer.local/api",
      fetchImpl: async () => scenario.response()
    });

    await assert.rejects(async () => {
      await scenario.invoke(transport);
    }, (error: unknown) => {
      assert.ok(error instanceof RestTransportError, `${scenario.name} should reject with RestTransportError`);
      assert.equal(error.code, "REST_RATE_LIMITED");
      assert.equal(error.status, 429);
      assert.equal(error.retryable, true);
      assert.equal(error.retryAfterMs, scenario.expected.retryAfterMs);
      assert.equal(error.details?.method, scenario.expected.method);
      assert.equal(error.details?.url, scenario.expected.url);
      assert.equal(error.details?.channelId, "general");
      assert.equal(
        error.details?.messageId,
        "messageId" in scenario.expected ? scenario.expected.messageId : undefined
      );
      assert.equal(error.details?.retryAfterMs, scenario.expected.retryAfterMs);
      assert.equal(error.details?.retryAfterSource, scenario.expected.retryAfterSource);
      assert.equal(
        error.details?.global,
        "global" in scenario.expected ? scenario.expected.global : undefined
      );
      return true;
    });
  }
});

test("rejects invalid message lifecycle responses from rest transport", async () => {
  const scenarios = [
    {
      name: "listMessages",
      invoke: (transport: RestTransport) => transport.listMessages("general"),
      response: () =>
        new Response(JSON.stringify([
          {
            id: "msg_1",
            content: "hello",
            channel_id: "general",
            timestamp: "2026-03-18T22:00:00.000Z",
            author: {
              id: "user_1"
            }
          }
        ]), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/channels/general/messages",
        messageId: "msg_1"
      }
    },
    {
      name: "fetchMessage",
      invoke: (transport: RestTransport) => transport.fetchMessage("general", "msg_1"),
      response: () =>
        new Response(JSON.stringify({
          id: "msg_1",
          content: "hello",
          channel_id: "general",
          timestamp: "2026-03-18T22:00:00.000Z",
          author: {
            id: "user_1"
          }
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/channels/general/messages/msg_1",
        messageId: "msg_1"
      }
    },
    {
      name: "editMessage",
      invoke: (transport: RestTransport) => transport.editMessage("general", "msg_1", {
        content: "updated"
      }),
      response: () =>
        new Response(JSON.stringify({
          id: "msg_1",
          content: "updated",
          channel_id: "general",
          timestamp: "2026-03-18T22:00:00.000Z",
          author: {
            id: "user_1"
          }
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      expected: {
        method: "PATCH",
        url: "https://fluxer.local/api/v1/channels/general/messages/msg_1",
        messageId: "msg_1"
      }
    }
  ] as const;

  for (const scenario of scenarios) {
    const transport = new RestTransport({
      baseUrl: "https://fluxer.local/api",
      fetchImpl: async () => scenario.response()
    });

    await assert.rejects(async () => {
      await scenario.invoke(transport);
    }, (error: unknown) => {
      assert.ok(error instanceof RestTransportError, `${scenario.name} should reject with RestTransportError`);
      assert.equal(error.code, "REST_RESPONSE_INVALID");
      assert.equal(error.details?.method, scenario.expected.method);
      assert.equal(error.details?.url, scenario.expected.url);
      assert.equal(error.details?.channelId, "general");
      assert.equal(
        error.details?.messageId,
        "messageId" in scenario.expected ? scenario.expected.messageId : undefined
      );
      return true;
    });
  }
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

test("fetches the current user through rest transport", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestCurrentUserResponse();
    }
  });

  const user = await transport.fetchCurrentUser();

  assert.equal(requests[0], "https://fluxer.local/api/v1/users/@me");
  assert.deepEqual(user, {
    id: "bot_1",
    username: "fluxbot",
    displayName: "Flux Bot",
    isBot: true
  });
});

test("fetches users by id through rest transport", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestUserResponse();
    }
  });

  const user = await transport.fetchUser("user_42");

  assert.equal(requests[0], "https://fluxer.local/api/v1/users/user_42");
  assert.deepEqual(user, {
    id: "user_42",
    username: "fluxfriend",
    displayName: "Flux Friend",
    isBot: false
  });
});

test("surfaces rate-limit metadata for identity and channel reads", async () => {
  const scenarios = [
    {
      name: "fetchChannel",
      invoke: (transport: RestTransport) => transport.fetchChannel("general"),
      response: () =>
        createRateLimitedResponse({
          body: {
            retry_after_ms: 750,
            global: false
          },
          headers: {
            "x-ratelimit-bucket": "channels:general"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/channels/general",
        channelId: "general",
        retryAfterMs: 750,
        retryAfterSource: "body",
        global: false
      }
    },
    {
      name: "fetchCurrentUser",
      invoke: (transport: RestTransport) => transport.fetchCurrentUser(),
      response: () =>
        createRateLimitedResponse({
          headers: {
            "x-ratelimit-reset-after": "0.5",
            "x-ratelimit-bucket": "users:@me"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/users/@me",
        retryAfterMs: 500,
        retryAfterSource: "reset_after"
      }
    },
    {
      name: "fetchUser",
      invoke: (transport: RestTransport) => transport.fetchUser("user_42"),
      response: () =>
        createRateLimitedResponse({
          body: {
            retry_after: 1.2,
            global: true
          },
          headers: {
            "retry-after": "2"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/users/user_42",
        userId: "user_42",
        retryAfterMs: 2000,
        retryAfterSource: "header",
        global: true
      }
    }
  ] as const;

  for (const scenario of scenarios) {
    const transport = new RestTransport({
      baseUrl: "https://fluxer.local/api",
      fetchImpl: async () => scenario.response()
    });

    await assert.rejects(async () => {
      await scenario.invoke(transport);
    }, (error: unknown) => {
      assert.ok(error instanceof RestTransportError, `${scenario.name} should reject with RestTransportError`);
      assert.equal(error.code, "REST_RATE_LIMITED");
      assert.equal(error.status, 429);
      assert.equal(error.retryable, true);
      assert.equal(error.details?.method, scenario.expected.method);
      assert.equal(error.details?.url, scenario.expected.url);
      assert.equal(
        error.details?.channelId,
        "channelId" in scenario.expected ? scenario.expected.channelId : undefined
      );
      assert.equal(
        error.details?.userId,
        "userId" in scenario.expected ? scenario.expected.userId : undefined
      );
      assert.equal(error.retryAfterMs, scenario.expected.retryAfterMs);
      assert.equal(error.details?.retryAfterMs, scenario.expected.retryAfterMs);
      assert.equal(error.details?.retryAfterSource, scenario.expected.retryAfterSource);
      assert.equal(
        error.details?.global,
        "global" in scenario.expected ? scenario.expected.global : undefined
      );
      return true;
    });
  }
});

test("rejects invalid identity and channel responses from rest transport", async () => {
  const scenarios = [
    {
      name: "fetchChannel",
      invoke: (transport: RestTransport) => transport.fetchChannel("general"),
      response: () =>
        new Response(JSON.stringify({
          id: "general"
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/channels/general",
        channelId: "general"
      }
    },
    {
      name: "fetchCurrentUser",
      invoke: (transport: RestTransport) => transport.fetchCurrentUser(),
      response: () =>
        new Response(JSON.stringify({
          id: "bot_1"
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/users/@me"
      }
    },
    {
      name: "fetchUser",
      invoke: (transport: RestTransport) => transport.fetchUser("user_42"),
      response: () =>
        new Response(JSON.stringify({
          id: "user_42"
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/users/user_42",
        userId: "user_42"
      }
    }
  ] as const;

  for (const scenario of scenarios) {
    const transport = new RestTransport({
      baseUrl: "https://fluxer.local/api",
      fetchImpl: async () => scenario.response()
    });

    await assert.rejects(async () => {
      await scenario.invoke(transport);
    }, (error: unknown) => {
      assert.ok(error instanceof RestTransportError, `${scenario.name} should reject with RestTransportError`);
      assert.equal(error.code, "REST_RESPONSE_INVALID");
      assert.equal(error.details?.method, scenario.expected.method);
      assert.equal(error.details?.url, scenario.expected.url);
      assert.equal(
        error.details?.channelId,
        "channelId" in scenario.expected ? scenario.expected.channelId : undefined
      );
      assert.equal(
        error.details?.userId,
        "userId" in scenario.expected ? scenario.expected.userId : undefined
      );
      return true;
    });
  }
});

test("fetches invite information through rest transport", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestInviteResponse();
    }
  });

  const invite = await transport.fetchInvite("fluxer");

  assert.equal(requests[0], "https://fluxer.local/api/v1/invites/fluxer");
  assert.deepEqual(invite, {
    code: "fluxer",
    guildId: "guild_42",
    channelId: "general",
    inviter: {
      id: "user_1",
      username: "fluxguy",
      displayName: "Flux Guy",
      isBot: false
    },
    temporary: false,
    expiresAt: new Date("2026-03-25T12:00:00.000Z")
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

test("lists guild channels through rest transport", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestGuildChannelListResponse();
    }
  });

  const channels = await transport.listGuildChannels("guild_42");

  assert.equal(requests[0], "https://fluxer.local/api/v1/guilds/guild_42/channels");
  assert.deepEqual(channels, [
    {
      id: "general",
      name: "general",
      type: "text"
    },
    {
      id: "mods",
      name: "mods",
      type: "text"
    }
  ]);
});

test("fetches guild members through rest transport", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestGuildMemberResponse({
        user: {
          id: "user_99",
          username: "modbot",
          bot: true
        },
        roles: ["role_mod"],
        nick: null
      });
    }
  });

  const member = await transport.fetchGuildMember("guild_42", "user_99");

  assert.equal(requests[0], "https://fluxer.local/api/v1/guilds/guild_42/members/user_99");
  assert.deepEqual(member, {
    guildId: "guild_42",
    user: {
      id: "user_99",
      username: "modbot",
      displayName: undefined,
      isBot: true
    },
    nickname: undefined,
    roles: ["role_mod"],
    joinedAt: new Date("2026-03-18T21:00:00.000Z")
  });
});

test("rejects invalid guild member responses from rest transport", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async () =>
      createRestGuildMemberResponse({
        roles: ["role_1", 2 as unknown as string]
      })
  });

  await assert.rejects(async () => {
    await transport.fetchGuildMember("guild_42", "user_99");
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_RESPONSE_INVALID");
    assert.equal(error.details?.guildId, "guild_42");
    assert.equal(error.details?.userId, "user_99");
    return true;
  });
});

test("lists guild roles through rest transport", async () => {
  const requests: string[] = [];

  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return createRestRoleListResponse();
    }
  });

  const roles = await transport.listGuildRoles("guild_42");

  assert.equal(requests[0], "https://fluxer.local/api/v1/guilds/guild_42/roles");
  assert.deepEqual(roles, [
    {
      id: "role_2",
      guildId: "guild_42",
      name: "Moderator",
      color: 255,
      position: 2,
      permissions: "1234"
    },
    {
      id: "role_1",
      guildId: "guild_42",
      name: "Member",
      color: 0,
      position: 1,
      permissions: "5678"
    }
  ]);
});

test("rejects invalid role field types from rest transport", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async () =>
      new Response(JSON.stringify([
        {
          id: "role_1",
          name: "Moderator",
          color: "red"
        }
      ]), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
  });

  await assert.rejects(async () => {
    await transport.listGuildRoles("guild_42");
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_RESPONSE_INVALID");
    assert.equal(error.details?.method, "GET");
    assert.equal(error.details?.url, "https://fluxer.local/api/v1/guilds/guild_42/roles");
    assert.equal(error.details?.guildId, "guild_42");
    return true;
  });
});

test("surfaces rate-limit metadata for invite and guild reads", async () => {
  const scenarios = [
    {
      name: "fetchInvite",
      invoke: (transport: RestTransport) => transport.fetchInvite("fluxer"),
      response: () =>
        createRateLimitedResponse({
          body: {
            retry_after_ms: 1100,
            global: false
          },
          headers: {
            "x-ratelimit-bucket": "invites:fluxer"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/invites/fluxer",
        inviteCode: "fluxer",
        retryAfterMs: 1100,
        retryAfterSource: "body",
        global: false
      }
    },
    {
      name: "fetchGuild",
      invoke: (transport: RestTransport) => transport.fetchGuild("guild_42"),
      response: () =>
        createRateLimitedResponse({
          headers: {
            "x-ratelimit-reset-after": "0.8",
            "x-ratelimit-bucket": "guilds:guild_42"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/guilds/guild_42",
        guildId: "guild_42",
        retryAfterMs: 800,
        retryAfterSource: "reset_after"
      }
    },
    {
      name: "listGuildChannels",
      invoke: (transport: RestTransport) => transport.listGuildChannels("guild_42"),
      response: () =>
        createRateLimitedResponse({
          body: {
            retry_after: 1.5,
            global: true
          },
          headers: {
            "retry-after": "2"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/guilds/guild_42/channels",
        guildId: "guild_42",
        retryAfterMs: 2000,
        retryAfterSource: "header",
        global: true
      }
    },
    {
      name: "fetchGuildMember",
      invoke: (transport: RestTransport) => transport.fetchGuildMember("guild_42", "user_99"),
      response: () =>
        createRateLimitedResponse({
          body: {
            retry_after_ms: 600
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/guilds/guild_42/members/user_99",
        guildId: "guild_42",
        userId: "user_99",
        retryAfterMs: 600,
        retryAfterSource: "body"
      }
    },
    {
      name: "listGuildRoles",
      invoke: (transport: RestTransport) => transport.listGuildRoles("guild_42"),
      response: () =>
        createRateLimitedResponse({
          headers: {
            "x-ratelimit-reset-after": "0.4"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/guilds/guild_42/roles",
        guildId: "guild_42",
        retryAfterMs: 400,
        retryAfterSource: "reset_after"
      }
    }
  ] as const;

  for (const scenario of scenarios) {
    const transport = new RestTransport({
      baseUrl: "https://fluxer.local/api",
      fetchImpl: async () => scenario.response()
    });

    await assert.rejects(async () => {
      await scenario.invoke(transport);
    }, (error: unknown) => {
      assert.ok(error instanceof RestTransportError, `${scenario.name} should reject with RestTransportError`);
      assert.equal(error.code, "REST_RATE_LIMITED");
      assert.equal(error.status, 429);
      assert.equal(error.retryable, true);
      assert.equal(error.details?.method, scenario.expected.method);
      assert.equal(error.details?.url, scenario.expected.url);
      assert.equal(
        error.details?.inviteCode,
        "inviteCode" in scenario.expected ? scenario.expected.inviteCode : undefined
      );
      assert.equal(
        error.details?.guildId,
        "guildId" in scenario.expected ? scenario.expected.guildId : undefined
      );
      assert.equal(
        error.details?.userId,
        "userId" in scenario.expected ? scenario.expected.userId : undefined
      );
      assert.equal(error.retryAfterMs, scenario.expected.retryAfterMs);
      assert.equal(error.details?.retryAfterMs, scenario.expected.retryAfterMs);
      assert.equal(error.details?.retryAfterSource, scenario.expected.retryAfterSource);
      assert.equal(
        error.details?.global,
        "global" in scenario.expected ? scenario.expected.global : undefined
      );
      return true;
    });
  }
});

test("rejects invalid invite and guild responses from rest transport", async () => {
  const scenarios = [
    {
      name: "fetchInvite",
      invoke: (transport: RestTransport) => transport.fetchInvite("fluxer"),
      response: () =>
        new Response(JSON.stringify({
          guild: {
            id: "guild_42"
          }
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/invites/fluxer",
        inviteCode: "fluxer"
      }
    },
    {
      name: "fetchGuild",
      invoke: (transport: RestTransport) => transport.fetchGuild("guild_42"),
      response: () =>
        new Response(JSON.stringify({
          id: "guild_42"
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/guilds/guild_42",
        guildId: "guild_42"
      }
    },
    {
      name: "listGuildChannels",
      invoke: (transport: RestTransport) => transport.listGuildChannels("guild_42"),
      response: () =>
        new Response(JSON.stringify({
          channels: []
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/guilds/guild_42/channels",
        guildId: "guild_42"
      }
    },
    {
      name: "listGuildRoles",
      invoke: (transport: RestTransport) => transport.listGuildRoles("guild_42"),
      response: () =>
        new Response(JSON.stringify([
          {
            id: "role_1"
          }
        ]), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      expected: {
        method: "GET",
        url: "https://fluxer.local/api/v1/guilds/guild_42/roles",
        guildId: "guild_42"
      }
    }
  ] as const;

  for (const scenario of scenarios) {
    const transport = new RestTransport({
      baseUrl: "https://fluxer.local/api",
      fetchImpl: async () => scenario.response()
    });

    await assert.rejects(async () => {
      await scenario.invoke(transport);
    }, (error: unknown) => {
      assert.ok(error instanceof RestTransportError, `${scenario.name} should reject with RestTransportError`);
      assert.equal(error.code, "REST_RESPONSE_INVALID");
      assert.equal(error.details?.method, scenario.expected.method);
      assert.equal(error.details?.url, scenario.expected.url);
      assert.equal(
        error.details?.inviteCode,
        "inviteCode" in scenario.expected ? scenario.expected.inviteCode : undefined
      );
      assert.equal(
        error.details?.guildId,
        "guildId" in scenario.expected ? scenario.expected.guildId : undefined
      );
      return true;
    });
  }
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

test("surfaces rate-limit metadata for pinned message listing", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async () =>
      createRateLimitedResponse({
        body: {
          retry_after_ms: 900,
          global: false
        },
        headers: {
          "x-ratelimit-bucket": "pins:general"
        }
      })
  });

  await assert.rejects(async () => {
    await transport.listPinnedMessages("general", {
      limit: 2
    });
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_RATE_LIMITED");
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 900);
    assert.equal(error.details?.method, "GET");
    assert.equal(error.details?.url, "https://fluxer.local/api/v1/channels/general/messages/pins?limit=2");
    assert.equal(error.details?.channelId, "general");
    assert.equal(error.details?.retryAfterSource, "body");
    assert.equal(error.details?.bucket, "pins:general");
    assert.equal(error.details?.global, false);
    return true;
  });
});

test("rejects invalid pinned message responses from rest transport", async () => {
  const scenarios = [
    {
      name: "invalid response shape",
      response: () =>
        new Response(JSON.stringify({
          items: "not-an-array",
          has_more: true
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
    },
    {
      name: "invalid pin timestamp",
      response: () =>
        new Response(JSON.stringify({
          items: [
            {
              message: {
                id: "msg_1",
                content: "hello",
                channel_id: "general",
                timestamp: "2026-03-18T22:00:00.000Z",
                author: {
                  id: "user_1",
                  username: "fluxguy"
                }
              },
              pinned_at: "not-a-date"
            }
          ],
          has_more: false
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
    }
  ] as const;

  for (const scenario of scenarios) {
    const transport = new RestTransport({
      baseUrl: "https://fluxer.local/api",
      fetchImpl: async () => scenario.response()
    });

    await assert.rejects(async () => {
      await transport.listPinnedMessages("general");
    }, (error: unknown) => {
      assert.ok(error instanceof RestTransportError, `${scenario.name} should reject with RestTransportError`);
      assert.equal(error.code, "REST_RESPONSE_INVALID");
      assert.equal(error.details?.method, "GET");
      assert.equal(error.details?.url, "https://fluxer.local/api/v1/channels/general/messages/pins");
      assert.equal(error.details?.channelId, "general");
      return true;
    });
  }
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

test("emits typed diagnostics when typing requests fail before a response", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async () => {
      throw new Error("socket hang up");
    }
  });

  await assert.rejects(async () => {
    await transport.indicateTyping("general");
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_REQUEST_FAILED");
    assert.equal(error.retryable, true);
    assert.equal(error.details?.method, "POST");
    assert.equal(error.details?.url, "https://fluxer.local/api/v1/channels/general/typing");
    assert.equal(error.details?.channelId, "general");
    assert.equal(error.details?.message, "socket hang up");
    return true;
  });
});

test("emits typed diagnostics for typing http failures", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async () =>
      new Response("denied", {
        status: 403,
        statusText: "Forbidden"
      })
  });

  await assert.rejects(async () => {
    await transport.indicateTyping("general");
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_HTTP_ERROR");
    assert.equal(error.status, 403);
    assert.equal(error.retryable, false);
    assert.equal(error.details?.method, "POST");
    assert.equal(error.details?.url, "https://fluxer.local/api/v1/channels/general/typing");
    assert.equal(error.details?.channelId, "general");
    assert.equal(error.details?.statusText, "Forbidden");
    assert.equal(error.details?.responseBody, "denied");
    return true;
  });
});

test("emits typed diagnostics for typing rate limits with retry metadata", async () => {
  const transport = new RestTransport({
    baseUrl: "https://fluxer.local/api",
    fetchImpl: async () =>
      createRateLimitedResponse({
        body: {
          retry_after: 1.25,
          global: false
        },
        headers: {
          "content-type": "application/json",
          "x-ratelimit-reset-after": "1.5",
          "x-ratelimit-bucket": "typing:general"
        }
      })
  });

  await assert.rejects(async () => {
    await transport.indicateTyping("general");
  }, (error: unknown) => {
    assert.ok(error instanceof RestTransportError);
    assert.equal(error.code, "REST_RATE_LIMITED");
    assert.equal(error.status, 429);
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 1500);
    assert.equal(error.details?.method, "POST");
    assert.equal(error.details?.url, "https://fluxer.local/api/v1/channels/general/typing");
    assert.equal(error.details?.channelId, "general");
    assert.equal(error.details?.retryAfterMs, 1500);
    assert.equal(error.details?.retryAfterSource, "reset_after");
    assert.equal(error.details?.bucket, "typing:general");
    assert.equal(error.details?.global, false);
    return true;
  });
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

test("client lists guild channels through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  transport.setGuildChannels("guild_1", [
    {
      id: "general",
      name: "general",
      type: "text"
    },
    {
      id: "mods",
      name: "mods",
      type: "text"
    }
  ]);

  await client.connect();

  assert.deepEqual(await client.listGuildChannels("guild_1"), [
    {
      id: "general",
      name: "general",
      type: "text"
    },
    {
      id: "mods",
      name: "mods",
      type: "text"
    }
  ]);
});

test("client fetches the current user through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  transport.setCurrentUser({
    id: "bot_9",
    username: "fluxhelper",
    displayName: "Flux Helper",
    isBot: true
  });

  await client.connect();

  assert.deepEqual(await client.fetchCurrentUser(), {
    id: "bot_9",
    username: "fluxhelper",
    displayName: "Flux Helper",
    isBot: true
  });
});

test("client fetches users by id through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  transport.setUser({
    id: "user_42",
    username: "fluxfriend",
    displayName: "Flux Friend",
    isBot: false
  });

  await client.connect();

  assert.deepEqual(await client.fetchUser("user_42"), {
    id: "user_42",
    username: "fluxfriend",
    displayName: "Flux Friend",
    isBot: false
  });
});

test("client fetches invites through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  transport.setInvite({
    code: "fluxer",
    guildId: "guild_42",
    channelId: "general",
    inviter: {
      id: "user_1",
      username: "fluxguy",
      displayName: "Flux Guy",
      isBot: false
    },
    temporary: false,
    expiresAt: new Date("2026-03-25T12:00:00.000Z")
  });

  await client.connect();

  assert.deepEqual(await client.fetchInvite("fluxer"), {
    code: "fluxer",
    guildId: "guild_42",
    channelId: "general",
    inviter: {
      id: "user_1",
      username: "fluxguy",
      displayName: "Flux Guy",
      isBot: false
    },
    temporary: false,
    expiresAt: new Date("2026-03-25T12:00:00.000Z")
  });
});

test("client lists guild roles through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  transport.setGuildRoles("guild_1", [
    {
      id: "role_1",
      guildId: "guild_1",
      name: "Member",
      permissions: "123"
    },
    {
      id: "role_2",
      guildId: "guild_1",
      name: "Moderator",
      permissions: "456"
    }
  ]);

  await client.connect();

  assert.deepEqual(await client.listGuildRoles("guild_1"), [
    {
      id: "role_1",
      guildId: "guild_1",
      name: "Member",
      permissions: "123"
    },
    {
      id: "role_2",
      guildId: "guild_1",
      name: "Moderator",
      permissions: "456"
    }
  ]);
});

test("client fetches guild members through mock transport", async () => {
  const transport = new MockTransport();
  const client = new FluxerClient(transport);

  transport.setGuildMember({
    guildId: "guild_1",
    user: {
      id: "user_1",
      username: "fluxguy",
      displayName: "Flux Guy"
    },
    nickname: "Flux",
    roles: ["role_1"],
    joinedAt: new Date("2026-03-18T21:00:00.000Z")
  });

  await client.connect();

  assert.deepEqual(await client.fetchGuildMember("guild_1", "user_1"), {
    guildId: "guild_1",
    user: {
      id: "user_1",
      username: "fluxguy",
      displayName: "Flux Guy"
    },
    nickname: "Flux",
    roles: ["role_1"],
    joinedAt: new Date("2026-03-18T21:00:00.000Z")
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

