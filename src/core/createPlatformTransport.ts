import { fetchGatewayInformation, fetchInstanceDiscoveryDocument } from "./Discovery.js";
import { GatewayProtocolError, PlatformBootstrapError } from "./errors.js";
import { GatewayTransport } from "./GatewayTransport.js";
import { createInstanceInfo } from "./Instance.js";
import { PlatformTransport } from "./PlatformTransport.js";
import { RestTransport } from "./RestTransport.js";
import type {
  FluxerAuth,
  FluxerDebugHandler,
  FluxerGatewayDispatchEvent,
  FluxerGatewayEnvelope,
  FluxerInstanceDiscoveryDocument,
  FluxerInstanceInfo,
  FluxerGatewayTransportOptions,
  FluxerMessage,
  FluxerTransport
} from "./types.js";

export interface CreateFluxerPlatformTransportOptions {
  auth: FluxerAuth;
  instanceUrl?: string;
  discovery?: FluxerInstanceDiscoveryDocument;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  protocols?: string | string[];
  identifyPayload?: unknown;
  debug?: FluxerDebugHandler;
  onInstanceInfo?: (instance: FluxerInstanceInfo) => void;
  intents?: number;
  shard?: [number, number];
  properties?: Record<string, string>;
  presence?: Record<string, unknown>;
  webSocketFactory?: (url: string, protocols?: string | string[]) => WebSocket;
  parseMessageEvent?: FluxerGatewayTransportOptions["parseMessageEvent"];
}

export async function createFluxerPlatformTransport(
  options: CreateFluxerPlatformTransportOptions
): Promise<FluxerTransport> {
  const discovery = options.discovery ?? await fetchDiscoveryForPlatformTransport(options);
  const instanceInfo = createInstanceInfo({
    instanceUrl: options.instanceUrl ?? discovery.endpoints.api,
    discovery
  });
  options.onInstanceInfo?.(instanceInfo);
  options.debug?.({
    scope: "transport",
    event: "instance_detected",
    level: "info",
    timestamp: new Date().toISOString(),
    data: {
      instanceUrl: instanceInfo.instanceUrl,
      apiBaseUrl: instanceInfo.apiBaseUrl,
      apiCodeVersion: instanceInfo.apiCodeVersion,
      isSelfHosted: instanceInfo.isSelfHosted,
      capabilities: listEnabledCapabilities(instanceInfo)
    }
  });

  assertPlatformTransportCapabilities(instanceInfo, options.debug);

  const gateway = await fetchGatewayInfoForPlatformTransport(instanceInfo, options);

  options.debug?.({
    scope: "transport",
    event: "platform_transport_bootstrapped",
    level: "info",
    timestamp: new Date().toISOString(),
    data: {
      instanceUrl: instanceInfo.instanceUrl,
      apiBaseUrl: instanceInfo.apiBaseUrl,
      gatewayUrl: gateway.url
    }
  });

  return new PlatformTransport({
    inbound: new GatewayTransport({
      url: gateway.url,
      apiBaseUrl: instanceInfo.apiBaseUrl,
      auth: options.auth,
      fetchImpl: options.fetchImpl,
      protocols: options.protocols,
      debug: options.debug,
      identifyPayload: options.identifyPayload,
      buildIdentifyPayload: ({ auth }) => {
        if (options.identifyPayload !== undefined) {
          return options.identifyPayload;
        }

        if (!auth) {
          return undefined;
        }

        return {
          op: 2,
          d: {
            token: auth.token,
            intents: options.intents ?? 0,
            properties: options.properties ?? {
              os: process.platform,
              browser: "fluxer-js",
              device: "fluxer-js"
            },
            presence: options.presence,
            shard: options.shard
          }
        };
      },
      webSocketFactory: options.webSocketFactory,
      parseDispatchEvent: defaultParseDispatchEvent,
      parseMessageEvent: options.parseMessageEvent ?? defaultParseMessageEvent
    }),
    outbound: new RestTransport({
      baseUrl: instanceInfo.apiBaseUrl,
      discovery,
      auth: options.auth,
      fetchImpl: options.fetchImpl,
      userAgent: options.userAgent
    })
  });
}

async function fetchDiscoveryForPlatformTransport(
  options: CreateFluxerPlatformTransportOptions
): Promise<FluxerInstanceDiscoveryDocument> {
  try {
    return await fetchInstanceDiscoveryDocument({
      instanceUrl: options.instanceUrl,
      fetchImpl: options.fetchImpl
    });
  } catch (error) {
    const normalizedError = createPlatformBootstrapError({
      message: "Failed to fetch the Fluxer discovery document during platform transport bootstrap.",
      code: "PLATFORM_DISCOVERY_FAILED",
      retryable: true,
      details: {
        instanceUrl: options.instanceUrl,
        message: error instanceof Error ? error.message : "Unknown discovery bootstrap failure."
      }
    });

    options.debug?.({
      scope: "transport",
      event: "platform_transport_discovery_failed",
      level: "error",
      timestamp: new Date().toISOString(),
      data: normalizedError.details
    });

    throw normalizedError;
  }
}

async function fetchGatewayInfoForPlatformTransport(
  instanceInfo: FluxerInstanceInfo,
  options: CreateFluxerPlatformTransportOptions
) {
  try {
    return await fetchGatewayInformation({
      apiBaseUrl: instanceInfo.apiBaseUrl,
      auth: options.auth,
      fetchImpl: options.fetchImpl,
      userAgent: options.userAgent
    });
  } catch (error) {
    const normalizedError = createPlatformBootstrapError({
      message: "Failed to fetch gateway bootstrap information during platform transport creation.",
      code: "PLATFORM_GATEWAY_INFO_FAILED",
      retryable: true,
      details: {
        instanceUrl: instanceInfo.instanceUrl,
        apiBaseUrl: instanceInfo.apiBaseUrl,
        message: error instanceof Error ? error.message : "Unknown gateway bootstrap failure."
      }
    });

    options.debug?.({
      scope: "transport",
      event: "platform_transport_gateway_info_failed",
      level: "error",
      timestamp: new Date().toISOString(),
      data: normalizedError.details
    });

    throw normalizedError;
  }
}

function assertPlatformTransportCapabilities(
  instanceInfo: FluxerInstanceInfo,
  debug?: FluxerDebugHandler
): void {
  const missingCapabilities: string[] = [];

  if (!instanceInfo.capabilities.gateway) {
    missingCapabilities.push("gateway");
  }

  if (!instanceInfo.capabilities.gatewayBot) {
    missingCapabilities.push("gatewayBot");
  }

  if (missingCapabilities.length === 0) {
    return;
  }

  debug?.({
    scope: "transport",
    event: "platform_transport_bootstrap_blocked",
    level: "error",
    timestamp: new Date().toISOString(),
    data: {
      instanceUrl: instanceInfo.instanceUrl,
      missingCapabilities
    }
  });

  throw createPlatformBootstrapError({
    message: `This Fluxer instance does not support platform transport bootstrap. Missing capabilities: ${missingCapabilities.join(", ")}.`,
    code: "INSTANCE_CAPABILITY_UNSUPPORTED",
    retryable: false,
    details: {
      instanceUrl: instanceInfo.instanceUrl,
      missingCapabilities
    }
  });
}

function createPlatformBootstrapError(options: {
  message: string;
  code: string;
  retryable: boolean;
  details: Record<string, unknown>;
}): PlatformBootstrapError {
  return new PlatformBootstrapError(options);
}

function listEnabledCapabilities(instanceInfo: FluxerInstanceInfo): string[] {
  return Object.entries(instanceInfo.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

export function defaultParseDispatchEvent(payload: unknown): FluxerGatewayDispatchEvent | null {
  const envelope = payload as FluxerGatewayEnvelope;

  if (envelope.op !== 0 || typeof envelope.t !== "string") {
    return null;
  }

  return {
    type: envelope.t,
    sequence: envelope.s ?? null,
    data: envelope.d,
    raw: envelope
  };
}

export function defaultParseMessageEvent(payload: unknown): FluxerMessage | null {
  const event = defaultParseDispatchEvent(payload);

  if (event?.type !== "MESSAGE_CREATE" || !event.data) {
    return null;
  }

  if (!isRecord(event.data)) {
    throw createInvalidMessageCreatePayloadError(event, "Message payload must be an object.", event.data);
  }

  const author = isRecord(event.data.author) ? event.data.author : undefined;
  const content = typeof event.data.content === "string" ? event.data.content : "";

  if (
    typeof event.data.id !== "string"
    || typeof event.data.channel_id !== "string"
    || typeof event.data.timestamp !== "string"
    || !author
    || typeof author.id !== "string"
    || typeof author.username !== "string"
  ) {
    throw createInvalidMessageCreatePayloadError(
      event,
      "Message payload is missing required fields.",
      event.data
    );
  }

  const createdAt = new Date(event.data.timestamp);
  if (Number.isNaN(createdAt.getTime())) {
    throw createInvalidMessageCreatePayloadError(
      event,
      "Message payload included an invalid timestamp.",
      event.data
    );
  }

  return {
    id: event.data.id,
    content,
    author: {
      id: author.id,
      username: author.username,
      displayName: typeof author.global_name === "string" ? author.global_name : undefined,
      isBot: typeof author.bot === "boolean" ? author.bot : undefined
    },
    channel: {
      id: event.data.channel_id,
      name: event.data.channel_id,
      type: "text"
    },
    createdAt
  };
}

function createInvalidMessageCreatePayloadError(
  event: FluxerGatewayDispatchEvent,
  message: string,
  payload: unknown
): GatewayProtocolError {
  return new GatewayProtocolError({
    message: `Gateway MESSAGE_CREATE payload is invalid. ${message}`,
    code: "GATEWAY_MESSAGE_CREATE_INVALID",
    retryable: false,
    opcode: event.raw.op,
    eventType: event.type,
    details: {
      payload
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

