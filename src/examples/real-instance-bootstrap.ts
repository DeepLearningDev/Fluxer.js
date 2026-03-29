import process from "node:process";
import {
  FluxerBot,
  FluxerClient,
  GatewayTransportError,
  PlatformBootstrapError,
  RestTransportError,
  createFluxerPlatformTransport
} from "../index.js";
import {
  optionalEnv,
  parseIntegerEnv,
  requireWebSocketRuntime,
  requireEnv
} from "./example-support.js";

function printUsage(): void {
  console.error("Fluxer.JS real-instance bootstrap smoke");
  console.error("Required env:");
  console.error("- FLUXER_INSTANCE_URL");
  console.error("- FLUXER_TOKEN");
  console.error("Optional env:");
  console.error("- FLUXER_INTENTS (default: 513)");
  console.error("- FLUXER_KEEP_ALIVE=1 to keep the bot connected after ready");
  console.error("- FLUXER_BOOTSTRAP_CHANNEL_ID to send a startup message into a real text channel");
}

function printRuntimeError(error: GatewayTransportError | RestTransportError): void {
  console.error(`[runtime] ${error.code}`);
  if (error.details) {
    console.error(error.details);
  }
}

function printTroubleshootingHint(
  error: PlatformBootstrapError | GatewayTransportError | RestTransportError
): void {
  switch (error.code) {
    case "PLATFORM_DISCOVERY_FAILED":
      console.error("Hint: verify FLUXER_INSTANCE_URL and confirm the discovery document is reachable from this machine.");
      return;
    case "PLATFORM_GATEWAY_INFO_FAILED":
      console.error("Hint: discovery worked, but gateway bootstrap failed. Check token validity, API reachability, and instance gateway support.");
      return;
    case "INSTANCE_CAPABILITY_UNSUPPORTED":
      console.error("Hint: this instance does not advertise the capabilities needed for platform transport bootstrap. If you are targeting the official hosted Fluxer platform, use `npm run dev:hosted` instead.");
      return;
    case "REST_HTTP_ERROR":
      console.error("Hint: the bootstrap connected, but the outbound REST call was rejected. Check channel access, bot permissions, and payload validity.");
      return;
    case "REST_REQUEST_FAILED":
      console.error("Hint: the outbound REST call failed before a response. Check network reachability, DNS, TLS, or reverse-proxy behavior.");
      return;
    case "REST_RATE_LIMITED":
      console.error("Hint: the instance rate-limited the outbound bootstrap message. Wait and retry, or reduce repeated startup sends.");
      return;
    case "GATEWAY_RECONNECT_EXHAUSTED":
      console.error("Hint: the gateway connection could not recover. Check websocket reachability and whether the instance is closing bot sessions.");
      return;
    default:
      return;
  }
}

function printNextSteps(options: {
  instanceUrl: string;
  currentUsername: string;
  keepAlive: boolean;
  bootstrapChannelId?: string;
}): void {
  console.log(`Instance: ${options.instanceUrl}`);
  console.log(`Bot identity: ${options.currentUsername}`);

  if (options.bootstrapChannelId) {
    console.log(`Startup message target: ${options.bootstrapChannelId}`);
  }

  if (options.keepAlive) {
    console.log("The bot is staying connected.");
    console.log("Next step: send `!ping` in a text channel the bot can read and verify that it replies with `pong`.");
    if (!options.bootstrapChannelId) {
      console.log("Optional: set FLUXER_BOOTSTRAP_CHANNEL_ID next time to send a startup message into a known channel.");
    }
    return;
  }

  console.log("The smoke path succeeded and the bot will now disconnect.");
  console.log("Next step: rerun with FLUXER_KEEP_ALIVE=1 and send `!ping` in a real channel to verify live replies.");
}

async function main(): Promise<void> {
  const instanceUrl = requireEnv("FLUXER_INSTANCE_URL");
  const token = requireEnv("FLUXER_TOKEN");
  const intents = parseIntegerEnv(process.env.FLUXER_INTENTS, 513, {
    name: "FLUXER_INTENTS",
    minimum: 0,
    descriptor: "a non-negative integer"
  });
  const keepAlive = process.env.FLUXER_KEEP_ALIVE === "1";
  const bootstrapChannelId = optionalEnv("FLUXER_BOOTSTRAP_CHANNEL_ID");
  requireWebSocketRuntime("Real-instance bootstrap");

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

  client.on("error", (error) => {
    if (error instanceof GatewayTransportError || error instanceof RestTransportError) {
      printRuntimeError(error);
      printTroubleshootingHint(error);
      return;
    }

    console.error(error);
  });

  client.registerBot(bot);
  await client.connect();

  const currentUser = await client.fetchCurrentUser();
  console.log(`Current user: ${currentUser.username} (${currentUser.id})`);

  if (bootstrapChannelId) {
    console.log(`Sending startup message to channel ${bootstrapChannelId}...`);
    await client.sendMessage(
      bootstrapChannelId,
      "BootstrapSmokeBot is online. Send !ping to verify real replies."
    );
    console.log("Startup message sent.");
  }

  if (keepAlive) {
    printNextSteps({
      instanceUrl,
      currentUsername: currentUser.username,
      keepAlive,
      bootstrapChannelId
    });
    return;
  }

  printNextSteps({
    instanceUrl,
    currentUsername: currentUser.username,
    keepAlive,
    bootstrapChannelId
  });
  await client.disconnect();
}

main().catch(async (error) => {
  if (error instanceof PlatformBootstrapError) {
    console.error(`Platform bootstrap failed: ${error.code}`);
    console.error(error.details ?? {});
    printTroubleshootingHint(error);
    process.exitCode = 1;
    return;
  }

  if (error instanceof RestTransportError || error instanceof GatewayTransportError) {
    printRuntimeError(error);
    printTroubleshootingHint(error);
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
