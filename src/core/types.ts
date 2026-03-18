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

export interface FluxerGuild {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface FluxerRole {
  id: string;
  guildId: string;
  name: string;
  color?: number;
  position?: number;
  permissions?: string;
}

export interface FluxerGuildMember {
  user: FluxerUser;
  guildId: string;
  nickname?: string;
  roles?: string[];
  joinedAt?: Date;
}

export interface FluxerPresence {
  userId: string;
  status: "online" | "idle" | "dnd" | "offline" | "invisible" | string;
  activities?: Array<{
    name: string;
    type?: number;
  }>;
}

export interface FluxerTypingStartEvent {
  channelId: string;
  userId: string;
  guildId?: string;
  startedAt?: Date;
}

export interface FluxerReactionEmoji {
  id?: string;
  name?: string;
  animated?: boolean;
}

export interface FluxerReactionEvent {
  userId: string;
  channelId: string;
  messageId: string;
  guildId?: string;
  emoji: FluxerReactionEmoji;
}

export interface FluxerVoiceState {
  guildId?: string;
  channelId?: string;
  userId: string;
  sessionId: string;
  deaf?: boolean;
  mute?: boolean;
  selfDeaf?: boolean;
  selfMute?: boolean;
  selfStream?: boolean;
  selfVideo?: boolean;
  suppress?: boolean;
}

export interface FluxerVoiceServerUpdate {
  guildId: string;
  token: string;
  endpoint?: string;
}

export interface FluxerBanEvent {
  guildId: string;
  user: FluxerUser;
}

export interface FluxerInvite {
  code: string;
  channelId?: string;
  guildId?: string;
  inviter?: FluxerUser;
  uses?: number;
  maxUses?: number;
  maxAgeSeconds?: number;
  temporary?: boolean;
  createdAt?: Date;
  expiresAt?: Date;
}

export interface MessageBuilderLike {
  toJSON(): Omit<SendMessagePayload, "channelId">;
}

export interface FluxerEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface FluxerEmbedFooter {
  text: string;
  iconUrl?: string;
}

export interface FluxerEmbedAuthor {
  name: string;
  url?: string;
  iconUrl?: string;
}

export interface FluxerEmbedImage {
  url: string;
}

export interface FluxerEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: FluxerEmbedFooter;
  author?: FluxerEmbedAuthor;
  image?: FluxerEmbedImage;
  thumbnail?: FluxerEmbedImage;
  fields?: FluxerEmbedField[];
}

export interface SendMessagePayload {
  channelId: string;
  content?: string;
  embeds?: FluxerEmbed[];
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

export type FluxerCommandValueType = "string" | "number" | "boolean";

type FluxerResolvedCommandValue<TType extends FluxerCommandValueType | undefined> =
  TType extends "number" ? number
  : TType extends "boolean" ? boolean
  : string;

type FluxerCommandArgumentResult<
  TDefinition extends FluxerCommandArgumentDefinition
> = TDefinition["rest"] extends true
  ? FluxerResolvedCommandValue<TDefinition["type"]>[]
  : TDefinition["required"] extends true
    ? FluxerResolvedCommandValue<TDefinition["type"]>
    : FluxerResolvedCommandValue<TDefinition["type"]> | undefined;

type FluxerCommandFlagResult<
  TDefinition extends FluxerCommandFlagDefinition
> = TDefinition["multiple"] extends true
  ? FluxerResolvedCommandValue<TDefinition["type"]>[]
  : TDefinition["required"] extends true
    ? FluxerResolvedCommandValue<TDefinition["type"]>
    : FluxerResolvedCommandValue<TDefinition["type"]> | undefined;

type FluxerCommandArgumentRecord<
  TDefinitions extends readonly FluxerCommandArgumentDefinition[]
> = {
  [TDefinition in TDefinitions[number] as TDefinition["name"]]: FluxerCommandArgumentResult<TDefinition>;
};

type FluxerCommandFlagRecord<
  TDefinitions extends readonly FluxerCommandFlagDefinition[]
> = {
  [TDefinition in TDefinitions[number] as TDefinition["name"]]: FluxerCommandFlagResult<TDefinition>;
};

export interface FluxerCommandArgumentDefinition<
  TName extends string = string,
  TType extends FluxerCommandValueType = FluxerCommandValueType
> {
  name: TName;
  type?: TType;
  description?: string;
  required?: boolean;
  rest?: boolean;
}

export interface FluxerCommandFlagDefinition<
  TName extends string = string,
  TType extends FluxerCommandValueType = FluxerCommandValueType
> {
  name: TName;
  short?: string;
  type?: TType;
  description?: string;
  required?: boolean;
  multiple?: boolean;
  defaultValue?: FluxerResolvedCommandValue<TType>;
}

export interface FluxerCommandSchema<
  TArgs extends readonly FluxerCommandArgumentDefinition[] = readonly FluxerCommandArgumentDefinition[],
  TFlags extends readonly FluxerCommandFlagDefinition[] = readonly FluxerCommandFlagDefinition[]
> {
  args?: TArgs;
  flags?: TFlags;
  allowUnknownFlags?: boolean;
}

export type FluxerParsedCommandInput<
  TSchema extends FluxerCommandSchema | undefined = undefined
> = TSchema extends FluxerCommandSchema<infer TArgs, infer TFlags>
  ? {
      args: FluxerCommandArgumentRecord<TArgs>;
      flags: FluxerCommandFlagRecord<TFlags>;
      rawArgs: string[];
      unknownFlags: string[];
    }
  : null;

export interface CommandContext<
  TSchema extends FluxerCommandSchema | undefined = FluxerCommandSchema | undefined
> {
  client: FluxerClientLike;
  bot: FluxerBotLike;
  command: FluxerCommand;
  message: FluxerMessage;
  args: string[];
  input: FluxerParsedCommandInput<TSchema>;
  commandName: string;
  state: Record<string, unknown>;
  reply: (
    message: string | Omit<SendMessagePayload, "channelId"> | MessageBuilderLike
  ) => Promise<void>;
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
export type FluxerCommandExecutor<
  TSchema extends FluxerCommandSchema | undefined = FluxerCommandSchema | undefined
> = {
  bivarianceHack: (context: CommandContext<TSchema>) => Promise<void> | void;
}["bivarianceHack"];

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
  commandInvalid?: (context: {
    command: FluxerCommand;
    commandContext: CommandContext;
    error: Error;
  }) => Promise<void> | void;
  commandError?: (context: {
    command: FluxerCommand;
    commandContext: CommandContext;
    error: Error;
  }) => Promise<void> | void;
}

export interface FluxerCommand<
  TSchema extends FluxerCommandSchema | undefined = FluxerCommandSchema | undefined
> {
  name: string;
  aliases?: string[];
  description?: string;
  usage?: string;
  examples?: string[];
  hidden?: boolean;
  schema?: TSchema;
  guards?: FluxerCommandGuard[];
  middleware?: FluxerCommandMiddleware[];
  execute: FluxerCommandExecutor<TSchema>;
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
  gatewayStateChange: FluxerGatewayStateChangeEvent;
  gatewaySessionUpdate: FluxerGatewaySession;
  messageCreate: FluxerMessage;
  messageUpdate: FluxerMessage;
  messageDelete: { id: string; channelId: string; guildId?: string };
  messageReactionAdd: FluxerReactionEvent;
  messageReactionRemove: FluxerReactionEvent;
  channelCreate: FluxerChannel;
  channelUpdate: FluxerChannel;
  channelDelete: { id: string; guildId?: string };
  guildCreate: FluxerGuild;
  guildUpdate: FluxerGuild;
  guildDelete: { id: string };
  roleCreate: FluxerRole;
  roleUpdate: FluxerRole;
  roleDelete: { id: string; guildId: string };
  guildBanAdd: FluxerBanEvent;
  guildBanRemove: FluxerBanEvent;
  guildMemberAdd: FluxerGuildMember;
  guildMemberUpdate: FluxerGuildMember;
  guildMemberRemove: { guildId: string; user: FluxerUser };
  inviteCreate: FluxerInvite;
  inviteDelete: FluxerInvite;
  presenceUpdate: FluxerPresence;
  typingStart: FluxerTypingStartEvent;
  userUpdate: FluxerUser;
  voiceStateUpdate: FluxerVoiceState;
  voiceServerUpdate: FluxerVoiceServerUpdate;
  gatewayDispatch: FluxerGatewayDispatchEvent;
  debug: FluxerDebugEvent;
  commandExecuted: { commandName: string; message: FluxerMessage };
  error: Error;
}

export type FluxerMessageHandler = (message: FluxerMessage) => Promise<void> | void;
export type FluxerErrorHandler = (error: Error) => Promise<void> | void;
export type FluxerGatewayDispatchHandler = (
  event: FluxerGatewayDispatchEvent
) => Promise<void> | void;
export type FluxerGatewayStateHandler = (
  event: FluxerGatewayStateChangeEvent
) => Promise<void> | void;
export type FluxerGatewaySessionHandler = (
  session: FluxerGatewaySession
) => Promise<void> | void;
export type FluxerDebugHandler = (event: FluxerDebugEvent) => Promise<void> | void;

export interface FluxerTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(payload: SendMessagePayload): Promise<void>;
  onMessage(handler: FluxerMessageHandler): void;
  onError(handler: FluxerErrorHandler): void;
  onGatewayDispatch(handler: FluxerGatewayDispatchHandler): void;
  onGatewayStateChange(handler: FluxerGatewayStateHandler): void;
  onGatewaySessionUpdate(handler: FluxerGatewaySessionHandler): void;
  onDebug(handler: FluxerDebugHandler): void;
}

export interface FluxerReconnectOptions {
  enabled?: boolean;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export type FluxerGatewayConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "identifying"
  | "resuming"
  | "ready"
  | "reconnecting"
  | "disconnected";

export interface FluxerGatewayStateChangeEvent {
  previousState: FluxerGatewayConnectionState;
  state: FluxerGatewayConnectionState;
  reason?: string;
}

export interface FluxerGatewaySession {
  sessionId?: string;
  sequence: number | null;
  resumable: boolean;
}

export interface FluxerDebugEvent {
  scope: "gateway" | "transport" | "client" | "command";
  event: string;
  timestamp: string;
  level?: "debug" | "info" | "warn" | "error";
  data?: Record<string, unknown>;
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

export interface FluxerInstanceCapabilities {
  federation: boolean;
  invites: boolean;
  media: boolean;
  gateway: boolean;
  gatewayBot: boolean;
  botAuth: boolean;
  attachments: boolean;
}

export interface FluxerInstanceInfo {
  instanceUrl: string;
  discoveryUrl: string;
  apiBaseUrl: string;
  gatewayBaseUrl?: string;
  apiCodeVersion: number;
  discovery: FluxerInstanceDiscoveryDocument;
  capabilities: FluxerInstanceCapabilities;
  isSelfHosted: boolean;
  federationVersion?: number;
}

export interface FluxerRestTransportOptions {
  baseUrl?: string;
  instanceUrl?: string;
  discovery?: FluxerInstanceDiscoveryDocument;
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
  debug?: FluxerDebugHandler;
  identifyPayload?: unknown;
  buildIdentifyPayload?: (context: { auth?: FluxerAuth }) => unknown;
  buildResumePayload?: (context: {
    auth?: FluxerAuth;
    sessionId?: string;
    sequence: number | null;
  }) => unknown;
  heartbeatIntervalResolver?: (payload: unknown) => number | null;
  isDispatchPayload?: (payload: unknown) => boolean;
  isHeartbeatAckPayload?: (payload: unknown) => boolean;
  isReconnectPayload?: (payload: unknown) => boolean;
  isInvalidSessionPayload?: (payload: unknown) => boolean;
  isHelloPayload?: (payload: unknown) => boolean;
  createHeartbeatPayload?: (sequence: number | null) => unknown;
  reconnect?: FluxerReconnectOptions;
  parseMessageEvent: (payload: unknown) => FluxerMessage | null;
  parseDispatchEvent?: (payload: unknown) => FluxerGatewayDispatchEvent | null;
}

export interface FluxerGatewayEnvelope<T = unknown> {
  op: number;
  d: T;
  s: number | null;
  t: string | null;
}

export interface FluxerGatewayDispatchEvent<T = unknown> {
  type: string;
  sequence: number | null;
  data: T;
  raw: FluxerGatewayEnvelope<T>;
}

export interface FluxerClientLike {
  isConnected(): boolean;
  emitDebug?(event: Omit<FluxerDebugEvent, "timestamp"> & { timestamp?: string }): void;
  sendMessage(
    channelId: string,
    message: string | Omit<SendMessagePayload, "channelId"> | MessageBuilderLike
  ): Promise<void>;
}

export interface FluxerBotLike {
  readonly name: string;
  readonly prefix: string;
  readonly commands: FluxerCommand[];
  command(command: FluxerCommand): this;
  resolveCommandFromInput(input: string): FluxerCommand | undefined;
  use(middleware: FluxerCommandMiddleware): this;
  guard(guard: FluxerCommandGuard): this;
  hooks(hooks: FluxerCommandExecutionHooks): this;
  module(module: FluxerModule): this;
  installModule(module: FluxerModule): Promise<this>;
  plugin(plugin: FluxerPlugin): this;
  installPlugin(plugin: FluxerPlugin): Promise<this>;
}

export interface FluxerPluginContext {
  bot: FluxerBotLike;
  client?: FluxerClientLike;
}

export interface FluxerPlugin {
  name: string;
  description?: string;
  modules?: FluxerModule[];
  setup?: (context: FluxerPluginContext) => Promise<void> | void;
}
