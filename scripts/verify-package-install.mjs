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
