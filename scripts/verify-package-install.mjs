import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(repoDir, "package.json");
const typeScriptCliPath = path.join(repoDir, "node_modules", "typescript", "lib", "tsc.js");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const packageName = packageJson.name;
const processRef = globalThis.process;

if (typeof packageName !== "string" || packageName.length === 0) {
  throw new Error("Package smoke check could not determine the package name.");
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fluxer-js-package-smoke-"));
let tarballPath;

try {
  const packOutput = runCommand("npm", ["pack", "--json"], {
    cwd: repoDir
  });
  const packed = JSON.parse(packOutput);

  if (!Array.isArray(packed) || packed.length === 0 || typeof packed[0]?.filename !== "string") {
    throw new Error("Package smoke check could not determine the tarball filename from npm pack.");
  }

  tarballPath = path.join(repoDir, packed[0].filename);

  const consumerDir = path.join(tempRoot, "consumer");
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    path.join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: "fluxer-js-package-smoke",
        private: true,
        type: "module"
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  runCommand(
    "npm",
    [
      "install",
      "--no-package-lock",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarballPath
    ],
    { cwd: consumerDir }
  );

  const smokeScriptPath = path.join(consumerDir, "smoke.mjs");
  await writeFile(
    smokeScriptPath,
    [
      `import { FluxerBot, FluxerClient, MockTransport } from ${JSON.stringify(packageName)};`,
      "",
      "const transport = new MockTransport();",
      "const client = new FluxerClient(transport);",
      'const bot = new FluxerBot({ name: "SmokeBot", prefix: "!" });',
      "",
      "bot.command({",
      '  name: "ping",',
      '  execute: async ({ reply }) => {',
      '    await reply("pong");',
      "  }",
      "});",
      "",
      "client.registerBot(bot);",
      "await client.connect();",
      "",
      "await transport.injectMessage({",
      '  id: "msg_1",',
      '  content: "!ping",',
      "  author: {",
      '    id: "user_1",',
      '    username: "fluxguy"',
      "  },",
      "  channel: {",
      '    id: "general",',
      '    name: "general",',
      '    type: "text"',
      "  },",
      "  createdAt: new Date()",
      "});",
      "",
      "const sentMessage = transport.sentMessages.at(-1);",
      'if (sentMessage?.content !== "pong") {',
      '  throw new Error(`Installed package smoke test failed. Expected "pong", received ${JSON.stringify(sentMessage)}.`);',
      "}",
      "",
      "await client.disconnect();"
    ].join("\n"),
    "utf8"
  );

  runCommand(processRef.execPath, [smokeScriptPath], {
    cwd: consumerDir
  });

  const platformSmokeScriptPath = path.join(consumerDir, "platform-smoke.mjs");
  await writeFile(
    platformSmokeScriptPath,
    [
      `import { FluxerBot, FluxerClient, createFluxerPlatformTransport } from ${JSON.stringify(packageName)};`,
      "",
      "class FakeWebSocket {",
      "  static CONNECTING = 0;",
      "  static OPEN = 1;",
      "  static CLOSING = 2;",
      "  static CLOSED = 3;",
      "",
      "  readyState = FakeWebSocket.CONNECTING;",
      "  sent = [];",
      "  #listeners = new Map();",
      "",
      "  addEventListener(type, listener) {",
      "    const listeners = this.#listeners.get(type) ?? [];",
      "    listeners.push(listener);",
      "    this.#listeners.set(type, listeners);",
      "  }",
      "",
      "  send(data) {",
      "    this.sent.push(data);",
      "  }",
      "",
      "  close() {",
      "    this.readyState = FakeWebSocket.CLOSED;",
      "    this.#emit('close');",
      "  }",
      "",
      "  emitOpen() {",
      "    this.readyState = FakeWebSocket.OPEN;",
      "    this.#emit('open');",
      "  }",
      "",
      "  emitMessage(data) {",
      "    this.#emit('message', { data: JSON.stringify(data) });",
      "  }",
      "",
      "  #emit(type, event) {",
      "    for (const listener of this.#listeners.get(type) ?? []) {",
      "      listener(event);",
      "    }",
      "  }",
      "}",
      "",
      "function jsonResponse(payload) {",
      "  return new Response(JSON.stringify(payload), {",
      "    status: 200,",
      "    headers: { 'content-type': 'application/json' }",
      "  });",
      "}",
      "",
      "function parseIdentifyPayload(socket) {",
      "  return socket.sent.map((payload) => JSON.parse(payload)).find((payload) => payload.op === 2);",
      "}",
      "",
      "async function flushAsyncWork() {",
      "  await new Promise((resolve) => setImmediate(resolve));",
      "}",
      "",
      "async function waitForCondition(predicate, message) {",
      "  const startedAt = Date.now();",
      "  while (!predicate()) {",
      "    if (Date.now() - startedAt >= 500) {",
      "      throw new Error(message);",
      "    }",
      "    await new Promise((resolve) => setTimeout(resolve, 1));",
      "  }",
      "}",
      "",
      "const discovery = {",
      "  api_code_version: 7,",
      "  endpoints: {",
      "    api: 'https://fluxer.local/api',",
      "    api_client: 'https://fluxer.local/client-api',",
      "    api_public: 'https://fluxer.local/public-api',",
      "    gateway: 'wss://fluxer.local/gateway',",
      "    media: 'https://fluxer.local/media',",
      "    static_cdn: 'https://fluxer.local/cdn',",
      "    marketing: 'https://fluxer.local',",
      "    admin: 'https://fluxer.local/admin',",
      "    invite: 'https://fluxer.local/invite',",
      "    gift: 'https://fluxer.local/gift',",
      "    webapp: 'https://fluxer.local/app'",
      "  },",
      "  features: { gateway_bot: true }",
      "};",
      "",
      "const gatewayInfo = {",
      "  url: 'wss://fluxer.local/gateway/bot',",
      "  shards: 1,",
      "  session_start_limit: {",
      "    total: 1000,",
      "    remaining: 999,",
      "    reset_after: 1000,",
      "    max_concurrency: 1",
      "  }",
      "};",
      "",
      "const sentRequests = [];",
      "let socket;",
      "",
      "const fetchImpl = async (input, init = {}) => {",
      "  const url = String(input);",
      "  const method = init.method ?? 'GET';",
      "",
      "  if (url.endsWith('/v1/gateway/bot') && method === 'GET') {",
      "    return jsonResponse(gatewayInfo);",
      "  }",
      "",
      "  if (url.endsWith('/v1/channels/general/messages') && method === 'POST') {",
      "    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;",
      "    sentRequests.push({ url, method, body });",
      "    return new Response(null, { status: 204 });",
      "  }",
      "",
      "  throw new Error(`Unexpected fetch during platform smoke: ${method} ${url}`);",
      "};",
      "",
      "const transport = await createFluxerPlatformTransport({",
      "  auth: { token: 'bot-token' },",
      "  instanceUrl: 'https://fluxer.local',",
      "  discovery,",
      "  intents: 513,",
      "  fetchImpl,",
      "  webSocketFactory: () => {",
      "    socket = new FakeWebSocket();",
      "    return socket;",
      "  }",
      "});",
      "",
      "const client = new FluxerClient(transport);",
      "const bot = new FluxerBot({ name: 'PlatformSmokeBot', prefix: '!' });",
      "let ready = false;",
      "",
      "bot.command({",
      "  name: 'ping',",
      "  execute: async ({ reply }) => {",
      "    await reply('pong');",
      "  }",
      "});",
      "",
      "client.on('ready', () => {",
      "  ready = true;",
      "});",
      "",
      "client.registerBot(bot);",
      "",
      "const connectPromise = client.connect();",
      "await flushAsyncWork();",
      "if (!socket) {",
      "  throw new Error('Platform smoke did not create a websocket.');",
      "}",
      "",
      "socket.emitOpen();",
      "await connectPromise;",
      "",
      "socket.emitMessage({",
      "  op: 10,",
      "  d: { heartbeat_interval: 1000 }",
      "});",
      "",
      "await waitForCondition(",
      "  () => parseIdentifyPayload(socket)?.d?.token === 'bot-token',",
      "  'Expected packaged platform smoke to send an identify payload.'",
      ");",
      "",
      "socket.emitMessage({",
      "  op: 0,",
      "  t: 'READY',",
      "  s: 1,",
      "  d: { session_id: 'session_1' }",
      "});",
      "",
      "await waitForCondition(",
      "  () => ready,",
      "  'Expected packaged platform smoke to emit a ready event.'",
      ");",
      "",
      "socket.emitMessage({",
      "  op: 0,",
      "  t: 'MESSAGE_CREATE',",
      "  s: 2,",
      "  d: {",
      "    id: 'msg_1',",
      "    content: '!ping',",
      "    author: {",
      "      id: 'user_1',",
      "      username: 'fluxguy'",
      "    },",
      "    channel_id: 'general',",
      "    timestamp: '2026-03-28T00:00:00.000Z'",
      "  }",
      "});",
      "",
      "await waitForCondition(",
      "  () => sentRequests.some((request) => request.body?.content === 'pong'),",
      "  'Expected packaged platform smoke to send a reply through the REST transport.'",
      ");",
      "",
      "await client.disconnect();",
      "",
      "if (socket.readyState !== FakeWebSocket.CLOSED) {",
      "  throw new Error('Expected packaged platform smoke to close the websocket on disconnect.');",
      "}",
      "",
      "if (!sentRequests.some((request) => request.url.endsWith('/v1/channels/general/messages'))) {",
      "  throw new Error('Expected packaged platform smoke to hit the channel message endpoint.');",
      "}"
    ].join("\n"),
    "utf8"
  );

  runCommand(processRef.execPath, [platformSmokeScriptPath], {
    cwd: consumerDir
  });

  const typeCheckConfigPath = path.join(consumerDir, "tsconfig.json");
  await writeFile(
    typeCheckConfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: true
        },
        include: ["smoke-types.ts"]
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const typeSmokeScriptPath = path.join(consumerDir, "smoke-types.ts");
  await writeFile(
    typeSmokeScriptPath,
    [
      `import {`,
      `  FluxerBot,`,
      `  FluxerClient,`,
      `  MockTransport,`,
      `  PlatformBootstrapError,`,
      `  createFluxerPlatformTransport`,
      `} from ${JSON.stringify(packageName)};`,
      `import type { FluxerInstanceInfo } from ${JSON.stringify(packageName)};`,
      "",
      "const transport = new MockTransport();",
      "const client = new FluxerClient(transport);",
      'const bot = new FluxerBot({ name: "TypeSmokeBot", prefix: "!" });',
      "",
      "bot.command({",
      '  name: "ping",',
      "  execute: async ({ reply }) => {",
      '    await reply("pong");',
      "  }",
      "});",
      "",
      "client.registerBot(bot);",
      "",
      "const platformTransportPromise = createFluxerPlatformTransport({",
      '  instanceUrl: "https://fluxer.example",',
      '  auth: { token: "token" },',
      "  onInstanceInfo: (instance: FluxerInstanceInfo) => {",
      "    void instance.capabilities;",
      "  }",
      "});",
      "",
      "void platformTransportPromise.catch((error: unknown) => {",
      "  if (error instanceof PlatformBootstrapError) {",
      "    void error.code;",
      "    void error.details;",
      "  }",
      "});"
    ].join("\n"),
    "utf8"
  );

  runCommand(processRef.execPath, [typeScriptCliPath, "--project", typeCheckConfigPath], {
    cwd: consumerDir
  });
} finally {
  if (typeof tarballPath === "string") {
    await unlink(tarballPath).catch(() => {});
  }

  await rm(tempRoot, {
    recursive: true,
    force: true
  });
}

function runCommand(command, args, options) {
  const { executable, commandArgs } = resolveCommand(command, args);
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error || result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const errorMessage = result.error ? `${result.error.message}\n` : "";
    const suffix = output ? `\n${output}` : "";
    throw new Error(
      `Command failed: ${executable} ${commandArgs.join(" ")}\n${errorMessage}${suffix}`.trim()
    );
  }

  return result.stdout.trim();
}

function resolveCommand(command, args) {
  if (command === "npm" && typeof processRef.env.npm_execpath === "string") {
    return {
      executable: processRef.execPath,
      commandArgs: [processRef.env.npm_execpath, ...args]
    };
  }

  if (processRef.platform === "win32" && command === "npm") {
    return {
      executable: processRef.env.ComSpec ?? "cmd.exe",
      commandArgs: ["/d", "/s", "/c", ["npm", ...args].map(quoteForWindowsCmd).join(" ")]
    };
  }

  return {
    executable: command,
    commandArgs: args
  };
}

function quoteForWindowsCmd(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}
