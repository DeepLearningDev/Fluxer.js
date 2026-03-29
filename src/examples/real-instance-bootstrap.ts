import process from "node:process";
import {
  FluxerBot,
  FluxerClient,
  PlatformBootstrapError,
  createFluxerPlatformTransport
} from "../index.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function parseIntents(value: string | undefined): number {
  if (!value || value.trim().length === 0) {
    return 513;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("FLUXER_INTENTS must be a non-negative integer.");
  }

  return parsed;
}

function printUsage(): void {
  console.error("Fluxer.JS real-instance bootstrap smoke");
  console.error("Required env:");
  console.error("- FLUXER_INSTANCE_URL");
  console.error("- FLUXER_TOKEN");
  console.error("Optional env:");
  console.error("- FLUXER_INTENTS (default: 513)");
  console.error("- FLUXER_KEEP_ALIVE=1 to keep the bot connected after ready");
}

async function main(): Promise<void> {
  const instanceUrl = requireEnv("FLUXER_INSTANCE_URL");
  const token = requireEnv("FLUXER_TOKEN");
  const intents = parseIntents(process.env.FLUXER_INTENTS);
  const keepAlive = process.env.FLUXER_KEEP_ALIVE === "1";

  const transport = await createFluxerPlatformTransport({
    instanceUrl,
    auth: { token },
    intents,
    debug: (event) => {
      if (
        event.event === "instance_detected"
        || event.event === "platform_transport_bootstrapped"
        || event.event === "gateway_state_changed"
      ) {
        console.log(`[debug] ${event.event}`, event.data ?? {});
      }
    }
  });

  const client = new FluxerClient(transport);
  const bot = new FluxerBot({
    name: "BootstrapSmokeBot",
    prefix: "!"
  });

  bot.command({
    name: "ping",
    description: "Reply with pong.",
    execute: async ({ reply }) => {
      await reply("pong");
    }
  });

  client.on("ready", ({ connectedAt }) => {
    console.log(`Connected at ${connectedAt.toISOString()}`);
  });

  client.on("gatewayStateChange", ({ state }) => {
    console.log(`Gateway state: ${state}`);
  });

  client.registerBot(bot);
  await client.connect();

  const currentUser = await client.fetchCurrentUser();
  console.log(`Current user: ${currentUser.username} (${currentUser.id})`);

  if (keepAlive) {
    console.log("Bootstrap succeeded. Keeping the bot connected.");
    return;
  }

  console.log("Bootstrap succeeded. Disconnecting after the smoke check.");
  await client.disconnect();
}

main().catch(async (error) => {
  if (error instanceof PlatformBootstrapError) {
    console.error(`Platform bootstrap failed: ${error.code}`);
    console.error(error.details ?? {});
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
    return;
  }

  console.error("Unknown real-instance bootstrap failure.");
  process.exitCode = 1;
});
