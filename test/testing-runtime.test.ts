import test from "node:test";
import assert from "node:assert/strict";
import { FluxerBot } from "../src/core/Bot.js";
import { FluxerTestRuntime } from "../src/testing/TestRuntime.js";

test("waitForSentMessage resolves when a later sent message matches the filter", async () => {
  const runtime = new FluxerTestRuntime();
  const bot = new FluxerBot({
    name: "RuntimeBot",
    prefix: "!"
  });

  bot.command({
    name: "sequence",
    execute: async ({ reply }) => {
      await reply("first");
      await reply("second");
    }
  });

  runtime.registerBot(bot);
  await runtime.connect();

  const replyPromise = runtime.waitForSentMessage({
    filter: (payload) => payload.content === "second"
  });

  await runtime.injectMessage("!sequence");

  const reply = await replyPromise;
  assert.equal(reply.content, "second");
});

test("waitForSentMessage times out when no sent message matches", async () => {
  const runtime = new FluxerTestRuntime();
  await runtime.connect();

  await assert.rejects(
    () =>
      runtime.waitForSentMessage({
        timeoutMs: 10
      }),
    /Timed out waiting for a sent message\./
  );
});

test("waitForSentMessage rejects when the wait is aborted", async () => {
  const runtime = new FluxerTestRuntime();
  const controller = new AbortController();
  await runtime.connect();

  const waitPromise = runtime.waitForSentMessage({
    signal: controller.signal
  });

  controller.abort();

  await assert.rejects(waitPromise, /Sent message wait aborted\./);
});

test("waitForSentMessage resolves immediately from an existing sent message without new transport activity", async () => {
  const runtime = new FluxerTestRuntime();
  const bot = new FluxerBot({
    name: "RuntimeBot",
    prefix: "!"
  });

  bot.command({
    name: "ping",
    execute: async ({ reply }) => {
      await reply("pong");
    }
  });

  runtime.registerBot(bot);
  await runtime.connect();
  await runtime.injectMessage("!ping");

  const reply = await runtime.waitForSentMessage();
  assert.equal(reply.content, "pong");
  assert.equal(runtime.sentMessages.length, 1);
});
