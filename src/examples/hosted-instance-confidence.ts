import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import {
  DiscoveryError,
  FluxerClient,
  GatewayTransport,
  GatewayTransportError,
  PlatformTransport,
  RestTransport,
  RestTransportError,
  createInstanceInfo,
  defaultParseDispatchEvent,
  defaultParseMessageEvent,
  fetchInstanceDiscoveryDocument
} from "../index.js";

type ConfidenceStepStatus = "started" | "passed" | "failed";

interface ConfidenceStepRecord {
  name: string;
  status: ConfidenceStepStatus;
  timestamp: string;
  details?: Record<string, unknown>;
}

interface HostedConfidenceReport {
  mode: "hosted-confidence";
  startedAt: string;
  finishedAt?: string;
  status: "running" | "passed" | "failed";
  instanceUrl?: string;
  channelId?: string;
  listLimit: number;
  timeoutMs: number;
  reportPath?: string;
  currentUser?: {
    id: string;
    username: string;
  };
  fetchedUser?: {
    id: string;
    username: string;
  };
  channel?: {
    id: string;
    name: string;
    type: string;
  };
  instance?: {
    apiBaseUrl?: string;
    gatewayUrl?: string;
    apiCodeVersion?: number;
    isSelfHosted?: boolean;
    capabilities: string[];
  };
  probe?: {
    content: string;
    confirmedMessageId?: string;
    fetchedMessageId?: string;
    fetchedMessageContent?: string;
    editedContent?: string;
    editedMessageId?: string;
    fetchedEditedMessageId?: string;
    fetchedEditedMessageContent?: string;
    deletedMessageId?: string;
    deletedFetchCode?: string;
    deletedFetchStatus?: number;
    deletedHistoryAbsent?: boolean;
  };
  steps: ConfidenceStepRecord[];
  error?: {
    name: string;
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  };
}

let currentReport: HostedConfidenceReport | undefined;

function loadEnvFiles(): string[] {
  const candidates = [
    ".env.contract.local",
    ".env.contract",
    ".env.local",
    ".env"
  ];
  const loaded: string[] = [];

  for (const candidate of candidates) {
    const fullPath = path.resolve(process.cwd(), candidate);
    if (!existsSync(fullPath)) {
      continue;
    }

    const fileContent = readFileSync(fullPath, "utf8");
    for (const line of fileContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = normalizeEnvValue(rawValue);
    }

    loaded.push(candidate);
  }

  return loaded;
}

function normalizeEnvValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

function optionalEnvFromNames(names: string[]): string | undefined {
  for (const name of names) {
    const value = optionalEnv(name);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printUsage(): void {
  console.error("Fluxer.JS hosted-instance confidence path");
  console.error("Required env:");
  console.error("- FLUXER_INSTANCE_URL");
  console.error("- FLUXER_TOKEN");
  console.error("- FLUXER_CONTRACT_CHANNEL_ID");
  console.error("Optional env:");
  console.error("- FLUXER_HOSTED_LIST_LIMIT or FLUXER_CONTRACT_LIST_LIMIT (default: 10)");
  console.error("- FLUXER_HOSTED_TIMEOUT_MS or FLUXER_CONTRACT_TIMEOUT_MS (default: 5000)");
  console.error("- FLUXER_HOSTED_MESSAGE_PREFIX or FLUXER_CONTRACT_MESSAGE_PREFIX");
  console.error("- FLUXER_HOSTED_REPORT_PATH or FLUXER_CONTRACT_REPORT_PATH");
}

function printTroubleshootingHint(error: DiscoveryError | GatewayTransportError | RestTransportError | Error): void {
  if (error instanceof DiscoveryError || error instanceof GatewayTransportError || error instanceof RestTransportError) {
    switch (error.code) {
      case "DISCOVERY_REQUEST_FAILED":
      case "DISCOVERY_HTTP_ERROR":
      case "DISCOVERY_RESPONSE_INVALID":
        console.error("Hint: verify FLUXER_INSTANCE_URL and confirm the discovery document is reachable from this machine.");
        return;
      case "GATEWAY_SOCKET_ERROR":
      case "GATEWAY_RECONNECT_EXHAUSTED":
      case "GATEWAY_IDENTIFY_UNAVAILABLE":
        console.error("Hint: the hosted path now starts a gateway session before sending messages. Check websocket reachability, token validity, and whether the hosted gateway accepted the identify payload.");
        return;
      case "REST_HTTP_ERROR":
        console.error("Hint: the hosted confidence probe was rejected. Check channel access, token validity, and whether the channel ID is correct.");
        return;
      case "REST_REQUEST_FAILED":
        console.error("Hint: the hosted confidence request failed before a response. Check network reachability, DNS, TLS, or reverse-proxy behavior.");
        return;
      case "REST_RATE_LIMITED":
        console.error("Hint: the instance rate-limited the hosted confidence probe. Wait and retry, or reduce repeated probe runs.");
        return;
      case "REST_RESPONSE_INVALID":
        console.error("Hint: the hosted platform responded, but the response shape did not match the expected read/write contract.");
        return;
      default:
        return;
    }
  }

  if (error.message.includes("Probe message was not observed")) {
    console.error("Hint: the send path may have succeeded but channel reads did not surface the new message in time. Check channel read permissions and listMessages behavior on this instance.");
  }
}

function printTypedError(error: DiscoveryError | GatewayTransportError | RestTransportError): void {
  console.error(`[hosted] ${error.code}`);
  if (error.details) {
    console.error(error.details);
  }
}

function recordStep(
  report: HostedConfidenceReport,
  name: string,
  status: ConfidenceStepStatus,
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
  listLimit: number;
  timeoutMs: number;
  reportPath?: string;
}): HostedConfidenceReport {
  return {
    mode: "hosted-confidence",
    startedAt: new Date().toISOString(),
    status: "running",
    instanceUrl: options.instanceUrl,
    channelId: options.channelId,
    listLimit: options.listLimit,
    timeoutMs: options.timeoutMs,
    reportPath: options.reportPath,
    steps: []
  };
}

function createErrorRecord(error: DiscoveryError | GatewayTransportError | RestTransportError | Error): HostedConfidenceReport["error"] {
  if (error instanceof DiscoveryError || error instanceof GatewayTransportError || error instanceof RestTransportError) {
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

async function writeReportIfConfigured(report: HostedConfidenceReport): Promise<void> {
  if (!report.reportPath) {
    return;
  }

  const outputPath = path.resolve(process.cwd(), report.reportPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`Hosted confidence report written to ${outputPath}`);
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

  throw new Error("Probe message was not observed in recent channel history before the hosted confidence timeout expired.");
}

async function waitForGatewayReady(client: FluxerClient, timeoutMs: number): Promise<void> {
  const readyPromise = client.waitFor("gatewayStateChange", {
    timeoutMs,
    filter: ({ state }) => state === "ready"
  });
  const failedStatePromise = client.waitFor("gatewayStateChange", {
    timeoutMs,
    filter: ({ state }) => state === "reconnecting" || state === "disconnected"
  }).then(({ state, reason }) => {
    throw new Error(`Gateway left the session-start path before reaching ready. State=${state}${reason ? ` reason=${reason}` : ""}`);
  });

  await Promise.race([readyPromise, failedStatePromise]);
}

function listEnabledCapabilities(capabilities: object): string[] {
  return Object.entries(capabilities as Record<string, boolean>)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

function resolveHostedGatewayUrl(baseUrl: string, apiCodeVersion: number): string {
  const url = new URL(baseUrl);

  if (!url.searchParams.has("v")) {
    url.searchParams.set("v", String(apiCodeVersion));
  }

  return url.toString();
}

async function main(): Promise<void> {
  const loadedEnvFiles = loadEnvFiles();
  const instanceUrl = requireEnv("FLUXER_INSTANCE_URL");
  const token = requireEnv("FLUXER_TOKEN");
  const channelId = requireEnv("FLUXER_CONTRACT_CHANNEL_ID");
  const listLimit = parsePositiveInt(
    optionalEnvFromNames(["FLUXER_HOSTED_LIST_LIMIT", "FLUXER_CONTRACT_LIST_LIMIT"]),
    10,
    "FLUXER_HOSTED_LIST_LIMIT"
  );
  const timeoutMs = parsePositiveInt(
    optionalEnvFromNames(["FLUXER_HOSTED_TIMEOUT_MS", "FLUXER_CONTRACT_TIMEOUT_MS"]),
    5000,
    "FLUXER_HOSTED_TIMEOUT_MS"
  );
  const probePrefix = optionalEnvFromNames(["FLUXER_HOSTED_MESSAGE_PREFIX", "FLUXER_CONTRACT_MESSAGE_PREFIX"])
    ?? "Fluxer.JS hosted confidence probe";
  const reportPath = optionalEnvFromNames(["FLUXER_HOSTED_REPORT_PATH", "FLUXER_CONTRACT_REPORT_PATH"]);
  const report = createRunReport({
    instanceUrl,
    channelId,
    listLimit,
    timeoutMs,
    reportPath
  });
  currentReport = report;

  if (loadedEnvFiles.length > 0) {
    console.log(`Loaded env files: ${loadedEnvFiles.join(", ")}`);
  }

  recordStep(report, "discover_instance", "started", {
    instanceUrl
  });
  const discovery = await fetchInstanceDiscoveryDocument({
    instanceUrl
  });
  const instanceInfo = createInstanceInfo({
    instanceUrl,
    discovery
  });
  report.instance = {
    apiBaseUrl: instanceInfo.apiBaseUrl,
    gatewayUrl: instanceInfo.gatewayBaseUrl,
    apiCodeVersion: instanceInfo.apiCodeVersion,
    isSelfHosted: instanceInfo.isSelfHosted,
    capabilities: listEnabledCapabilities(instanceInfo.capabilities)
  };
  recordStep(report, "discover_instance", "passed", {
    apiBaseUrl: instanceInfo.apiBaseUrl,
    isSelfHosted: instanceInfo.isSelfHosted,
    capabilities: report.instance.capabilities
  });
  console.log("[debug] instance_detected", {
    instanceUrl: instanceInfo.instanceUrl,
    apiBaseUrl: instanceInfo.apiBaseUrl,
    apiCodeVersion: instanceInfo.apiCodeVersion,
    isSelfHosted: instanceInfo.isSelfHosted,
    capabilities: report.instance.capabilities
  });

  if (instanceInfo.capabilities.gatewayBot) {
    console.log("This instance advertises gatewayBot. For the stronger bot-runtime path, prefer `npm run dev:contract`.");
  } else {
    console.log("This instance does not advertise gatewayBot. Running the hosted REST confidence path.");
  }

  if (!instanceInfo.gatewayBaseUrl) {
    throw new Error("Hosted confidence requires a gateway endpoint so the platform can start a session before sending messages.");
  }
  const gatewayUrl = resolveHostedGatewayUrl(instanceInfo.gatewayBaseUrl, instanceInfo.apiCodeVersion);

  const transport = new PlatformTransport({
    inbound: new GatewayTransport({
      url: gatewayUrl,
      auth: { token },
      reconnect: {
        maxAttempts: 0
      },
      buildIdentifyPayload: ({ auth }) => ({
        op: 2,
        d: {
          token: auth?.token,
          intents: 0,
          properties: {
            os: process.platform,
            browser: "fluxer-js",
            device: "fluxer-js"
          }
        }
      }),
      parseDispatchEvent: defaultParseDispatchEvent,
      parseMessageEvent: defaultParseMessageEvent
    }),
    outbound: new RestTransport({
      discovery,
      auth: { token }
    })
  });
  const client = new FluxerClient(transport);

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

  recordStep(report, "connect_hosted_session", "started");
  const gatewayReady = waitForGatewayReady(client, timeoutMs);
  await client.connect();
  await gatewayReady;
  recordStep(report, "connect_hosted_session", "passed", {
    gatewayUrl
  });

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

  recordStep(report, "fetch_user_by_id", "started", {
    userId: currentUser.id
  });
  const fetchedUser = await client.fetchUser(currentUser.id);
  if (fetchedUser.id !== currentUser.id) {
    throw new Error("Fetched user did not match the current bot identity.");
  }
  report.fetchedUser = {
    id: fetchedUser.id,
    username: fetchedUser.username
  };
  recordStep(report, "fetch_user_by_id", "passed", {
    userId: fetchedUser.id,
    username: fetchedUser.username
  });
  console.log(`Fetched user by id: ${fetchedUser.username} (${fetchedUser.id})`);

  recordStep(report, "fetch_channel", "started", {
    channelId
  });
  const channel = await client.fetchChannel(channelId);
  report.channel = {
    id: channel.id,
    name: channel.name,
    type: channel.type
  };
  recordStep(report, "fetch_channel", "passed", {
    channelId: channel.id,
    channelName: channel.name,
    channelType: channel.type
  });
  console.log(`Hosted confidence channel: ${channel.name} (${channel.id})`);

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
  console.log(`Sending hosted confidence probe: ${probeContent}`);
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

  recordStep(report, "fetch_confirmed_probe", "started", {
    channelId,
    messageId: confirmedMessageId
  });
  const fetchedMessage = await client.fetchMessage(channelId, confirmedMessageId);
  report.probe.fetchedMessageId = fetchedMessage.id;
  report.probe.fetchedMessageContent = fetchedMessage.content;
  recordStep(report, "fetch_confirmed_probe", "passed", {
    messageId: fetchedMessage.id
  });
  console.log(`Fetched confirmed probe directly: ${fetchedMessage.id}`);

  const editedProbeContent = `${probeContent} [edited]`;
  recordStep(report, "edit_probe", "started", {
    channelId,
    messageId: confirmedMessageId
  });
  const editedMessage = await client.editMessage(channelId, confirmedMessageId, editedProbeContent);
  report.probe.editedContent = editedProbeContent;
  report.probe.editedMessageId = editedMessage.id;
  recordStep(report, "edit_probe", "passed", {
    messageId: editedMessage.id
  });
  console.log(`Edited confirmed probe: ${editedMessage.id}`);

  recordStep(report, "fetch_edited_probe", "started", {
    channelId,
    messageId: confirmedMessageId
  });
  const fetchedEditedMessage = await client.fetchMessage(channelId, confirmedMessageId);
  if (fetchedEditedMessage.content !== editedProbeContent) {
    throw new Error("Edited probe content did not match the expected fetched content.");
  }
  report.probe.fetchedEditedMessageId = fetchedEditedMessage.id;
  report.probe.fetchedEditedMessageContent = fetchedEditedMessage.content;
  recordStep(report, "fetch_edited_probe", "passed", {
    messageId: fetchedEditedMessage.id
  });
  console.log(`Fetched edited probe directly: ${fetchedEditedMessage.id}`);

  recordStep(report, "delete_probe", "started", {
    channelId,
    messageId: confirmedMessageId
  });
  await client.deleteMessage(channelId, confirmedMessageId);
  report.probe.deletedMessageId = confirmedMessageId;
  recordStep(report, "delete_probe", "passed", {
    messageId: confirmedMessageId
  });
  console.log(`Deleted confirmed probe: ${confirmedMessageId}`);

  recordStep(report, "confirm_probe_deleted", "started", {
    channelId,
    messageId: confirmedMessageId
  });
  try {
    await client.fetchMessage(channelId, confirmedMessageId);
    throw new Error("Deleted probe was still fetchable after deleteMessage completed.");
  } catch (error) {
    if (!(error instanceof RestTransportError) || error.code !== "REST_HTTP_ERROR" || error.status !== 404) {
      throw error;
    }

    report.probe.deletedFetchCode = error.code;
    report.probe.deletedFetchStatus = error.status;
    recordStep(report, "confirm_probe_deleted", "passed", {
      code: error.code,
      status: error.status
    });
    console.log(`Confirmed deleted probe is no longer fetchable: ${error.code} (${error.status})`);
  }

  recordStep(report, "confirm_probe_deleted_from_history", "started", {
    channelId,
    limit: listLimit
  });
  const recentMessagesAfterDelete = await client.listMessages(channelId, {
    limit: listLimit
  });
  const deletedMessageStillPresent = recentMessagesAfterDelete.some((message) =>
    message.id === confirmedMessageId
    || (message.author.id === currentUser.id
      && (message.content === probeContent || message.content === editedProbeContent))
  );
  if (deletedMessageStillPresent) {
    throw new Error("Deleted probe was still present in recent channel history after deleteMessage completed.");
  }
  report.probe.deletedHistoryAbsent = true;
  recordStep(report, "confirm_probe_deleted_from_history", "passed", {
    count: recentMessagesAfterDelete.length
  });
  console.log("Confirmed deleted probe is absent from recent channel history.");

  recordStep(report, "disconnect", "started");
  await client.disconnect();
  recordStep(report, "disconnect", "passed");
  report.status = "passed";
  report.finishedAt = new Date().toISOString();
  await writeReportIfConfigured(report);
  console.log("Hosted confidence path passed.");
}

main().catch(async (error) => {
  if (error instanceof DiscoveryError || error instanceof GatewayTransportError || error instanceof RestTransportError) {
    if (currentReport) {
      currentReport.status = "failed";
      currentReport.finishedAt = new Date().toISOString();
      currentReport.error = createErrorRecord(error);
      recordStep(currentReport, "failed", "failed", {
        code: error.code
      });
      await writeReportIfConfigured(currentReport);
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
      await writeReportIfConfigured(currentReport);
    }
    console.error(error.message);
    printTroubleshootingHint(error);
    printUsage();
    process.exitCode = 1;
    return;
  }

  console.error("Unknown hosted confidence failure.");
  process.exitCode = 1;
});
