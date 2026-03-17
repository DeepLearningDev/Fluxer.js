import { EventEmitter } from "node:events";
import { resolveMessagePayload } from "./builders.js";
import type { FluxerBot } from "./Bot.js";
import type {
  FluxerChannel,
  FluxerEventMap,
  FluxerGatewayDispatchEvent,
  FluxerGuild,
  FluxerMessage,
  FluxerTransport,
  MessageBuilderLike,
  SendMessagePayload
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
  }

  public async connect(): Promise<void> {
    await this.#transport.connect();
    this.#connected = true;
    this.emit("ready", { connectedAt: new Date() } satisfies FluxerEventMap["ready"]);
  }

  public async disconnect(): Promise<void> {
    await this.#transport.disconnect();
    this.#connected = false;
  }

  public isConnected(): boolean {
    return this.#connected;
  }

  public registerBot(bot: FluxerBot): void {
    this.#bots.add(bot);
    bot.attach(this);
  }

  public async sendMessage(
    channelId: string,
    message: string | Omit<SendMessagePayload, "channelId"> | MessageBuilderLike
  ): Promise<void> {
    await this.#transport.sendMessage({
      channelId,
      ...resolveMessagePayload(message)
    });
  }

  public async receiveMessage(message: FluxerMessage): Promise<void> {
    this.emit("messageCreate", message);

    for (const bot of this.#bots) {
      await bot.handleMessage(message);
    }
  }

  public async receiveGatewayDispatch(event: FluxerGatewayDispatchEvent): Promise<void> {
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
}
