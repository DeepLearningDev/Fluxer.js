import { EventEmitter } from "node:events";
import { resolveMessagePayload } from "./builders.js";
import { FluxerMessageCollector, waitForEvent, waitForMessage } from "./Collectors.js";
import type { FluxerBot } from "./Bot.js";
import type {
  EditMessagePayload,
  FluxerBulkMessageDeleteEvent,
  FluxerChannel,
  FluxerChannelPinsUpdateEvent,
  FluxerDebugEvent,
  FluxerEventMap,
  FluxerGatewayDispatchEvent,
  FluxerGuild,
  FluxerGuildMember,
  FluxerInvite,
  FluxerListPinnedMessagesOptions,
  FluxerListMessagesOptions,
  FluxerMessage,
  FluxerMessageAwaitOptions,
  FluxerMessageCollectorOptions,
  FluxerPinnedMessageList,
  FluxerPresence,
  FluxerReactionEvent,
  FluxerRole,
  FluxerTransport,
  FluxerMessageInput,
  FluxerTypingStartEvent,
  FluxerUser,
  FluxerVoiceServerUpdate,
  FluxerVoiceState
} from "./types.js";
import { MockTransport } from "./MockTransport.js";

type EventKey = keyof FluxerEventMap;

export class FluxerClient extends EventEmitter {
  #connected = false;
  #bots = new Set<FluxerBot>();
  #transport: FluxerTransport;

  public constructor(transport: FluxerTransport = new MockTransport()) {
    super();
    this.#transport = transport;
    this.#transport.onMessage(async (message) => {
      await this.receiveMessage(message);
    });
    this.#transport.onError(async (error) => {
      this.emit("error", error);
    });
    this.#transport.onGatewayDispatch(async (event) => {
      await this.receiveGatewayDispatch(event);
    });
    this.#transport.onGatewayStateChange(async (event) => {
      this.emit("gatewayStateChange", event);
    });
    this.#transport.onGatewaySessionUpdate(async (session) => {
      this.emit("gatewaySessionUpdate", session);
    });
    this.#transport.onDebug(async (event) => {
      this.emit("debug", event);
    });
  }

  public async connect(): Promise<void> {
    this.emitDebug({
      scope: "client",
      event: "connect_started",
      level: "info"
    });
    try {
      await this.#transport.connect();
      this.#connected = true;
      this.emitDebug({
        scope: "client",
        event: "connect_succeeded",
        level: "info"
      });
      this.emit("ready", { connectedAt: new Date() } satisfies FluxerEventMap["ready"]);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Client connect failed.");
      this.emitDebug({
        scope: "client",
        event: "connect_failed",
        level: "error",
        data: {
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async disconnect(): Promise<void> {
    this.emitDebug({
      scope: "client",
      event: "disconnect_started",
      level: "info"
    });
    await this.#transport.disconnect();
    this.#connected = false;
    this.emitDebug({
      scope: "client",
      event: "disconnect_succeeded",
      level: "info"
    });
  }

  public isConnected(): boolean {
    return this.#connected;
  }

  public waitFor<E extends EventKey>(
    eventName: E,
    options?: {
      filter?: (payload: FluxerEventMap[E]) => boolean | Promise<boolean>;
      timeoutMs?: number;
      signal?: AbortSignal;
    }
  ): Promise<FluxerEventMap[E]> {
    this.emitDebug({
      scope: "client",
      event: "wait_for_started",
      level: "debug",
      data: {
        eventName: String(eventName),
        timeoutMs: options?.timeoutMs
      }
    });

    return waitForEvent(this, eventName, options)
      .then((payload) => {
        this.emitDebug({
          scope: "client",
          event: "wait_for_resolved",
          level: "debug",
          data: {
            eventName: String(eventName)
          }
        });
        return payload;
      })
      .catch((error) => {
        this.emitDebug({
          scope: "client",
          event: "wait_for_failed",
          level: "warn",
          data: {
            eventName: String(eventName),
            message: error instanceof Error ? error.message : "Unknown waitFor error."
          }
        });
        throw error;
      });
  }

  public waitForMessage(options?: FluxerMessageAwaitOptions): Promise<FluxerMessage> {
    return waitForMessage(this, options);
  }

  public createMessageCollector(options?: FluxerMessageCollectorOptions): FluxerMessageCollector {
    this.emitDebug({
      scope: "client",
      event: "message_collector_started",
      level: "debug",
      data: {
        timeoutMs: options?.timeoutMs,
        idleMs: options?.idleMs,
        max: options?.max
      }
    });

    const collector = new FluxerMessageCollector(this, options);
    collector.once("end", ({ reason, collected }) => {
      this.emitDebug({
        scope: "client",
        event: "message_collector_finished",
        level: "debug",
        data: {
          reason,
          collected: collected.length
        }
      });
    });
    return collector;
  }

  public registerBot(bot: FluxerBot): void {
    this.#bots.add(bot);
    bot.attach(this);
    this.emitDebug({
      scope: "client",
      event: "bot_registered",
      level: "info",
      data: {
        name: bot.name
      }
    });
  }

  public async sendMessage(
    channelId: string,
    message: FluxerMessageInput
  ): Promise<void> {
    const payload = {
      channelId,
      ...resolveMessagePayload(message)
    };
    this.emitDebug({
      scope: "client",
      event: "send_message_started",
      level: "debug",
      data: {
        channelId,
        hasContent: typeof payload.content === "string" && payload.content.length > 0,
        embedCount: payload.embeds?.length ?? 0,
        attachmentCount: payload.attachments?.length ?? 0
      }
    });

    try {
      await this.#transport.sendMessage(payload);
      this.emitDebug({
        scope: "client",
        event: "send_message_succeeded",
        level: "debug",
        data: {
          channelId
        }
      });
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Send message failed.");
      this.emitDebug({
        scope: "client",
        event: "send_message_failed",
        level: "error",
        data: {
          channelId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async indicateTyping(channelId: string): Promise<void> {
    this.emitDebug({
      scope: "client",
      event: "indicate_typing_started",
      level: "debug",
      data: {
        channelId
      }
    });

    try {
      await this.#transport.indicateTyping(channelId);
      this.emitDebug({
        scope: "client",
        event: "indicate_typing_succeeded",
        level: "debug",
        data: {
          channelId
        }
      });
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Indicate typing failed.");
      this.emitDebug({
        scope: "client",
        event: "indicate_typing_failed",
        level: "error",
        data: {
          channelId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async fetchChannel(channelId: string): Promise<FluxerChannel> {
    this.emitDebug({
      scope: "client",
      event: "fetch_channel_started",
      level: "debug",
      data: {
        channelId
      }
    });

    try {
      const channel = await this.#transport.fetchChannel(channelId);
      this.emitDebug({
        scope: "client",
        event: "fetch_channel_succeeded",
        level: "debug",
        data: {
          channelId,
          type: channel.type
        }
      });
      return channel;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Fetch channel failed.");
      this.emitDebug({
        scope: "client",
        event: "fetch_channel_failed",
        level: "error",
        data: {
          channelId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async fetchGuild(guildId: string): Promise<FluxerGuild> {
    this.emitDebug({
      scope: "client",
      event: "fetch_guild_started",
      level: "debug",
      data: {
        guildId
      }
    });

    try {
      const guild = await this.#transport.fetchGuild(guildId);
      this.emitDebug({
        scope: "client",
        event: "fetch_guild_succeeded",
        level: "debug",
        data: {
          guildId,
          name: guild.name
        }
      });
      return guild;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Fetch guild failed.");
      this.emitDebug({
        scope: "client",
        event: "fetch_guild_failed",
        level: "error",
        data: {
          guildId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async listPinnedMessages(
    channelId: string,
    options?: FluxerListPinnedMessagesOptions
  ): Promise<FluxerPinnedMessageList> {
    this.emitDebug({
      scope: "client",
      event: "list_pinned_messages_started",
      level: "debug",
      data: {
        channelId,
        limit: options?.limit,
        before: options?.before instanceof Date ? options.before.toISOString() : options?.before
      }
    });

    try {
      const pinnedMessages = await this.#transport.listPinnedMessages(channelId, options);
      this.emitDebug({
        scope: "client",
        event: "list_pinned_messages_succeeded",
        level: "debug",
        data: {
          channelId,
          count: pinnedMessages.items.length,
          hasMore: pinnedMessages.hasMore
        }
      });
      return pinnedMessages;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("List pinned messages failed.");
      this.emitDebug({
        scope: "client",
        event: "list_pinned_messages_failed",
        level: "error",
        data: {
          channelId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async listMessages(channelId: string, options?: FluxerListMessagesOptions): Promise<FluxerMessage[]> {
    this.emitDebug({
      scope: "client",
      event: "list_messages_started",
      level: "debug",
      data: {
        channelId,
        ...options
      }
    });

    try {
      const messages = await this.#transport.listMessages(channelId, options);
      this.emitDebug({
        scope: "client",
        event: "list_messages_succeeded",
        level: "debug",
        data: {
          channelId,
          count: messages.length
        }
      });
      return messages;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("List messages failed.");
      this.emitDebug({
        scope: "client",
        event: "list_messages_failed",
        level: "error",
        data: {
          channelId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async fetchMessage(channelId: string, messageId: string): Promise<FluxerMessage> {
    this.emitDebug({
      scope: "client",
      event: "fetch_message_started",
      level: "debug",
      data: {
        channelId,
        messageId
      }
    });

    try {
      const message = await this.#transport.fetchMessage(channelId, messageId);
      this.emitDebug({
        scope: "client",
        event: "fetch_message_succeeded",
        level: "debug",
        data: {
          channelId,
          messageId
        }
      });
      return message;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Fetch message failed.");
      this.emitDebug({
        scope: "client",
        event: "fetch_message_failed",
        level: "error",
        data: {
          channelId,
          messageId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async editMessage(
    channelId: string,
    messageId: string,
    message: FluxerMessageInput
  ): Promise<FluxerMessage> {
    const payload: EditMessagePayload = resolveMessagePayload(message);
    this.emitDebug({
      scope: "client",
      event: "edit_message_started",
      level: "debug",
      data: {
        channelId,
        messageId,
        hasContent: typeof payload.content === "string" && payload.content.length > 0,
        embedCount: payload.embeds?.length ?? 0,
        attachmentCount: payload.attachments?.length ?? 0
      }
    });

    try {
      const updatedMessage = await this.#transport.editMessage(channelId, messageId, payload);
      this.emitDebug({
        scope: "client",
        event: "edit_message_succeeded",
        level: "debug",
        data: {
          channelId,
          messageId
        }
      });
      return updatedMessage;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Edit message failed.");
      this.emitDebug({
        scope: "client",
        event: "edit_message_failed",
        level: "error",
        data: {
          channelId,
          messageId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async deleteMessage(channelId: string, messageId: string): Promise<void> {
    this.emitDebug({
      scope: "client",
      event: "delete_message_started",
      level: "debug",
      data: {
        channelId,
        messageId
      }
    });

    try {
      await this.#transport.deleteMessage(channelId, messageId);
      this.emitDebug({
        scope: "client",
        event: "delete_message_succeeded",
        level: "debug",
        data: {
          channelId,
          messageId
        }
      });
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Delete message failed.");
      this.emitDebug({
        scope: "client",
        event: "delete_message_failed",
        level: "error",
        data: {
          channelId,
          messageId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async receiveMessage(message: FluxerMessage): Promise<void> {
    this.emitDebug({
      scope: "client",
      event: "message_received",
      level: "debug",
      data: {
        id: message.id,
        authorId: message.author.id,
        channelId: message.channel.id
      }
    });
    this.emit("messageCreate", message);

    for (const bot of this.#bots) {
      await bot.handleMessage(message);
    }
  }

  public async receiveGatewayDispatch(event: FluxerGatewayDispatchEvent): Promise<void> {
    this.emitDebug({
      scope: "client",
      event: "gateway_dispatch_received",
      level: "debug",
      data: {
        type: event.type,
        sequence: event.sequence
      }
    });
    this.emit("gatewayDispatch", event);

    switch (event.type) {
      case "READY":
        return;
      case "MESSAGE_UPDATE": {
        const message = this.#parseGatewayMessage(event);
        if (message) {
          this.emit("messageUpdate", message);
        }
        return;
      }
      case "MESSAGE_DELETE": {
        const payload = event.data as { id?: string; channel_id?: string; guild_id?: string };
        if (payload.id && payload.channel_id) {
          this.emit("messageDelete", {
            id: payload.id,
            channelId: payload.channel_id,
            guildId: payload.guild_id
          });
        }
        return;
      }
      case "MESSAGE_DELETE_BULK": {
        const messageDeleteBulk = this.#parseBulkMessageDelete(event);
        if (messageDeleteBulk) {
          this.emit("messageDeleteBulk", messageDeleteBulk);
        }
        return;
      }
      case "MESSAGE_REACTION_ADD":
      case "MESSAGE_REACTION_REMOVE": {
        const reaction = this.#parseGatewayReaction(event);
        if (reaction) {
          this.emit(
            event.type === "MESSAGE_REACTION_ADD"
              ? "messageReactionAdd"
              : "messageReactionRemove",
            reaction
          );
        }
        return;
      }
      case "CHANNEL_CREATE":
      case "CHANNEL_UPDATE": {
        const channel = this.#parseGatewayChannel(event);
        if (channel) {
          this.emit(event.type === "CHANNEL_CREATE" ? "channelCreate" : "channelUpdate", channel);
        }
        return;
      }
      case "CHANNEL_DELETE": {
        const payload = event.data as { id?: string; guild_id?: string };
        if (payload.id) {
          this.emit("channelDelete", {
            id: payload.id,
            guildId: payload.guild_id
          });
        }
        return;
      }
      case "CHANNEL_PINS_UPDATE": {
        const channelPinsUpdate = this.#parseChannelPinsUpdate(event);
        if (channelPinsUpdate) {
          this.emit("channelPinsUpdate", channelPinsUpdate);
        }
        return;
      }
      case "GUILD_CREATE":
      case "GUILD_UPDATE": {
        const guild = this.#parseGatewayGuild(event);
        if (guild) {
          this.emit(event.type === "GUILD_CREATE" ? "guildCreate" : "guildUpdate", guild);
        }
        return;
      }
      case "GUILD_DELETE": {
        const payload = event.data as { id?: string };
        if (payload.id) {
          this.emit("guildDelete", { id: payload.id });
        }
        return;
      }
      case "GUILD_ROLE_CREATE":
      case "GUILD_ROLE_UPDATE": {
        const role = this.#parseGatewayRole(event);
        if (role) {
          this.emit(event.type === "GUILD_ROLE_CREATE" ? "roleCreate" : "roleUpdate", role);
        }
        return;
      }
      case "GUILD_ROLE_DELETE": {
        const payload = event.data as { guild_id?: string; role_id?: string };
        if (payload.guild_id && payload.role_id) {
          this.emit("roleDelete", {
            guildId: payload.guild_id,
            id: payload.role_id
          });
        }
        return;
      }
      case "GUILD_MEMBER_ADD":
      case "GUILD_MEMBER_UPDATE": {
        const member = this.#parseGatewayGuildMember(event);
        if (member) {
          this.emit(
            event.type === "GUILD_MEMBER_ADD" ? "guildMemberAdd" : "guildMemberUpdate",
            member
          );
        }
        return;
      }
      case "GUILD_MEMBER_REMOVE": {
        const payload = event.data as {
          guild_id?: string;
          user?: { id?: string; username?: string; global_name?: string; bot?: boolean };
        };
        const user = this.#parseGatewayUser(payload.user);
        if (payload.guild_id && user) {
          this.emit("guildMemberRemove", {
            guildId: payload.guild_id,
            user
          });
        }
        return;
      }
      case "GUILD_BAN_ADD":
      case "GUILD_BAN_REMOVE": {
        const payload = event.data as {
          guild_id?: string;
          user?: { id?: string; username?: string; global_name?: string; bot?: boolean };
        };
        const user = this.#parseGatewayUser(payload.user);
        if (payload.guild_id && user) {
          this.emit(event.type === "GUILD_BAN_ADD" ? "guildBanAdd" : "guildBanRemove", {
            guildId: payload.guild_id,
            user
          });
        }
        return;
      }
      case "INVITE_CREATE":
      case "INVITE_DELETE": {
        const invite = this.#parseGatewayInvite(event);
        if (invite) {
          this.emit(event.type === "INVITE_CREATE" ? "inviteCreate" : "inviteDelete", invite);
        }
        return;
      }
      case "PRESENCE_UPDATE": {
        const presence = this.#parseGatewayPresence(event);
        if (presence) {
          this.emit("presenceUpdate", presence);
        }
        return;
      }
      case "TYPING_START": {
        const typingStart = this.#parseTypingStart(event);
        if (typingStart) {
          this.emit("typingStart", typingStart);
        }
        return;
      }
      case "USER_UPDATE": {
        const user = this.#parseGatewayUser(event.data);
        if (user) {
          this.emit("userUpdate", user);
        }
        return;
      }
      case "VOICE_STATE_UPDATE": {
        const voiceState = this.#parseVoiceState(event);
        if (voiceState) {
          this.emit("voiceStateUpdate", voiceState);
        }
        return;
      }
      case "VOICE_SERVER_UPDATE": {
        const voiceServer = this.#parseVoiceServerUpdate(event);
        if (voiceServer) {
          this.emit("voiceServerUpdate", voiceServer);
        }
        return;
      }
      default:
        return;
    }
  }

  public override on<E extends EventKey>(
    eventName: E,
    listener: (payload: FluxerEventMap[E]) => void,
  ): this {
    return super.on(eventName, listener);
  }

  public override emit<E extends EventKey>(eventName: E, payload: FluxerEventMap[E]): boolean {
    return super.emit(eventName, payload);
  }

  public emitDebug(event: Omit<FluxerDebugEvent, "timestamp"> & { timestamp?: string }): void {
    this.emit("debug", {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString()
    });
  }

  #parseGatewayMessage(event: FluxerGatewayDispatchEvent): FluxerMessage | null {
    const payload = event.data as {
      id?: string;
      content?: string;
      author?: { id?: string; username?: string; global_name?: string; bot?: boolean };
      channel_id?: string;
      timestamp?: string;
    };

    if (!payload.id || !payload.author?.id || !payload.author.username || !payload.channel_id) {
      return null;
    }

    return {
      id: payload.id,
      content: payload.content ?? "",
      author: {
        id: payload.author.id,
        username: payload.author.username,
        displayName: payload.author.global_name,
        isBot: payload.author.bot
      },
      channel: {
        id: payload.channel_id,
        name: payload.channel_id,
        type: "text"
      },
      createdAt: new Date(payload.timestamp ?? Date.now())
    };
  }

  #parseGatewayChannel(event: FluxerGatewayDispatchEvent): FluxerChannel | null {
    const payload = event.data as { id?: string; name?: string; type?: FluxerChannel["type"] };
    if (!payload.id || !payload.name || !payload.type) {
      return null;
    }

    return {
      id: payload.id,
      name: payload.name,
      type: payload.type
    };
  }

  #parseGatewayGuild(event: FluxerGatewayDispatchEvent): FluxerGuild | null {
    const payload = event.data as { id?: string; name?: string; icon?: string };
    if (!payload.id || !payload.name) {
      return null;
    }

    return {
      id: payload.id,
      name: payload.name,
      iconUrl: payload.icon
    };
  }

  #parseGatewayRole(event: FluxerGatewayDispatchEvent): FluxerRole | null {
    const payload = event.data as {
      guild_id?: string;
      role?: {
        id?: string;
        name?: string;
        color?: number;
        position?: number;
        permissions?: string;
      };
    };

    if (!payload.guild_id || !payload.role?.id || !payload.role.name) {
      return null;
    }

    return {
      id: payload.role.id,
      guildId: payload.guild_id,
      name: payload.role.name,
      color: payload.role.color,
      position: payload.role.position,
      permissions: payload.role.permissions
    };
  }

  #parseGatewayGuildMember(event: FluxerGatewayDispatchEvent): FluxerGuildMember | null {
    const payload = event.data as {
      guild_id?: string;
      nick?: string;
      roles?: string[];
      joined_at?: string;
      user?: { id?: string; username?: string; global_name?: string; bot?: boolean };
    };

    const user = this.#parseGatewayUser(payload.user);
    if (!payload.guild_id || !user) {
      return null;
    }

    return {
      user,
      guildId: payload.guild_id,
      nickname: payload.nick,
      roles: payload.roles,
      joinedAt: payload.joined_at ? new Date(payload.joined_at) : undefined
    };
  }

  #parseGatewayPresence(event: FluxerGatewayDispatchEvent): FluxerPresence | null {
    const payload = event.data as {
      user?: { id?: string };
      status?: FluxerPresence["status"];
      activities?: Array<{ name?: string; type?: number }>;
    };

    if (!payload.user?.id || !payload.status) {
      return null;
    }

    return {
      userId: payload.user.id,
      status: payload.status,
      activities: payload.activities
        ?.filter((activity): activity is { name: string; type?: number } => typeof activity.name === "string")
        .map((activity) => ({
          name: activity.name,
          type: activity.type
        }))
    };
  }

  #parseTypingStart(event: FluxerGatewayDispatchEvent): FluxerTypingStartEvent | null {
    const payload = event.data as {
      channel_id?: string;
      user_id?: string;
      guild_id?: string;
      timestamp?: number;
    };

    if (!payload.channel_id || !payload.user_id) {
      return null;
    }

    return {
      channelId: payload.channel_id,
      userId: payload.user_id,
      guildId: payload.guild_id,
      startedAt: typeof payload.timestamp === "number" ? new Date(payload.timestamp * 1000) : undefined
    };
  }

  #parseGatewayReaction(event: FluxerGatewayDispatchEvent): FluxerReactionEvent | null {
    const payload = event.data as {
      user_id?: string;
      channel_id?: string;
      message_id?: string;
      guild_id?: string;
      emoji?: { id?: string; name?: string; animated?: boolean };
    };

    if (!payload.user_id || !payload.channel_id || !payload.message_id || !payload.emoji) {
      return null;
    }

    return {
      userId: payload.user_id,
      channelId: payload.channel_id,
      messageId: payload.message_id,
      guildId: payload.guild_id,
      emoji: {
        id: payload.emoji.id,
        name: payload.emoji.name,
        animated: payload.emoji.animated
      }
    };
  }

  #parseBulkMessageDelete(event: FluxerGatewayDispatchEvent): FluxerBulkMessageDeleteEvent | null {
    const payload = event.data as {
      ids?: string[];
      channel_id?: string;
      guild_id?: string;
    };

    if (!Array.isArray(payload.ids) || payload.ids.length === 0 || !payload.channel_id) {
      return null;
    }

    const ids = payload.ids.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === 0) {
      return null;
    }

    return {
      ids,
      channelId: payload.channel_id,
      guildId: payload.guild_id
    };
  }

  #parseChannelPinsUpdate(event: FluxerGatewayDispatchEvent): FluxerChannelPinsUpdateEvent | null {
    const payload = event.data as {
      channel_id?: string;
      guild_id?: string;
      last_pin_timestamp?: string | null;
    };

    if (!payload.channel_id) {
      return null;
    }

    return {
      channelId: payload.channel_id,
      guildId: payload.guild_id,
      lastPinTimestamp: payload.last_pin_timestamp ? new Date(payload.last_pin_timestamp) : undefined
    };
  }

  #parseVoiceState(event: FluxerGatewayDispatchEvent): FluxerVoiceState | null {
    const payload = event.data as {
      guild_id?: string;
      channel_id?: string | null;
      user_id?: string;
      session_id?: string;
      deaf?: boolean;
      mute?: boolean;
      self_deaf?: boolean;
      self_mute?: boolean;
      self_stream?: boolean;
      self_video?: boolean;
      suppress?: boolean;
    };

    if (!payload.user_id || !payload.session_id) {
      return null;
    }

    return {
      guildId: payload.guild_id,
      channelId: payload.channel_id ?? undefined,
      userId: payload.user_id,
      sessionId: payload.session_id,
      deaf: payload.deaf,
      mute: payload.mute,
      selfDeaf: payload.self_deaf,
      selfMute: payload.self_mute,
      selfStream: payload.self_stream,
      selfVideo: payload.self_video,
      suppress: payload.suppress
    };
  }

  #parseVoiceServerUpdate(event: FluxerGatewayDispatchEvent): FluxerVoiceServerUpdate | null {
    const payload = event.data as {
      guild_id?: string;
      token?: string;
      endpoint?: string | null;
    };

    if (!payload.guild_id || !payload.token) {
      return null;
    }

    return {
      guildId: payload.guild_id,
      token: payload.token,
      endpoint: payload.endpoint ?? undefined
    };
  }

  #parseGatewayInvite(event: FluxerGatewayDispatchEvent): FluxerInvite | null {
    const payload = event.data as {
      code?: string;
      channel_id?: string;
      guild_id?: string;
      inviter?: { id?: string; username?: string; global_name?: string; bot?: boolean };
      uses?: number;
      max_uses?: number;
      max_age?: number;
      temporary?: boolean;
      created_at?: string;
      expires_at?: string | null;
    };

    if (!payload.code) {
      return null;
    }

    return {
      code: payload.code,
      channelId: payload.channel_id,
      guildId: payload.guild_id,
      inviter: this.#parseGatewayUser(payload.inviter) ?? undefined,
      uses: payload.uses,
      maxUses: payload.max_uses,
      maxAgeSeconds: payload.max_age,
      temporary: payload.temporary,
      createdAt: payload.created_at ? new Date(payload.created_at) : undefined,
      expiresAt: payload.expires_at ? new Date(payload.expires_at) : undefined
    };
  }

  #parseGatewayUser(payload: unknown): FluxerUser | null {
    const user = payload as {
      id?: string;
      username?: string;
      global_name?: string;
      bot?: boolean;
    };

    if (!user?.id || !user.username) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.global_name,
      isBot: user.bot
    };
  }
}
