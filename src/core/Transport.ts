import type {
  FluxerDebugHandler,
  EditMessagePayload,
  FluxerErrorHandler,
  FluxerGatewayDispatchHandler,
  FluxerGatewaySessionHandler,
  FluxerGatewayStateHandler,
  FluxerChannel,
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
import { FluxerError } from "./errors.js";

export abstract class BaseTransport implements FluxerTransport {
  #messageHandler?: FluxerMessageHandler;
  #errorHandler?: FluxerErrorHandler;
  #gatewayDispatchHandler?: FluxerGatewayDispatchHandler;
  #gatewayStateHandler?: FluxerGatewayStateHandler;
  #gatewaySessionHandler?: FluxerGatewaySessionHandler;
  #debugHandler?: FluxerDebugHandler;

  public onMessage(handler: FluxerMessageHandler): void {
    this.#messageHandler = handler;
  }

  public onError(handler: FluxerErrorHandler): void {
    this.#errorHandler = handler;
  }

  public onGatewayDispatch(handler: FluxerGatewayDispatchHandler): void {
    this.#gatewayDispatchHandler = handler;
  }

  public onGatewayStateChange(handler: FluxerGatewayStateHandler): void {
    this.#gatewayStateHandler = handler;
  }

  public onGatewaySessionUpdate(handler: FluxerGatewaySessionHandler): void {
    this.#gatewaySessionHandler = handler;
  }

  public onDebug(handler: FluxerDebugHandler): void {
    this.#debugHandler = handler;
  }

  protected async emitMessage(message: Parameters<FluxerMessageHandler>[0]): Promise<void> {
    await this.#messageHandler?.(message);
  }

  protected async emitError(error: Error): Promise<void> {
    await this.#errorHandler?.(error);
  }

  protected async emitGatewayDispatch(
    event: Parameters<FluxerGatewayDispatchHandler>[0]
  ): Promise<void> {
    await this.#gatewayDispatchHandler?.(event);
  }

  protected async emitGatewayStateChange(
    event: Parameters<FluxerGatewayStateHandler>[0]
  ): Promise<void> {
    await this.#gatewayStateHandler?.(event);
  }

  protected async emitGatewaySessionUpdate(
    session: Parameters<FluxerGatewaySessionHandler>[0]
  ): Promise<void> {
    await this.#gatewaySessionHandler?.(session);
  }

  protected async emitDebug(event: Parameters<FluxerDebugHandler>[0]): Promise<void> {
    await this.#debugHandler?.(event);
  }

  public abstract connect(): Promise<void>;
  public abstract disconnect(): Promise<void>;
  public abstract sendMessage(payload: SendMessagePayload): Promise<void>;

  public async fetchCurrentUser(): Promise<FluxerUser> {
    throw new FluxerError(
      "This transport does not support fetching the current user.",
      "TRANSPORT_FETCH_CURRENT_USER_UNSUPPORTED"
    );
  }

  public async indicateTyping(channelId: string): Promise<void> {
    void channelId;
    throw new FluxerError(
      "This transport does not support typing indicators.",
      "TRANSPORT_INDICATE_TYPING_UNSUPPORTED"
    );
  }

  public async fetchChannel(channelId: string): Promise<FluxerChannel> {
    void channelId;
    throw new FluxerError(
      "This transport does not support fetching channels.",
      "TRANSPORT_FETCH_CHANNEL_UNSUPPORTED"
    );
  }

  public async fetchGuild(guildId: string): Promise<FluxerGuild> {
    void guildId;
    throw new FluxerError(
      "This transport does not support fetching guilds.",
      "TRANSPORT_FETCH_GUILD_UNSUPPORTED"
    );
  }

  public async fetchGuildMember(guildId: string, userId: string): Promise<FluxerGuildMember> {
    void guildId;
    void userId;
    throw new FluxerError(
      "This transport does not support fetching guild members.",
      "TRANSPORT_FETCH_GUILD_MEMBER_UNSUPPORTED"
    );
  }

  public async listGuildRoles(guildId: string): Promise<FluxerRole[]> {
    void guildId;
    throw new FluxerError(
      "This transport does not support listing guild roles.",
      "TRANSPORT_LIST_GUILD_ROLES_UNSUPPORTED"
    );
  }

  public async listPinnedMessages(
    channelId: string,
    options?: FluxerListPinnedMessagesOptions
  ): Promise<FluxerPinnedMessageList> {
    void channelId;
    void options;
    throw new FluxerError(
      "This transport does not support listing pinned messages.",
      "TRANSPORT_LIST_PINNED_MESSAGES_UNSUPPORTED"
    );
  }

  public async listMessages(channelId: string, options?: FluxerListMessagesOptions): Promise<FluxerMessage[]> {
    void channelId;
    void options;
    throw new FluxerError(
      "This transport does not support listing messages.",
      "TRANSPORT_LIST_MESSAGES_UNSUPPORTED"
    );
  }

  public async fetchMessage(channelId: string, messageId: string): Promise<FluxerMessage> {
    void channelId;
    void messageId;
    throw new FluxerError(
      "This transport does not support fetching messages.",
      "TRANSPORT_FETCH_MESSAGE_UNSUPPORTED"
    );
  }

  public async editMessage(
    channelId: string,
    messageId: string,
    payload: EditMessagePayload
  ): Promise<FluxerMessage> {
    void channelId;
    void messageId;
    void payload;
    throw new FluxerError(
      "This transport does not support editing messages.",
      "TRANSPORT_EDIT_MESSAGE_UNSUPPORTED"
    );
  }

  public async deleteMessage(channelId: string, messageId: string): Promise<void> {
    void channelId;
    void messageId;
    throw new FluxerError(
      "This transport does not support deleting messages.",
      "TRANSPORT_DELETE_MESSAGE_UNSUPPORTED"
    );
  }
}
