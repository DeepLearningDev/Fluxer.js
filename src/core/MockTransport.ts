import { BaseTransport } from "./Transport.js";
import type {
  FluxerChannel,
  FluxerDebugEvent,
  EditMessagePayload,
  FluxerGatewayDispatchEvent,
  FluxerGuild,
  FluxerGuildMember,
  FluxerGatewaySession,
  FluxerGatewayStateChangeEvent,
  FluxerListPinnedMessagesOptions,
  FluxerListMessagesOptions,
  FluxerMessage,
  FluxerPinnedMessageList,
  FluxerRole,
  FluxerUser,
  SendMessagePayload
} from "./types.js";
import { FluxerError } from "./errors.js";

export class MockTransport extends BaseTransport {
  #connected = false;
  #sentMessages: SendMessagePayload[] = [];
  readonly #typingChannelIds: string[] = [];
  readonly #channels = new Map<string, FluxerChannel>();
  readonly #guilds = new Map<string, FluxerGuild>();
  readonly #guildChannels = new Map<string, FluxerChannel[]>();
  readonly #guildMembers = new Map<string, FluxerGuildMember>();
  readonly #guildRoles = new Map<string, FluxerRole[]>();
  readonly #users = new Map<string, FluxerUser>();
  #currentUser: FluxerUser = {
    id: "mock_transport",
    username: "mocktransport",
    isBot: true
  };
  readonly #messageStore = new Map<string, FluxerMessage>();
  readonly #pinnedMessages = new Map<string, Date>();
  #nextMessageId = 1;
  readonly #sendHandlers = new Set<(payload: SendMessagePayload) => void | Promise<void>>();

  public get isConnected(): boolean {
    return this.#connected;
  }

  public get sentMessages(): SendMessagePayload[] {
    return [...this.#sentMessages];
  }

  public get typingChannelIds(): string[] {
    return [...this.#typingChannelIds];
  }

  public clearSentMessages(): void {
    this.#sentMessages = [];
  }

  public setGuild(guild: FluxerGuild): void {
    this.#guilds.set(guild.id, { ...guild });
  }

  public setGuildChannels(guildId: string, channels: FluxerChannel[]): void {
    this.#guildChannels.set(guildId, channels.map((channel) => ({ ...channel })));
    for (const channel of channels) {
      this.#channels.set(channel.id, { ...channel });
    }
  }

  public setCurrentUser(user: FluxerUser): void {
    this.#currentUser = { ...user };
    this.#users.set(user.id, { ...user });
  }

  public setUser(user: FluxerUser): void {
    this.#users.set(user.id, { ...user });
  }

  public setGuildMember(member: FluxerGuildMember): void {
    this.#guildMembers.set(this.#guildMemberKey(member.guildId, member.user.id), {
      ...member,
      user: { ...member.user },
      roles: member.roles ? [...member.roles] : undefined,
      joinedAt: member.joinedAt ? new Date(member.joinedAt) : undefined
    });
  }

  public setGuildRoles(guildId: string, roles: FluxerRole[]): void {
    this.#guildRoles.set(guildId, roles.map((role) => ({ ...role })));
  }

  public pinMessage(channelId: string, messageId: string, pinnedAt: Date = new Date()): void {
    const key = this.#messageKey(channelId, messageId);
    if (!this.#messageStore.has(key)) {
      throw new FluxerError("MockTransport could not find the message to pin.", "MOCK_MESSAGE_NOT_FOUND");
    }

    this.#pinnedMessages.set(key, new Date(pinnedAt));
  }

  public onSend(handler: (payload: SendMessagePayload) => void | Promise<void>): () => void {
    this.#sendHandlers.add(handler);
    return () => {
      this.#sendHandlers.delete(handler);
    };
  }

  public async connect(): Promise<void> {
    this.#connected = true;
  }

  public async disconnect(): Promise<void> {
    this.#connected = false;
  }

  public async sendMessage(payload: SendMessagePayload): Promise<void> {
    this.#sentMessages.push(payload);
    const message = this.#createStoredMessage(payload);
    this.#channels.set(message.channel.id, { ...message.channel });
    this.#messageStore.set(this.#messageKey(payload.channelId, message.id), message);
    for (const handler of this.#sendHandlers) {
      await handler(payload);
    }
    const timestamp = new Date().toISOString();
    const content = payload.content ?? "[rich message]";
    const embedSuffix = payload.embeds?.length ? ` (+${payload.embeds.length} embed(s))` : "";
    const attachmentSuffix = payload.attachments?.length
      ? ` (+${payload.attachments.length} attachment(s))`
      : "";
    console.log(`[Fluxer:${timestamp}] -> ${payload.channelId}: ${content}${embedSuffix}${attachmentSuffix}`);
  }

  public async fetchCurrentUser(): Promise<FluxerUser> {
    return { ...this.#currentUser };
  }

  public async fetchUser(userId: string): Promise<FluxerUser> {
    if (this.#currentUser.id === userId) {
      return { ...this.#currentUser };
    }

    const user = this.#users.get(userId);
    if (!user) {
      throw new FluxerError("MockTransport could not find the requested user.", "MOCK_USER_NOT_FOUND");
    }

    return { ...user };
  }

  public async indicateTyping(channelId: string): Promise<void> {
    this.#typingChannelIds.push(channelId);
    if (!this.#channels.has(channelId)) {
      this.#channels.set(channelId, {
        id: channelId,
        name: channelId,
        type: "text"
      });
    }
  }

  public async fetchChannel(channelId: string): Promise<FluxerChannel> {
    const channel = this.#channels.get(channelId);
    if (!channel) {
      throw new FluxerError("MockTransport could not find the requested channel.", "MOCK_CHANNEL_NOT_FOUND");
    }

    return { ...channel };
  }

  public async fetchGuild(guildId: string): Promise<FluxerGuild> {
    const guild = this.#guilds.get(guildId);
    if (!guild) {
      throw new FluxerError("MockTransport could not find the requested guild.", "MOCK_GUILD_NOT_FOUND");
    }

    return { ...guild };
  }

  public async listGuildChannels(guildId: string): Promise<FluxerChannel[]> {
    const channels = this.#guildChannels.get(guildId);
    if (!channels) {
      return [];
    }

    return channels.map((channel) => ({ ...channel }));
  }

  public async fetchGuildMember(guildId: string, userId: string): Promise<FluxerGuildMember> {
    const member = this.#guildMembers.get(this.#guildMemberKey(guildId, userId));
    if (!member) {
      throw new FluxerError(
        "MockTransport could not find the requested guild member.",
        "MOCK_GUILD_MEMBER_NOT_FOUND"
      );
    }

    return {
      ...member,
      user: { ...member.user },
      roles: member.roles ? [...member.roles] : undefined,
      joinedAt: member.joinedAt ? new Date(member.joinedAt) : undefined
    };
  }

  public async listGuildRoles(guildId: string): Promise<FluxerRole[]> {
    const roles = this.#guildRoles.get(guildId);
    if (!roles) {
      return [];
    }

    return roles.map((role) => ({ ...role }));
  }

  public async listPinnedMessages(
    channelId: string,
    options?: FluxerListPinnedMessagesOptions
  ): Promise<FluxerPinnedMessageList> {
    validatePinnedMessagesOptions(options);

    const beforeDate = resolvePinnedMessagesBefore(options?.before);
    const pinnedItems = [...this.#pinnedMessages.entries()]
      .map(([key, pinnedAt]) => {
        const separatorIndex = key.indexOf(":");
        const entryChannelId = separatorIndex >= 0 ? key.slice(0, separatorIndex) : "";
        const message = this.#messageStore.get(key);
        if (!message || entryChannelId !== channelId) {
          return null;
        }

        return {
          message,
          pinnedAt
        };
      })
      .filter((item): item is { message: FluxerMessage; pinnedAt: Date } => item !== null)
      .filter((item) => !beforeDate || item.pinnedAt < beforeDate)
      .sort((left, right) => right.pinnedAt.getTime() - left.pinnedAt.getTime());

    const limit = options?.limit;
    const items = limit === undefined ? pinnedItems : pinnedItems.slice(0, limit);

    return {
      items: items.map((item) => ({
        message: { ...item.message },
        pinnedAt: new Date(item.pinnedAt)
      })),
      hasMore: limit !== undefined ? pinnedItems.length > items.length : false
    };
  }

  public async listMessages(channelId: string, options?: FluxerListMessagesOptions): Promise<FluxerMessage[]> {
    if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)) {
      throw new FluxerError(
        "MockTransport listMessages limit must be an integer between 1 and 100.",
        "MOCK_LIST_MESSAGES_LIMIT_INVALID"
      );
    }

    const messages = [...this.#messageStore.values()]
      .filter((message) => message.channel.id === channelId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    let filtered = messages;
    if (options?.around) {
      const centerIndex = messages.findIndex((message) => message.id === options.around);
      if (centerIndex !== -1) {
        const start = Math.max(0, centerIndex - Math.floor((options.limit ?? 50) / 2));
        filtered = messages.slice(start, start + (options.limit ?? 50));
      } else {
        filtered = [];
      }
    } else {
      if (options?.before) {
        const beforeMessage = this.#messageStore.get(this.#messageKey(channelId, options.before));
        if (beforeMessage) {
          filtered = filtered.filter((message) => message.createdAt < beforeMessage.createdAt);
        }
      }

      if (options?.after) {
        const afterMessage = this.#messageStore.get(this.#messageKey(channelId, options.after));
        if (afterMessage) {
          filtered = filtered.filter((message) => message.createdAt > afterMessage.createdAt);
        }
      }

      if (options?.limit !== undefined) {
        filtered = filtered.slice(0, options.limit);
      }
    }

    return filtered.map((message) => ({ ...message }));
  }

  public async fetchMessage(channelId: string, messageId: string): Promise<FluxerMessage> {
    const message = this.#messageStore.get(this.#messageKey(channelId, messageId));
    if (!message) {
      throw new FluxerError("MockTransport could not find the requested message.", "MOCK_MESSAGE_NOT_FOUND");
    }

    return { ...message };
  }

  public async editMessage(
    channelId: string,
    messageId: string,
    payload: EditMessagePayload
  ): Promise<FluxerMessage> {
    const key = this.#messageKey(channelId, messageId);
    const existing = this.#messageStore.get(key);
    if (!existing) {
      throw new FluxerError("MockTransport could not find the message to edit.", "MOCK_MESSAGE_NOT_FOUND");
    }

    const updatedMessage: FluxerMessage = {
      ...existing,
      content: payload.content !== undefined ? payload.content : existing.content,
      createdAt: existing.createdAt
    };
    this.#messageStore.set(key, updatedMessage);
    return { ...updatedMessage };
  }

  public async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const removed = this.#messageStore.delete(this.#messageKey(channelId, messageId));
    if (!removed) {
      throw new FluxerError("MockTransport could not find the message to delete.", "MOCK_MESSAGE_NOT_FOUND");
    }
  }

  public async injectMessage(message: FluxerMessage): Promise<void> {
    if (!this.#connected) {
      const error = new Error("MockTransport is not connected.");
      await this.emitError(error);
      throw error;
    }

    this.#channels.set(message.channel.id, { ...message.channel });
    await this.emitMessage(message);
  }

  public async injectGatewayDispatch(event: FluxerGatewayDispatchEvent): Promise<void> {
    await this.emitGatewayDispatch(event);
  }

  public async injectGatewayStateChange(event: FluxerGatewayStateChangeEvent): Promise<void> {
    await this.emitGatewayStateChange(event);
  }

  public async injectGatewaySessionUpdate(session: FluxerGatewaySession): Promise<void> {
    await this.emitGatewaySessionUpdate(session);
  }

  public async injectDebug(event: FluxerDebugEvent): Promise<void> {
    await this.emitDebug(event);
  }

  #createStoredMessage(payload: SendMessagePayload): FluxerMessage {
    const messageId = `mock_msg_${this.#nextMessageId}`;
    this.#nextMessageId += 1;

    return {
      id: messageId,
      content: payload.content ?? "",
      author: { ...this.#currentUser },
      channel: {
        id: payload.channelId,
        name: payload.channelId,
        type: "text"
      },
      createdAt: new Date()
    };
  }

  #messageKey(channelId: string, messageId: string): string {
    return `${channelId}:${messageId}`;
  }

  #guildMemberKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }
}

function validatePinnedMessagesOptions(options?: FluxerListPinnedMessagesOptions): void {
  if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50)) {
    throw new FluxerError(
      "MockTransport listPinnedMessages limit must be an integer between 1 and 50.",
      "MOCK_LIST_PINNED_MESSAGES_LIMIT_INVALID"
    );
  }

  if (options?.before !== undefined) {
    void resolvePinnedMessagesBefore(options.before);
  }
}

function resolvePinnedMessagesBefore(before?: string | Date): Date | undefined {
  if (before === undefined) {
    return undefined;
  }

  const resolvedDate = before instanceof Date ? before : new Date(before);
  if (Number.isNaN(resolvedDate.getTime())) {
    throw new FluxerError(
      "MockTransport listPinnedMessages before must be a valid ISO timestamp or Date.",
      "MOCK_LIST_PINNED_MESSAGES_BEFORE_INVALID"
    );
  }

  return resolvedDate;
}
