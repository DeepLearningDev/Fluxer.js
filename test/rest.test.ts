import test from 'node:test';
import assert from 'node:assert/strict';
import { AttachmentBuilder, EmbedBuilder } from '../src/core/builders.js';
import { RestTransportError } from '../src/core/errors.js';
import { RestTransport } from '../src/core/RestTransport.js';test("emits typed diagnostics for invalid rest transport configuration", async () => {
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
    assert.equal(error.details?.message, "network down");
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

