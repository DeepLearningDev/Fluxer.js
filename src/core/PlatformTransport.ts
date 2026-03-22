import { BaseTransport } from "./Transport.js";
import type {
  FluxerDebugHandler,
  EditMessagePayload,
  FluxerChannel,
  FluxerGatewayDispatchHandler,
  FluxerGatewaySessionHandler,
  FluxerGatewayStateHandler,
  FluxerGuild,
  FluxerGuildMember,
  FluxerListPinnedMessagesOptions,
  FluxerListMessagesOptions,
  FluxerMessage,
  FluxerMessageHandler,
  FluxerPinnedMessageList,
  FluxerRole,
  FluxerTransport,
  FluxerUser,
  SendMessagePayload
} from "./types.js";

export interface PlatformTransportOptions {
  inbound: FluxerTransport;
  outbound: FluxerTransport;
}

export class PlatformTransport extends BaseTransport {
  readonly #inbound: FluxerTransport;
  readonly #outbound: FluxerTransport;

  public constructor(options: PlatformTransportOptions) {
    super();
    this.#inbound = options.inbound;
    this.#outbound = options.outbound;
  }

  public override onMessage(handler: FluxerMessageHandler): void {
    super.onMessage(handler);
    this.#inbound.onMessage(handler);
  }

  public override onError(handler: (error: Error) => Promise<void> | void): void {
    super.onError(handler);
    this.#inbound.onError(handler);
    this.#outbound.onError(handler);
  }

  public override onGatewayDispatch(handler: FluxerGatewayDispatchHandler): void {
    super.onGatewayDispatch(handler);
    this.#inbound.onGatewayDispatch(handler);
  }

  public override onGatewayStateChange(handler: FluxerGatewayStateHandler): void {
    super.onGatewayStateChange(handler);
    this.#inbound.onGatewayStateChange(handler);
  }

  public override onGatewaySessionUpdate(handler: FluxerGatewaySessionHandler): void {
    super.onGatewaySessionUpdate(handler);
    this.#inbound.onGatewaySessionUpdate(handler);
  }

  public override onDebug(handler: FluxerDebugHandler): void {
    super.onDebug(handler);
    this.#inbound.onDebug(handler);
    this.#outbound.onDebug(handler);
  }

  public async connect(): Promise<void> {
    await Promise.all([this.#inbound.connect(), this.#outbound.connect()]);
  }

  public async disconnect(): Promise<void> {
    await Promise.all([this.#inbound.disconnect(), this.#outbound.disconnect()]);
  }

  public async sendMessage(payload: SendMessagePayload): Promise<void> {
    await this.#outbound.sendMessage(payload);
  }

  public async fetchCurrentUser(): Promise<FluxerUser> {
    return this.#outbound.fetchCurrentUser();
  }

  public async indicateTyping(channelId: string): Promise<void> {
    await this.#outbound.indicateTyping(channelId);
  }

  public async fetchChannel(channelId: string): Promise<FluxerChannel> {
    return this.#outbound.fetchChannel(channelId);
  }

  public async fetchGuild(guildId: string): Promise<FluxerGuild> {
    return this.#outbound.fetchGuild(guildId);
  }

  public async fetchGuildMember(guildId: string, userId: string): Promise<FluxerGuildMember> {
    return this.#outbound.fetchGuildMember(guildId, userId);
  }

  public async listGuildRoles(guildId: string): Promise<FluxerRole[]> {
    return this.#outbound.listGuildRoles(guildId);
  }

  public async listPinnedMessages(
    channelId: string,
    options?: FluxerListPinnedMessagesOptions
  ): Promise<FluxerPinnedMessageList> {
    return this.#outbound.listPinnedMessages(channelId, options);
  }

  public async listMessages(channelId: string, options?: FluxerListMessagesOptions): Promise<FluxerMessage[]> {
    return this.#outbound.listMessages(channelId, options);
  }

  public async fetchMessage(channelId: string, messageId: string): Promise<FluxerMessage> {
    return this.#outbound.fetchMessage(channelId, messageId);
  }

  public async editMessage(
    channelId: string,
    messageId: string,
    payload: EditMessagePayload
  ): Promise<FluxerMessage> {
    return this.#outbound.editMessage(channelId, messageId, payload);
  }

  public async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.#outbound.deleteMessage(channelId, messageId);
  }
}
