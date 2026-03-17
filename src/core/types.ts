export interface FluxerUser {
  id: string;
  username: string;
  displayName?: string;
  isBot?: boolean;
}

export interface FluxerChannel {
  id: string;
  name: string;
  type: "dm" | "group" | "text";
}

export interface FluxerMessage {
  id: string;
  content: string;
  author: FluxerUser;
  channel: FluxerChannel;
  createdAt: Date;
}

export interface SendMessagePayload {
  channelId: string;
  content: string;
  nonce?: string;
  messageReference?: FluxerMessageReference;
}

export interface FluxerAuth {
  token: string;
  scheme?: string;
}

export interface FluxerMessageReference {
  messageId: string;
  channelId?: string;
  guildId?: string;
  type?: number;
}

export interface CommandContext {
  client: FluxerClientLike;
  bot: FluxerBotLike;
  command: FluxerCommand;
  message: FluxerMessage;
  args: string[];
  commandName: string;
  state: Record<string, unknown>;
  reply: (content: string) => Promise<void>;
}

export interface ParsedCommandInput {
  commandName: string;
  args: string[];
}

export interface FluxerGuardDecision {
  allowed: boolean;
  reason?: string;
}

export type FluxerGuardResult = boolean | string | FluxerGuardDecision;
export type FluxerCommandGuard = (
  context: CommandContext
) => Promise<FluxerGuardResult> | FluxerGuardResult;

export type FluxerCommandNext = () => Promise<void>;
export type FluxerCommandMiddleware = (
  context: CommandContext,
  next: FluxerCommandNext
) => Promise<void> | void;

export interface FluxerCommandExecutionHooks {
  beforeCommand?: (context: CommandContext) => Promise<void> | void;
  afterCommand?: (context: CommandContext) => Promise<void> | void;
  commandNotFound?: (context: {
    client: FluxerClientLike;
    bot: FluxerBotLike;
    message: FluxerMessage;
    commandName: string;
    args: string[];
  }) => Promise<void> | void;
  commandBlocked?: (context: {
    command: FluxerCommand;
    commandContext: CommandContext;
    result: FluxerGuardDecision;
  }) => Promise<void> | void;
  commandError?: (context: {
    command: FluxerCommand;
    commandContext: CommandContext;
    error: Error;
  }) => Promise<void> | void;
}

export interface FluxerCommand {
  name: string;
  aliases?: string[];
  description?: string;
  guards?: FluxerCommandGuard[];
  middleware?: FluxerCommandMiddleware[];
  execute: (context: CommandContext) => Promise<void> | void;
}

export interface FluxerBotOptions {
  name: string;
  prefix?: string;
  ignoreBots?: boolean;
  guards?: FluxerCommandGuard[];
  middleware?: FluxerCommandMiddleware[];
  hooks?: FluxerCommandExecutionHooks;
  caseSensitiveCommands?: boolean;
}

export interface FluxerModule {
  name: string;
  commands?: FluxerCommand[];
  guards?: FluxerCommandGuard[];
  middleware?: FluxerCommandMiddleware[];
  hooks?: FluxerCommandExecutionHooks;
  setup?: (bot: FluxerBotLike) => Promise<void> | void;
}

export interface FluxerPermissionPolicy {
  allowUserIds?: string[];
  denyUserIds?: string[];
  allowChannelIds?: string[];
  denyChannelIds?: string[];
  allowChannelTypes?: FluxerChannel["type"][];
  denyChannelTypes?: FluxerChannel["type"][];
  predicate?: (context: CommandContext) => Promise<boolean> | boolean;
  reason?: string;
}

export interface FluxerEventMap {
  ready: { connectedAt: Date };
  messageCreate: FluxerMessage;
  commandExecuted: { commandName: string; message: FluxerMessage };
  error: Error;
}

export type FluxerMessageHandler = (message: FluxerMessage) => Promise<void> | void;
export type FluxerErrorHandler = (error: Error) => Promise<void> | void;

export interface FluxerTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(payload: SendMessagePayload): Promise<void>;
  onMessage(handler: FluxerMessageHandler): void;
  onError(handler: FluxerErrorHandler): void;
}

export interface FluxerReconnectOptions {
  enabled?: boolean;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface FluxerGatewayInfo {
  url: string;
  shards: number;
  session_start_limit: {
    total: number;
    remaining: number;
    reset_after: number;
    max_concurrency: number;
  };
}

export interface FluxerInstanceDiscoveryDocument {
  api_code_version: number;
  endpoints: {
    api: string;
    api_client: string;
    api_public: string;
    gateway: string;
    media: string;
    static_cdn: string;
    marketing: string;
    admin: string;
    invite: string;
    gift: string;
    webapp: string;
  };
  features: Record<string, boolean>;
  federation?: {
    enabled: boolean;
    version: number;
  };
}

export interface FluxerRestTransportOptions {
  baseUrl?: string;
  instanceUrl?: string;
  auth?: FluxerAuth;
  fetchImpl?: typeof fetch;
  sendMessagePath?: (channelId: string) => string;
  headers?: Record<string, string>;
  userAgent?: string;
}

export interface FluxerGatewayTransportOptions {
  url?: string;
  apiBaseUrl?: string;
  instanceUrl?: string;
  auth?: FluxerAuth;
  protocols?: string | string[];
  fetchImpl?: typeof fetch;
  webSocketFactory?: (url: string, protocols?: string | string[]) => WebSocket;
  identifyPayload?: unknown;
  buildIdentifyPayload?: (context: { auth?: FluxerAuth }) => unknown;
  heartbeatIntervalResolver?: (payload: unknown) => number | null;
  isDispatchPayload?: (payload: unknown) => boolean;
  isHeartbeatAckPayload?: (payload: unknown) => boolean;
  isReconnectPayload?: (payload: unknown) => boolean;
  isInvalidSessionPayload?: (payload: unknown) => boolean;
  isHelloPayload?: (payload: unknown) => boolean;
  createHeartbeatPayload?: (sequence: number | null) => unknown;
  reconnect?: FluxerReconnectOptions;
  parseMessageEvent: (payload: unknown) => FluxerMessage | null;
}

export interface FluxerClientLike {
  isConnected(): boolean;
  sendMessage(channelId: string, content: string): Promise<void>;
}

export interface FluxerBotLike {
  readonly name: string;
  readonly prefix: string;
  command(command: FluxerCommand): this;
  use(middleware: FluxerCommandMiddleware): this;
  guard(guard: FluxerCommandGuard): this;
  hooks(hooks: FluxerCommandExecutionHooks): this;
  module(module: FluxerModule): this;
}
