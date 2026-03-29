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
  loadExampleEnvFiles,
  optionalEnv,
  parseIntegerEnv,
  requireWebSocketRuntime,
  requireEnv,
  sleep,
  writeReportIfConfigured as writeExampleReportIfConfigured
} from "./example-support.js";

type ContractStepStatus = "started" | "passed" | "failed";

interface ContractStepRecord {
  name: string;
  status: ContractStepStatus;
  timestamp: string;
  details?: Record<string, unknown>;
}

interface ContractRunReport {
  mode: "contract";
  startedAt: string;
  finishedAt?: string;
  status: "running" | "passed" | "failed";
  instanceUrl?: string;
  channelId?: string;
  keepAlive: boolean;
  listLimit: number;
  timeoutMs: number;
  reportPath?: string;
  currentUser?: {
    id: string;
    username: string;
  };
  probe?: {
    content: string;
    confirmedMessageId?: string;
  };
  steps: ContractStepRecord[];
  error?: {
    name: string;
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  };
}

let currentReport: ContractRunReport | undefined;

function printUsage(): void {
  console.error("Fluxer.JS live-instance contract harness");
  console.error("Required env:");
  console.error("- FLUXER_INSTANCE_URL");
  console.error("- FLUXER_TOKEN");
  console.error("- FLUXER_CONTRACT_CHANNEL_ID");
  console.error("Optional env:");
  console.error("- FLUXER_INTENTS (default: 513)");
  console.error("- FLUXER_CONTRACT_LIST_LIMIT (default: 10)");
  console.error("- FLUXER_CONTRACT_TIMEOUT_MS (default: 5000)");
  console.error("- FLUXER_CONTRACT_MESSAGE_PREFIX (default: Fluxer.JS live contract probe)");
  console.error("- FLUXER_KEEP_ALIVE=1 to keep the bot connected for a real !ping check after the contract probe");
  console.error("- FLUXER_CONTRACT_REPORT_PATH to write a JSON contract run report");
}

function printTroubleshootingHint(
  error: PlatformBootstrapError | GatewayTransportError | RestTransportError | Error
): void {
  if (error instanceof PlatformBootstrapError || error instanceof GatewayTransportError || error instanceof RestTransportError) {
    switch (error.code) {
      case "PLATFORM_DISCOVERY_FAILED":
        console.error("Hint: verify FLUXER_INSTANCE_URL and confirm the discovery document is reachable from this machine.");
        return;
      case "PLATFORM_GATEWAY_INFO_FAILED":
        console.error("Hint: discovery worked, but gateway bootstrap failed. Check token validity, API reachability, and instance gateway support.");
        return;
      case "INSTANCE_CAPABILITY_UNSUPPORTED":
        console.error("Hint: this instance does not advertise the capabilities required for the platform transport path. If you are targeting the official hosted Fluxer platform, use `npm run dev:hosted` instead.");
        return;
      case "REST_HTTP_ERROR":
        console.error("Hint: the outbound contract probe was rejected. Check channel access, bot permissions, and whether the channel ID is valid.");
        return;
      case "REST_REQUEST_FAILED":
        console.error("Hint: the outbound contract probe failed before a response. Check network reachability, DNS, TLS, or reverse-proxy behavior.");
        return;
      case "REST_RATE_LIMITED":
        console.error("Hint: the instance rate-limited the contract probe. Wait and retry, or reduce repeated probe runs.");
        return;
      case "REST_RESPONSE_INVALID":
        console.error("Hint: the instance responded, but the response shape did not match the expected contract for the current read path.");
        return;
      case "GATEWAY_RECONNECT_EXHAUSTED":
        console.error("Hint: the gateway connection could not recover. Check websocket reachability and whether the instance is closing bot sessions.");
        return;
      default:
        return;
    }
  }

  if (error.message.includes("Probe message was not observed")) {
    console.error("Hint: the send path may have succeeded but channel reads did not surface the new message in time. Check channel read permissions and listMessages behavior on this instance.");
  }
}

function printTypedError(error: PlatformBootstrapError | GatewayTransportError | RestTransportError): void {
  console.error(`[contract] ${error.code}`);
  if (error.details) {
    console.error(error.details);
  }
}

function recordStep(
  report: ContractRunReport,
  name: string,
  status: ContractStepStatus,
  details?: Record<string, unknown>
): void {
  report.steps.push({
    name,
    status,
    timestamp: new Date().toISOString(),
    details
  });
}

function createRunReport(options: {
  instanceUrl?: string;
  channelId?: string;
  keepAlive: boolean;
  listLimit: number;
  timeoutMs: number;
  reportPath?: string;
}): ContractRunReport {
  return {
    mode: "contract",
    startedAt: new Date().toISOString(),
    status: "running",
    instanceUrl: options.instanceUrl,
    channelId: options.channelId,
    keepAlive: options.keepAlive,
    listLimit: options.listLimit,
    timeoutMs: options.timeoutMs,
    reportPath: options.reportPath,
    steps: []
  };
}

function createErrorRecord(
  error: PlatformBootstrapError | GatewayTransportError | RestTransportError | Error
): ContractRunReport["error"] {
  if (error instanceof PlatformBootstrapError || error instanceof GatewayTransportError || error instanceof RestTransportError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      details: error.details
    };
  }

  return {
    name: error.name,
    message: error.message
  };
}

async function waitForProbeEcho(options: {
  client: FluxerClient;
  channelId: string;
  probeContent: string;
  currentUserId: string;
  limit: number;
  timeoutMs: number;
}): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.timeoutMs) {
    const messages = await options.client.listMessages(options.channelId, {
      limit: options.limit
    });

    const match = messages.find((message) =>
      message.content === options.probeContent
      && message.author.id === options.currentUserId
    );

    if (match) {
      console.log(`Probe confirmed in channel history: ${match.id}`);
      return match.id;
    }

    await sleep(500);
  }

  throw new Error("Probe message was not observed in recent channel history before the contract timeout expired.");
}

async function main(): Promise<void> {
  const loadedEnvFiles = loadExampleEnvFiles();
  const instanceUrl = requireEnv("FLUXER_INSTANCE_URL");
  const token = requireEnv("FLUXER_TOKEN");
  const channelId = requireEnv("FLUXER_CONTRACT_CHANNEL_ID");
  const intents = parseIntegerEnv(process.env.FLUXER_INTENTS, 513, {
    name: "FLUXER_INTENTS",
    minimum: 0,
    descriptor: "a non-negative integer"
  });
  const listLimit = parseIntegerEnv(process.env.FLUXER_CONTRACT_LIST_LIMIT, 10, {
    name: "FLUXER_CONTRACT_LIST_LIMIT",
    minimum: 1,
    descriptor: "a positive integer"
  });
  const timeoutMs = parseIntegerEnv(process.env.FLUXER_CONTRACT_TIMEOUT_MS, 5000, {
    name: "FLUXER_CONTRACT_TIMEOUT_MS",
    minimum: 1,
    descriptor: "a positive integer"
  });
  const keepAlive = process.env.FLUXER_KEEP_ALIVE === "1";
  const probePrefix = optionalEnv("FLUXER_CONTRACT_MESSAGE_PREFIX") ?? "Fluxer.JS live contract probe";
  const reportPath = optionalEnv("FLUXER_CONTRACT_REPORT_PATH");
  requireWebSocketRuntime("Live contract harness");
  const report = createRunReport({
    instanceUrl,
    channelId,
    keepAlive,
    listLimit,
    timeoutMs,
    reportPath
  });
  currentReport = report;

  if (loadedEnvFiles.length > 0) {
    console.log(`Loaded env files: ${loadedEnvFiles.join(", ")}`);
  }

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
    name: "LiveContractBot",
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
      printTypedError(error);
      printTroubleshootingHint(error);
      return;
    }

    console.error(error);
  });

  client.registerBot(bot);
  recordStep(report, "connect", "started");
  await client.connect();
  recordStep(report, "connect", "passed");

  recordStep(report, "fetch_current_user", "started");
  const currentUser = await client.fetchCurrentUser();
  report.currentUser = {
    id: currentUser.id,
    username: currentUser.username
  };
  recordStep(report, "fetch_current_user", "passed", {
    userId: currentUser.id,
    username: currentUser.username
  });
  console.log(`Current user: ${currentUser.username} (${currentUser.id})`);

  recordStep(report, "fetch_channel", "started", {
    channelId
  });
  const channel = await client.fetchChannel(channelId);
  recordStep(report, "fetch_channel", "passed", {
    channelId: channel.id,
    channelName: channel.name,
    channelType: channel.type
  });
  console.log(`Contract channel: ${channel.name} (${channel.id})`);

  recordStep(report, "indicate_typing", "started", {
    channelId
  });
  await client.indicateTyping(channelId);
  recordStep(report, "indicate_typing", "passed", {
    channelId
  });
  console.log("Typing indicator sent.");

  const probeContent = `${probePrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  report.probe = {
    content: probeContent
  };
  console.log(`Sending contract probe: ${probeContent}`);
  recordStep(report, "send_probe", "started", {
    channelId,
    probeContent
  });
  await client.sendMessage(channelId, probeContent);
  recordStep(report, "send_probe", "passed", {
    channelId,
    probeContent
  });

  recordStep(report, "confirm_probe", "started", {
    channelId,
    listLimit,
    timeoutMs
  });
  const confirmedMessageId = await waitForProbeEcho({
    client,
    channelId,
    probeContent,
    currentUserId: currentUser.id,
    limit: listLimit,
    timeoutMs
  });
  report.probe.confirmedMessageId = confirmedMessageId;
  recordStep(report, "confirm_probe", "passed", {
    confirmedMessageId
  });

  console.log("Live contract harness passed.");
  report.status = "passed";
  report.finishedAt = new Date().toISOString();

  if (keepAlive) {
    recordStep(report, "keep_alive", "passed");
    await writeExampleReportIfConfigured(report, "Live contract");
    console.log("The bot is staying connected.");
    console.log("Next step: send `!ping` in the contract channel and verify that the bot replies with `pong`.");
    return;
  }

  console.log("Disconnecting after the contract probe.");
  recordStep(report, "disconnect", "started");
  await client.disconnect();
  recordStep(report, "disconnect", "passed");
  await writeExampleReportIfConfigured(report, "Live contract");
}

main().catch(async (error) => {
  if (error instanceof PlatformBootstrapError || error instanceof GatewayTransportError || error instanceof RestTransportError) {
    if (currentReport) {
      currentReport.status = "failed";
      currentReport.finishedAt = new Date().toISOString();
      currentReport.error = createErrorRecord(error);
      recordStep(currentReport, "failed", "failed", {
        code: error.code
      });
      await writeExampleReportIfConfigured(currentReport, "Live contract");
    }
    printTypedError(error);
    printTroubleshootingHint(error);
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    if (currentReport) {
      currentReport.status = "failed";
      currentReport.finishedAt = new Date().toISOString();
      currentReport.error = createErrorRecord(error);
      recordStep(currentReport, "failed", "failed", {
        message: error.message
      });
      await writeExampleReportIfConfigured(currentReport, "Live contract");
    }
    console.error(error.message);
    printTroubleshootingHint(error);
    printUsage();
    process.exitCode = 1;
    return;
  }

  console.error("Unknown live-instance contract failure.");
  process.exitCode = 1;
});
