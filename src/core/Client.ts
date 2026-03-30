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

  public async fetchCurrentUser(): Promise<FluxerUser> {
    this.emitDebug({
      scope: "client",
      event: "fetch_current_user_started",
      level: "debug"
    });

    try {
      const user = await this.#transport.fetchCurrentUser();
      this.emitDebug({
        scope: "client",
        event: "fetch_current_user_succeeded",
        level: "debug",
        data: {
          userId: user.id,
          isBot: user.isBot ?? false
        }
      });
      return user;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Fetch current user failed.");
      this.emitDebug({
        scope: "client",
        event: "fetch_current_user_failed",
        level: "error",
        data: {
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async fetchUser(userId: string): Promise<FluxerUser> {
    this.emitDebug({
      scope: "client",
      event: "fetch_user_started",
      level: "debug",
      data: {
        userId
      }
    });

    try {
      const user = await this.#transport.fetchUser(userId);
      this.emitDebug({
        scope: "client",
        event: "fetch_user_succeeded",
        level: "debug",
        data: {
          userId: user.id,
          isBot: user.isBot ?? false
        }
      });
      return user;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Fetch user failed.");
      this.emitDebug({
        scope: "client",
        event: "fetch_user_failed",
        level: "error",
        data: {
          userId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async fetchInvite(inviteCode: string): Promise<FluxerInvite> {
    this.emitDebug({
      scope: "client",
      event: "fetch_invite_started",
      level: "debug",
      data: {
        inviteCode
      }
    });

    try {
      const invite = await this.#transport.fetchInvite(inviteCode);
      this.emitDebug({
        scope: "client",
        event: "fetch_invite_succeeded",
        level: "debug",
        data: {
          inviteCode: invite.code,
          guildId: invite.guildId,
          channelId: invite.channelId
        }
      });
      return invite;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Fetch invite failed.");
      this.emitDebug({
        scope: "client",
        event: "fetch_invite_failed",
        level: "error",
        data: {
          inviteCode,
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

  public async listGuildChannels(guildId: string): Promise<FluxerChannel[]> {
    this.emitDebug({
      scope: "client",
      event: "list_guild_channels_started",
      level: "debug",
      data: {
        guildId
      }
    });

    try {
      const channels = await this.#transport.listGuildChannels(guildId);
      this.emitDebug({
        scope: "client",
        event: "list_guild_channels_succeeded",
        level: "debug",
        data: {
          guildId,
          count: channels.length
        }
      });
      return channels;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("List guild channels failed.");
      this.emitDebug({
        scope: "client",
        event: "list_guild_channels_failed",
        level: "error",
        data: {
          guildId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async fetchGuildMember(guildId: string, userId: string): Promise<FluxerGuildMember> {
    this.emitDebug({
      scope: "client",
      event: "fetch_guild_member_started",
      level: "debug",
      data: {
        guildId,
        userId
      }
    });

    try {
      const member = await this.#transport.fetchGuildMember(guildId, userId);
      this.emitDebug({
        scope: "client",
        event: "fetch_guild_member_succeeded",
        level: "debug",
        data: {
          guildId,
          userId,
          roleCount: member.roles?.length ?? 0
        }
      });
      return member;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Fetch guild member failed.");
      this.emitDebug({
        scope: "client",
        event: "fetch_guild_member_failed",
        level: "error",
        data: {
          guildId,
          userId,
          message: normalizedError.message
        }
      });
      throw normalizedError;
    }
  }

  public async listGuildRoles(guildId: string): Promise<FluxerRole[]> {
    this.emitDebug({
      scope: "client",
      event: "list_guild_roles_started",
      level: "debug",
      data: {
        guildId
      }
    });

    try {
      const roles = await this.#transport.listGuildRoles(guildId);
      this.emitDebug({
        scope: "client",
        event: "list_guild_roles_succeeded",
        level: "debug",
        data: {
          guildId,
          count: roles.length
        }
      });
      return roles;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("List guild roles failed.");
      this.emitDebug({
        scope: "client",
        event: "list_guild_roles_failed",
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
      case "MESSAGE_CREATE": {
        const message = this.#parseGatewayMessage(event);
        if (message) {
          this.emit("messageCreate", message);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_message_payload");
        }
        return;
      }
      case "MESSAGE_UPDATE": {
        const message = this.#parseGatewayMessage(event);
        if (message) {
          this.emit("messageUpdate", message);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_message_payload");
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
        } else {
          this.#emitIgnoredGatewayDispatch(event, "missing_required_fields");
        }
        return;
      }
      case "MESSAGE_DELETE_BULK": {
        const messageDeleteBulk = this.#parseBulkMessageDelete(event);
        if (messageDeleteBulk) {
          this.emit("messageDeleteBulk", messageDeleteBulk);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_bulk_delete_payload");
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
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_reaction_payload");
        }
        return;
      }
      case "CHANNEL_CREATE":
      case "CHANNEL_UPDATE": {
        const channel = this.#parseGatewayChannel(event);
        if (channel) {
          this.emit(event.type === "CHANNEL_CREATE" ? "channelCreate" : "channelUpdate", channel);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_channel_payload");
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
        } else {
          this.#emitIgnoredGatewayDispatch(event, "missing_required_fields");
        }
        return;
      }
      case "CHANNEL_PINS_UPDATE": {
        const channelPinsUpdate = this.#parseChannelPinsUpdate(event);
        if (channelPinsUpdate) {
          this.emit("channelPinsUpdate", channelPinsUpdate);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_channel_pins_payload");
        }
        return;
      }
      case "GUILD_CREATE":
      case "GUILD_UPDATE": {
        const guild = this.#parseGatewayGuild(event);
        if (guild) {
          this.emit(event.type === "GUILD_CREATE" ? "guildCreate" : "guildUpdate", guild);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_guild_payload");
        }
        return;
      }
      case "GUILD_DELETE": {
        const payload = event.data as { id?: string };
        if (payload.id) {
          this.emit("guildDelete", { id: payload.id });
        } else {
          this.#emitIgnoredGatewayDispatch(event, "missing_required_fields");
        }
        return;
      }
      case "GUILD_ROLE_CREATE":
      case "GUILD_ROLE_UPDATE": {
        const role = this.#parseGatewayRole(event);
        if (role) {
          this.emit(event.type === "GUILD_ROLE_CREATE" ? "roleCreate" : "roleUpdate", role);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_role_payload");
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
        } else {
          this.#emitIgnoredGatewayDispatch(event, "missing_required_fields");
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
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_guild_member_payload");
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
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_guild_member_remove_payload");
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
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_ban_payload");
        }
        return;
      }
      case "INVITE_CREATE":
      case "INVITE_DELETE": {
        const invite = this.#parseGatewayInvite(event);
        if (invite) {
          this.emit(event.type === "INVITE_CREATE" ? "inviteCreate" : "inviteDelete", invite);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_invite_payload");
        }
        return;
      }
      case "PRESENCE_UPDATE": {
        const presence = this.#parseGatewayPresence(event);
        if (presence) {
          this.emit("presenceUpdate", presence);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_presence_payload");
        }
        return;
      }
      case "TYPING_START": {
        const typingStart = this.#parseTypingStart(event);
        if (typingStart) {
          this.emit("typingStart", typingStart);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_typing_payload");
        }
        return;
      }
      case "USER_UPDATE": {
        const user = this.#parseGatewayUser(event.data);
        if (user) {
          this.emit("userUpdate", user);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_user_payload");
        }
        return;
      }
      case "VOICE_STATE_UPDATE": {
        const voiceState = this.#parseVoiceState(event);
        if (voiceState) {
          this.emit("voiceStateUpdate", voiceState);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_voice_state_payload");
        }
        return;
      }
      case "VOICE_SERVER_UPDATE": {
        const voiceServer = this.#parseVoiceServerUpdate(event);
        if (voiceServer) {
          this.emit("voiceServerUpdate", voiceServer);
        } else {
          this.#emitIgnoredGatewayDispatch(event, "invalid_voice_server_payload");
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

  #emitIgnoredGatewayDispatch(
    event: FluxerGatewayDispatchEvent,
    reason: string
  ): void {
    this.emitDebug({
      scope: "client",
      event: "gateway_dispatch_ignored",
      level: "warn",
      data: {
        type: event.type,
        sequence: event.sequence,
        reason
      }
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

    const createdAt = this.#parseOptionalIsoDate(payload.timestamp);
    if (!payload.id || !payload.author?.id || !payload.author.username || !payload.channel_id || !createdAt) {
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
      createdAt
    };
  }

  #parseGatewayChannel(event: FluxerGatewayDispatchEvent): FluxerChannel | null {
    const payload = event.data as { id?: string; name?: string | null; type?: number | string };
    if (!payload.id || payload.type === undefined) {
      return null;
    }

    return {
      id: payload.id,
      name: payload.name ?? payload.id,
      type: this.#normalizeChannelType(payload.type)
    };
  }

  #normalizeChannelType(type: number | string): FluxerChannel["type"] {
    if (type === 1 || type === "dm") {
      return "dm";
    }

    if (type === 3 || type === "group") {
      return "group";
    }

    return "text";
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
      guild_id?: unknown;
      role?: {
        id?: unknown;
        name?: unknown;
        color?: unknown;
        position?: unknown;
        permissions?: unknown;
      };
    };

    const color = this.#parseOptionalNumber(payload.role?.color);
    const position = this.#parseOptionalNumber(payload.role?.position);
    const permissions = this.#parseOptionalString(payload.role?.permissions);
    if (
      typeof payload.guild_id !== "string"
      || typeof payload.role?.id !== "string"
      || typeof payload.role.name !== "string"
      || color === null
      || position === null
      || permissions === null
    ) {
      return null;
    }

    return {
      id: payload.role.id,
      guildId: payload.guild_id,
      name: payload.role.name,
      color,
      position,
      permissions
    };
  }

  #parseGatewayGuildMember(event: FluxerGatewayDispatchEvent): FluxerGuildMember | null {
    const payload = event.data as {
      guild_id?: string;
      nick?: unknown;
      roles?: unknown;
      joined_at?: string;
      user?: { id?: string; username?: string; global_name?: string; bot?: boolean };
    };

    const user = this.#parseGatewayUser(payload.user);
    const nickname = this.#parseOptionalString(payload.nick);
    const roles = this.#parseOptionalStringArray(payload.roles);
    const joinedAt = this.#parseOptionalIsoDate(payload.joined_at);
    if (!payload.guild_id || !user || nickname === null || roles === null || joinedAt === null) {
      return null;
    }

    return {
      user,
      guildId: payload.guild_id,
      nickname,
      roles,
      joinedAt
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

    const startedAt = this.#parseOptionalUnixDate(payload.timestamp);
    if (!payload.channel_id || !payload.user_id || startedAt === null) {
      return null;
    }

    return {
      channelId: payload.channel_id,
      userId: payload.user_id,
      guildId: payload.guild_id,
      startedAt
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

    const lastPinTimestamp = this.#parseOptionalIsoDate(payload.last_pin_timestamp);
    if (!payload.channel_id || lastPinTimestamp === null) {
      return null;
    }

    return {
      channelId: payload.channel_id,
      guildId: payload.guild_id,
      lastPinTimestamp
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
      code?: unknown;
      channel_id?: unknown;
      guild_id?: unknown;
      inviter?: { id?: string; username?: string; global_name?: string; bot?: boolean };
      uses?: unknown;
      max_uses?: unknown;
      max_age?: unknown;
      temporary?: unknown;
      created_at?: string;
      expires_at?: string | null;
    };

    const channelId = this.#parseOptionalString(payload.channel_id);
    const guildId = this.#parseOptionalString(payload.guild_id);
    const uses = this.#parseOptionalNumber(payload.uses);
    const maxUses = this.#parseOptionalNumber(payload.max_uses);
    const maxAgeSeconds = this.#parseOptionalNumber(payload.max_age);
    const temporary = this.#parseOptionalBoolean(payload.temporary);
    const createdAt = this.#parseOptionalIsoDate(payload.created_at);
    const expiresAt = this.#parseOptionalIsoDate(payload.expires_at);
    if (
      typeof payload.code !== "string"
      || channelId === null
      || guildId === null
      || uses === null
      || maxUses === null
      || maxAgeSeconds === null
      || temporary === null
      || createdAt === null
      || expiresAt === null
    ) {
      return null;
    }

    return {
      code: payload.code,
      channelId,
      guildId,
      inviter: this.#parseGatewayUser(payload.inviter) ?? undefined,
      uses,
      maxUses,
      maxAgeSeconds,
      temporary,
      createdAt,
      expiresAt
    };
  }

  #parseOptionalIsoDate(value: string | null | undefined): Date | undefined | null {
    if (value === undefined || value === null) {
      return undefined;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  #parseOptionalUnixDate(value: number | undefined): Date | undefined | null {
    if (value === undefined) {
      return undefined;
    }

    if (!Number.isFinite(value)) {
      return null;
    }

    const parsed = new Date(value * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  #parseOptionalString(value: unknown): string | undefined | null {
    if (value === undefined || value === null) {
      return undefined;
    }

    return typeof value === "string" ? value : null;
  }

  #parseOptionalStringArray(value: unknown): string[] | undefined | null {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      return null;
    }

    return [...value];
  }

  #parseOptionalNumber(value: unknown): number | undefined | null {
    if (value === undefined || value === null) {
      return undefined;
    }

    return typeof value === "number" ? value : null;
  }

  #parseOptionalBoolean(value: unknown): boolean | undefined | null {
    if (value === undefined || value === null) {
      return undefined;
    }

    return typeof value === "boolean" ? value : null;
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
