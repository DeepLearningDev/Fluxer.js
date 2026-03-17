import { fetchGatewayInformation, fetchInstanceDiscoveryDocument } from "./Discovery.js";
import { GatewayTransport } from "./GatewayTransport.js";
import { PlatformTransport } from "./PlatformTransport.js";
import { RestTransport } from "./RestTransport.js";
import type {
  FluxerAuth,
  FluxerGatewayDispatchEvent,
  FluxerGatewayEnvelope,
  FluxerGatewayTransportOptions,
  FluxerMessage,
  FluxerTransport
} from "./types.js";

export interface CreateFluxerPlatformTransportOptions {
  auth: FluxerAuth;
  instanceUrl?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  protocols?: string | string[];
  identifyPayload?: unknown;
  intents?: number;
  shard?: [number, number];
  properties?: Record<string, string>;
  presence?: Record<string, unknown>;
  webSocketFactory?: (url: string, protocols?: string | string[]) => WebSocket;
  parseMessageEvent: FluxerGatewayTransportOptions["parseMessageEvent"];
}

export async function createFluxerPlatformTransport(
  options: CreateFluxerPlatformTransportOptions
): Promise<FluxerTransport> {
  const discovery = await fetchInstanceDiscoveryDocument({
    instanceUrl: options.instanceUrl,
    fetchImpl: options.fetchImpl
  });

  const gateway = await fetchGatewayInformation({
    apiBaseUrl: discovery.endpoints.api,
    auth: options.auth,
    fetchImpl: options.fetchImpl,
    userAgent: options.userAgent
  });

  return new PlatformTransport({
    inbound: new GatewayTransport({
      url: gateway.url,
      apiBaseUrl: discovery.endpoints.api,
      auth: options.auth,
      fetchImpl: options.fetchImpl,
      protocols: options.protocols,
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
      parseMessageEvent: options.parseMessageEvent
    }),
    outbound: new RestTransport({
      baseUrl: discovery.endpoints.api,
      auth: options.auth,
      fetchImpl: options.fetchImpl,
      userAgent: options.userAgent
    })
  });
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

  const payloadData = event.data as {
    id: string;
    content: string;
    author: { id: string; username: string; global_name?: string; bot?: boolean };
    channel_id: string;
    timestamp: string;
  };

  return {
    id: payloadData.id,
    content: payloadData.content,
    author: {
      id: payloadData.author.id,
      username: payloadData.author.username,
      displayName: payloadData.author.global_name,
      isBot: payloadData.author.bot
    },
    channel: {
      id: payloadData.channel_id,
      name: payloadData.channel_id,
      type: "text"
    },
    createdAt: new Date(payloadData.timestamp)
  };
}
