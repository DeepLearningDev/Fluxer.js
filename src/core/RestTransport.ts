import { createBotAuthHeader, fetchInstanceDiscoveryDocument, normalizeBaseUrl } from "./Discovery.js";
import { serializeMessagePayload, validateMessagePayload } from "./builders.js";
import { RestTransportError } from "./errors.js";
import { resolveBotApiBaseUrl } from "./Instance.js";
import { BaseTransport } from "./Transport.js";
import type {
  EditMessagePayload,
  FluxerAttachment,
  FluxerChannel,
  FluxerGuild,
  FluxerGuildMember,
  FluxerInvite,
  FluxerListPinnedMessagesOptions,
  FluxerInstanceDiscoveryDocument,
  FluxerListMessagesOptions,
  FluxerMessage,
  FluxerPinnedMessageList,
  FluxerRole,
  FluxerRestTransportOptions,
  FluxerSerializedMessagePayload,
  FluxerUser,
  SendMessagePayload
} from "./types.js";

export class RestTransport extends BaseTransport {
  #baseUrl?: string;
  #baseUrlPromise?: Promise<string>;
  readonly #instanceUrl?: string;
  readonly #auth?: FluxerRestTransportOptions["auth"];
  readonly #fetchImpl: typeof fetch;
  readonly #discovery?: FluxerInstanceDiscoveryDocument;
  readonly #sendMessagePath: NonNullable<FluxerRestTransportOptions["sendMessagePath"]>;
  readonly #headers: Record<string, string>;
  readonly #userAgent?: string;

  public constructor(options: FluxerRestTransportOptions) {
    super();
    this.#baseUrl = options.baseUrl ? normalizeBaseUrl(options.baseUrl) : undefined;
    this.#instanceUrl = options.instanceUrl;
    this.#auth = options.auth;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#discovery = options.discovery;
    this.#sendMessagePath = options.sendMessagePath ?? ((channelId) => `/channels/${channelId}/messages`);
    this.#headers = options.headers ?? {};
    this.#userAgent = options.userAgent;
  }

  public async connect(): Promise<void> {
    await this.#ensureBaseUrl();
  }

  public async disconnect(): Promise<void> {
    return Promise.resolve();
  }

  public async sendMessage(payload: SendMessagePayload): Promise<void> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1${this.#sendMessagePath(payload.channelId)}`;
    validateMessagePayload(payload);
    const serializedPayload = serializeMessagePayload(payload);
    const hasAttachments = (payload.attachments?.length ?? 0) > 0;
    const requestBody = hasAttachments
      ? createMultipartRequestBody(payload, serializedPayload)
      : JSON.stringify(serializedPayload);

    let response: Response;
    try {
      response = await this.#fetchImpl(
        requestUrl,
        {
          method: "POST",
          headers: createRequestHeaders({
            headers: this.#headers,
            authHeader: this.#createAuthHeader(),
            userAgent: this.#userAgent,
            hasAttachments
          }),
          body: requestBody
        }
      );
    } catch (error) {
      throw createRequestFailedError({
        method: "POST",
        url: requestUrl,
        channelId: payload.channelId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "POST",
        url: requestUrl,
        channelId: payload.channelId
      });
    }
  }

  public async fetchCurrentUser(): Promise<FluxerUser> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/users/@me`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl
      });
    }

    return parseRestUser(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl
    });
  }

  public async fetchUser(userId: string): Promise<FluxerUser> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/users/${userId}`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        userId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl,
        userId
      });
    }

    return parseRestUser(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl,
      userId
    });
  }

  public async fetchInvite(inviteCode: string): Promise<FluxerInvite> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/invites/${inviteCode}`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        inviteCode,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl,
        inviteCode
      });
    }

    return parseRestInvite(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl,
      inviteCode
    });
  }

  public async indicateTyping(channelId: string): Promise<void> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/channels/${channelId}/typing`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "POST",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "POST",
        url: requestUrl,
        channelId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "POST",
        url: requestUrl,
        channelId
      });
    }
  }

  public async fetchChannel(channelId: string): Promise<FluxerChannel> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/channels/${channelId}`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        channelId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl,
        channelId
      });
    }

    return parseRestChannel(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl,
      channelId
    });
  }

  public async fetchGuild(guildId: string): Promise<FluxerGuild> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/guilds/${guildId}`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        guildId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl,
        guildId
      });
    }

    return parseRestGuild(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl,
      guildId
    });
  }

  public async listGuildChannels(guildId: string): Promise<FluxerChannel[]> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/guilds/${guildId}/channels`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        guildId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl,
        guildId
      });
    }

    return parseRestChannelList(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl,
      guildId
    });
  }

  public async fetchGuildMember(guildId: string, userId: string): Promise<FluxerGuildMember> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/guilds/${guildId}/members/${userId}`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        guildId,
        userId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl,
        guildId,
        userId
      });
    }

    return parseRestGuildMember(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl,
      guildId,
      userId
    });
  }

  public async listGuildRoles(guildId: string): Promise<FluxerRole[]> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/guilds/${guildId}/roles`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        guildId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl,
        guildId
      });
    }

    return parseRestRoleList(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl,
      guildId
    });
  }

  public async listPinnedMessages(
    channelId: string,
    options?: FluxerListPinnedMessagesOptions
  ): Promise<FluxerPinnedMessageList> {
    validateListPinnedMessagesOptions(options);
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = createPinnedMessagesUrl(baseUrl, channelId, options);

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        channelId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl,
        channelId
      });
    }

    return parseRestPinnedMessageList(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl,
      channelId
    });
  }

  public async listMessages(channelId: string, options?: FluxerListMessagesOptions): Promise<FluxerMessage[]> {
    validateListMessagesOptions(options);
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = createMessageListUrl(baseUrl, channelId, options);

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        channelId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl,
        channelId
      });
    }

    return parseRestMessageList(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl,
      channelId
    });
  }

  public async fetchMessage(channelId: string, messageId: string): Promise<FluxerMessage> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/channels/${channelId}/messages/${messageId}`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "GET",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "GET",
        url: requestUrl,
        channelId,
        messageId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "GET",
        url: requestUrl,
        channelId,
        messageId
      });
    }

    return parseRestMessage(await parseJsonResponse(response), {
      method: "GET",
      url: requestUrl,
      channelId,
      messageId
    });
  }

  public async editMessage(
    channelId: string,
    messageId: string,
    payload: EditMessagePayload
  ): Promise<FluxerMessage> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/channels/${channelId}/messages/${messageId}`;
    validateMessagePayload(payload);
    const serializedPayload = serializeMessagePayload(payload);
    const hasAttachments = (payload.attachments?.length ?? 0) > 0;
    const requestBody = hasAttachments
      ? createMultipartRequestBody({ channelId, ...payload }, serializedPayload)
      : JSON.stringify(serializedPayload);

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "PATCH",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments
        }),
        body: requestBody
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "PATCH",
        url: requestUrl,
        channelId,
        messageId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "PATCH",
        url: requestUrl,
        channelId,
        messageId
      });
    }

    return parseRestMessage(await parseJsonResponse(response), {
      method: "PATCH",
      url: requestUrl,
      channelId,
      messageId
    });
  }

  public async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const baseUrl = await this.#ensureBaseUrl();
    const requestUrl = `${baseUrl}/v1/channels/${channelId}/messages/${messageId}`;

    let response: Response;
    try {
      response = await this.#fetchImpl(requestUrl, {
        method: "DELETE",
        headers: createRequestHeaders({
          headers: this.#headers,
          authHeader: this.#createAuthHeader(),
          userAgent: this.#userAgent,
          hasAttachments: false
        })
      });
    } catch (error) {
      throw createRequestFailedError({
        method: "DELETE",
        url: requestUrl,
        channelId,
        messageId,
        error
      });
    }

    if (!response.ok) {
      throw await createResponseError(response, {
        method: "DELETE",
        url: requestUrl,
        channelId,
        messageId
      });
    }
  }

  #createAuthHeader(): Record<string, string> {
    return createBotAuthHeader(this.#auth);
  }

  async #ensureBaseUrl(): Promise<string> {
    if (this.#baseUrl) {
      return this.#baseUrl;
    }

    if (this.#baseUrlPromise) {
      return this.#baseUrlPromise;
    }

    if (this.#discovery) {
      this.#baseUrl = resolveBotApiBaseUrl(this.#discovery);
      return this.#baseUrl;
    }

    if (!this.#instanceUrl) {
      throw new RestTransportError({
        message: "RestTransport requires either a baseUrl, discovery document, or instanceUrl.",
        code: "REST_CONFIGURATION_INVALID",
        retryable: false,
        details: {
          hasBaseUrl: Boolean(this.#baseUrl),
          hasDiscovery: Boolean(this.#discovery),
          hasInstanceUrl: Boolean(this.#instanceUrl)
        }
      });
    }

    this.#baseUrlPromise = (async () => {
      let discovery: FluxerInstanceDiscoveryDocument;
      try {
        discovery = await fetchInstanceDiscoveryDocument({
          instanceUrl: this.#instanceUrl!,
          fetchImpl: this.#fetchImpl
        });
      } catch (error) {
        throw new RestTransportError({
          message: "RestTransport failed to fetch the instance discovery document.",
          code: "REST_DISCOVERY_FAILED",
          retryable: true,
          details: {
            instanceUrl: this.#instanceUrl,
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }

      const baseUrl = resolveBotApiBaseUrl(discovery);
      this.#baseUrl = baseUrl;
      return baseUrl;
    })();

    try {
      return await this.#baseUrlPromise;
    } finally {
      this.#baseUrlPromise = undefined;
    }
  }
}

async function safeReadResponseText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new RestTransportError({
      message: "RestTransport received an invalid JSON response.",
      code: "REST_RESPONSE_INVALID",
      retryable: false
    });
  }
}

function parseRestMessage(
  payload: unknown,
  context: {
    method: string;
    url: string;
    channelId: string;
    messageId?: string;
  }
): FluxerMessage {
  const message = payload as {
    id?: string;
    content?: string;
    channel_id?: string;
    timestamp?: string;
    author?: {
      id?: string;
      username?: string;
      global_name?: string;
      bot?: boolean;
    };
  };

  if (!message?.id || !message.channel_id || !message.author?.id || !message.author.username) {
    throw new RestTransportError({
      message: "RestTransport received a message response with missing required fields.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return {
    id: message.id,
    content: typeof message.content === "string" ? message.content : "",
    author: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.author.global_name,
      isBot: message.author.bot
    },
    channel: {
      id: message.channel_id,
      name: message.channel_id,
      type: "text"
    },
    createdAt: new Date(message.timestamp ?? Date.now())
  };
}

function parseRestUser(
  payload: unknown,
  context: {
    method: string;
    url: string;
    userId?: string;
  }
): FluxerUser {
  const user = payload as {
    id?: string;
    username?: string;
    global_name?: string | null;
    bot?: boolean;
  };

  if (!user?.id || !user.username) {
    throw new RestTransportError({
      message: "RestTransport received a user response with missing required fields.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.global_name ?? undefined,
    isBot: user.bot
  };
}

function parseRestInvite(
  payload: unknown,
  context: {
    method: string;
    url: string;
    inviteCode: string;
  }
): FluxerInvite {
  const invite = payload as {
    code?: unknown;
    guild?: { id?: unknown };
    channel?: { id?: unknown };
    inviter?: unknown;
    temporary?: unknown;
    uses?: unknown;
    max_uses?: unknown;
    max_age?: unknown;
    created_at?: string | null;
    expires_at?: string | null;
  };

  if (typeof invite?.code !== "string") {
    throw new RestTransportError({
      message: "RestTransport received an invite response with missing required fields.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  if (invite.guild !== undefined && typeof invite.guild?.id !== "string") {
    throw new RestTransportError({
      message: "RestTransport received an invite response with an invalid guild shape.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  if (invite.channel !== undefined && typeof invite.channel?.id !== "string") {
    throw new RestTransportError({
      message: "RestTransport received an invite response with an invalid channel shape.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  if (
    (invite.temporary !== undefined && typeof invite.temporary !== "boolean")
    || (invite.uses !== undefined && typeof invite.uses !== "number")
    || (invite.max_uses !== undefined && typeof invite.max_uses !== "number")
    || (invite.max_age !== undefined && typeof invite.max_age !== "number")
  ) {
    throw new RestTransportError({
      message: "RestTransport received an invite response with invalid optional field types.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  const inviter = invite.inviter ? parseRestUser(invite.inviter, context) : undefined;
  const guildId = typeof invite.guild?.id === "string" ? invite.guild.id : undefined;
  const channelId = typeof invite.channel?.id === "string" ? invite.channel.id : undefined;
  const createdAt = parseOptionalDateTime(invite.created_at, context, payload, "creation");
  const expiresAt = parseOptionalDateTime(invite.expires_at, context, payload, "expiration");

  return {
    code: invite.code,
    guildId,
    channelId,
    ...(inviter ? { inviter } : {}),
    ...(invite.temporary !== undefined ? { temporary: invite.temporary } : {}),
    ...(invite.uses !== undefined ? { uses: invite.uses } : {}),
    ...(invite.max_uses !== undefined ? { maxUses: invite.max_uses } : {}),
    ...(invite.max_age !== undefined ? { maxAgeSeconds: invite.max_age } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(expiresAt ? { expiresAt } : {})
  };
}

function parseRestChannel(
  payload: unknown,
  context: {
    method: string;
    url: string;
    channelId: string;
  }
): FluxerChannel {
  const channel = payload as {
    id?: string;
    name?: string | null;
    type?: number | string;
  };

  if (!channel?.id || channel.type === undefined) {
    throw new RestTransportError({
      message: "RestTransport received a channel response with missing required fields.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return {
    id: channel.id,
    name: channel.name ?? channel.id,
    type: normalizeChannelType(channel.type)
  };
}

function parseRestChannelList(
  payload: unknown,
  context: {
    method: string;
    url: string;
    guildId: string;
  }
): FluxerChannel[] {
  if (!Array.isArray(payload)) {
    throw new RestTransportError({
      message: "RestTransport received a guild channel list response with an invalid shape.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return payload.map((channel, index) =>
    parseRestChannel(channel, {
      method: context.method,
      url: context.url,
      channelId: typeof (channel as { id?: unknown }).id === "string"
        ? (channel as { id: string }).id
        : `index:${index}`
    })
  );
}

function parseRestGuild(
  payload: unknown,
  context: {
    method: string;
    url: string;
    guildId: string;
  }
): FluxerGuild {
  const guild = payload as {
    id?: string;
    name?: string;
    icon?: string | null;
  };

  if (!guild?.id || !guild.name) {
    throw new RestTransportError({
      message: "RestTransport received a guild response with missing required fields.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.icon ?? undefined
  };
}

function parseOptionalDateTime(
  value: string | null | undefined,
  context: {
    method: string;
    url: string;
    inviteCode: string;
  },
  payload: unknown,
  label: "creation" | "expiration"
): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RestTransportError({
      message: `RestTransport received an invite response with an invalid ${label} timestamp.`,
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return parsed;
}

function parseRestGuildMember(
  payload: unknown,
  context: {
    method: string;
    url: string;
    guildId: string;
    userId: string;
  }
): FluxerGuildMember {
  const member = payload as {
    nick?: string | null;
    roles?: unknown;
    joined_at?: string;
    user?: {
      id?: string;
      username?: string;
      global_name?: string;
      bot?: boolean;
    };
  };

  if (!member?.user?.id || !member.user.username || !Array.isArray(member.roles)) {
    throw new RestTransportError({
      message: "RestTransport received a guild member response with missing required fields.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  if (member.roles.some((roleId) => typeof roleId !== "string")) {
    throw new RestTransportError({
      message: "RestTransport received a guild member response with invalid role IDs.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  const joinedAt = member.joined_at ? new Date(member.joined_at) : undefined;
  if (joinedAt && Number.isNaN(joinedAt.getTime())) {
    throw new RestTransportError({
      message: "RestTransport received a guild member response with an invalid join timestamp.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return {
    guildId: context.guildId,
    user: {
      id: member.user.id,
      username: member.user.username,
      displayName: member.user.global_name,
      isBot: member.user.bot
    },
    nickname: member.nick ?? undefined,
    roles: [...member.roles],
    joinedAt
  };
}

function parseRestRole(
  payload: unknown,
  context: {
    method: string;
    url: string;
    guildId: string;
  }
): FluxerRole {
  const role = payload as {
    id?: unknown;
    name?: unknown;
    color?: unknown;
    position?: unknown;
    permissions?: unknown;
  };

  if (typeof role?.id !== "string" || typeof role.name !== "string") {
    throw new RestTransportError({
      message: "RestTransport received a role response with missing required fields.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  if (
    (role.color !== undefined && typeof role.color !== "number")
    || (role.position !== undefined && typeof role.position !== "number")
    || (role.permissions !== undefined && typeof role.permissions !== "string")
  ) {
    throw new RestTransportError({
      message: "RestTransport received a role response with invalid optional field types.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return {
    id: role.id,
    guildId: context.guildId,
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role.permissions
  };
}

function parseRestRoleList(
  payload: unknown,
  context: {
    method: string;
    url: string;
    guildId: string;
  }
): FluxerRole[] {
  if (!Array.isArray(payload)) {
    throw new RestTransportError({
      message: "RestTransport received a role list response with an invalid shape.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return payload.map((role) => parseRestRole(role, context));
}

function parseRestPinnedMessageList(
  payload: unknown,
  context: {
    method: string;
    url: string;
    channelId: string;
  }
): FluxerPinnedMessageList {
  const responsePayload = payload as {
    items?: Array<{
      message?: unknown;
      pinned_at?: string;
    }>;
    has_more?: boolean;
  };

  if (!Array.isArray(responsePayload?.items) || typeof responsePayload.has_more !== "boolean") {
    throw new RestTransportError({
      message: "RestTransport received a pinned message list response with an invalid shape.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return {
    items: responsePayload.items.map((item, index) => {
      const pinnedAt = new Date(item.pinned_at ?? "");
      if (Number.isNaN(pinnedAt.getTime())) {
        throw new RestTransportError({
          message: "RestTransport received a pinned message entry with an invalid pin timestamp.",
          code: "REST_RESPONSE_INVALID",
          retryable: false,
          details: {
            ...context,
            index,
            payload: item
          }
        });
      }

      return {
        message: parseRestMessage(item.message, {
          ...context,
          messageId: typeof (item.message as { id?: unknown } | undefined)?.id === "string"
            ? (item.message as { id: string }).id
            : `index:${index}`
        }),
        pinnedAt
      };
    }),
    hasMore: responsePayload.has_more
  };
}

function parseRestMessageList(
  payload: unknown,
  context: {
    method: string;
    url: string;
    channelId: string;
  }
): FluxerMessage[] {
  if (!Array.isArray(payload)) {
    throw new RestTransportError({
      message: "RestTransport received a message list response with an invalid shape.",
      code: "REST_RESPONSE_INVALID",
      retryable: false,
      details: {
        ...context,
        payload
      }
    });
  }

  return payload.map((message, index) =>
    parseRestMessage(message, {
      ...context,
      messageId: typeof (message as { id?: unknown }).id === "string"
        ? (message as { id: string }).id
        : `index:${index}`
    })
  );
}

function createMessageListUrl(baseUrl: string, channelId: string, options?: FluxerListMessagesOptions): string {
  const url = new URL(`${baseUrl}/v1/channels/${channelId}/messages`);
  if (options?.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }
  if (options?.before) {
    url.searchParams.set("before", options.before);
  }
  if (options?.after) {
    url.searchParams.set("after", options.after);
  }
  if (options?.around) {
    url.searchParams.set("around", options.around);
  }
  return url.toString();
}

function createPinnedMessagesUrl(
  baseUrl: string,
  channelId: string,
  options?: FluxerListPinnedMessagesOptions
): string {
  const url = new URL(`${baseUrl}/v1/channels/${channelId}/messages/pins`);
  if (options?.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }
  if (options?.before !== undefined) {
    const before = options.before instanceof Date ? options.before.toISOString() : options.before;
    url.searchParams.set("before", before);
  }
  return url.toString();
}

function normalizeChannelType(type: number | string): FluxerChannel["type"] {
  if (type === "dm" || type === 1) {
    return "dm";
  }

  if (type === "group" || type === 3) {
    return "group";
  }

  return "text";
}

function validateListMessagesOptions(options?: FluxerListMessagesOptions): void {
  if (options?.limit === undefined) {
    return;
  }

  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new RestTransportError({
      message: "RestTransport listMessages limit must be an integer between 1 and 100.",
      code: "REST_CONFIGURATION_INVALID",
      retryable: false,
      details: {
        limit: options.limit
      }
    });
  }
}

function validateListPinnedMessagesOptions(options?: FluxerListPinnedMessagesOptions): void {
  if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50)) {
    throw new RestTransportError({
      message: "RestTransport listPinnedMessages limit must be an integer between 1 and 50.",
      code: "REST_CONFIGURATION_INVALID",
      retryable: false,
      details: {
        limit: options.limit
      }
    });
  }

  if (options?.before !== undefined) {
    const before = options.before instanceof Date ? options.before : new Date(options.before);
    if (Number.isNaN(before.getTime())) {
      throw new RestTransportError({
        message: "RestTransport listPinnedMessages before must be a valid ISO timestamp or Date.",
        code: "REST_CONFIGURATION_INVALID",
        retryable: false,
        details: {
          before: options.before instanceof Date ? options.before.toISOString() : options.before
        }
      });
    }
  }
}

function createRequestFailedError(context: {
  method: string;
  url: string;
  channelId?: string;
  guildId?: string;
  userId?: string;
  inviteCode?: string;
  messageId?: string;
  error: unknown;
}): RestTransportError {
  return new RestTransportError({
    message: "RestTransport failed to send the request.",
    code: "REST_REQUEST_FAILED",
    retryable: true,
    details: {
      method: context.method,
      url: context.url,
      channelId: context.channelId,
      guildId: context.guildId,
      userId: context.userId,
      inviteCode: context.inviteCode,
      messageId: context.messageId,
      message: context.error instanceof Error ? context.error.message : String(context.error)
    }
  });
}

async function createResponseError(
  response: Response,
  context: {
    method: string;
    url: string;
    channelId?: string;
    guildId?: string;
    userId?: string;
    inviteCode?: string;
    messageId?: string;
  }
): Promise<RestTransportError> {
  const responseBody = await safeReadResponseText(response);
  if (response.status === 429) {
    const rateLimit = resolveRateLimitMetadata(response, responseBody);
    return new RestTransportError({
      message: "RestTransport is rate limited and should be retried later.",
      code: "REST_RATE_LIMITED",
      status: response.status,
      retryable: true,
      retryAfterMs: rateLimit.retryAfterMs,
      details: {
        method: context.method,
        url: context.url,
        channelId: context.channelId,
        guildId: context.guildId,
        userId: context.userId,
        inviteCode: context.inviteCode,
        messageId: context.messageId,
        statusText: response.statusText,
        responseBody,
        retryAfterMs: rateLimit.retryAfterMs,
        retryAfterSource: rateLimit.source,
        bucket: rateLimit.bucket,
        global: rateLimit.global
      }
    });
  }

  return new RestTransportError({
    message: `RestTransport request failed: ${response.status} ${response.statusText}`,
    code: "REST_HTTP_ERROR",
    status: response.status,
    retryable: response.status >= 500,
    details: {
      method: context.method,
      url: context.url,
      channelId: context.channelId,
      guildId: context.guildId,
      userId: context.userId,
      inviteCode: context.inviteCode,
      messageId: context.messageId,
      statusText: response.statusText,
      responseBody
    }
  });
}

function resolveRateLimitMetadata(
  response: Response,
  responseBody?: string
): {
  retryAfterMs?: number;
  source?: "header" | "reset_after" | "body";
  bucket?: string;
  global?: boolean;
} {
  const retryAfterHeader = response.headers.get("retry-after");
  const resetAfterHeader = response.headers.get("x-ratelimit-reset-after");
  const bucket = response.headers.get("x-ratelimit-bucket") ?? undefined;
  const parsedBody = parseRateLimitBody(responseBody);

  if (retryAfterHeader) {
    const retryAfterMs = parseRetryAfterHeader(retryAfterHeader);
    if (retryAfterMs !== undefined) {
      return {
        retryAfterMs,
        source: "header",
        bucket,
        global: parsedBody?.global
      };
    }
  }

  if (resetAfterHeader) {
    const seconds = Number(resetAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return {
        retryAfterMs: Math.round(seconds * 1000),
        source: "reset_after",
        bucket,
        global: parsedBody?.global
      };
    }
  }

  if (parsedBody?.retryAfterMs !== undefined) {
    return {
      retryAfterMs: parsedBody.retryAfterMs,
      source: "body",
      bucket,
      global: parsedBody.global
    };
  }

  return {
    bucket,
    global: parsedBody?.global
  };
}

function parseRetryAfterHeader(value: string): number | undefined {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return Math.max(0, timestamp - Date.now());
}

function parseRateLimitBody(
  responseBody?: string
): { retryAfterMs?: number; global?: boolean } | undefined {
  if (!responseBody) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(responseBody) as {
      retry_after?: unknown;
      retry_after_ms?: unknown;
      global?: unknown;
    };

    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }

    const retryAfterMs = typeof parsed.retry_after_ms === "number"
      ? normalizeRetryAfterMs(parsed.retry_after_ms)
      : typeof parsed.retry_after === "number"
        ? normalizeRetryAfterMs(parsed.retry_after * 1000)
        : undefined;

    return {
      retryAfterMs,
      global: typeof parsed.global === "boolean" ? parsed.global : undefined
    };
  } catch {
    return undefined;
  }
}

function normalizeRetryAfterMs(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function createMultipartRequestBody(
  payload: SendMessagePayload,
  serializedPayload: FluxerSerializedMessagePayload
): FormData {
  const formData = new FormData();
  formData.set("payload_json", JSON.stringify(serializedPayload));

  for (const [index, attachment] of (payload.attachments ?? []).entries()) {
    formData.set(`files[${index}]`, toAttachmentBlob(attachment), toSpoilerFilenameIfNeeded(attachment));
  }

  return formData;
}

function toAttachmentBlob(attachment: FluxerAttachment): Blob {
  if (attachment.data instanceof Blob) {
    if (!attachment.contentType || attachment.data.type === attachment.contentType) {
      return attachment.data;
    }

    return new Blob([attachment.data], { type: attachment.contentType });
  }

  if (attachment.data instanceof Uint8Array) {
    return new Blob([new Uint8Array(attachment.data)], {
      type: attachment.contentType
    });
  }

  if (attachment.data instanceof ArrayBuffer) {
    return new Blob([attachment.data.slice(0)], {
      type: attachment.contentType
    });
  }

  return new Blob([attachment.data], {
    type: attachment.contentType
  });
}

function toSpoilerFilenameIfNeeded(attachment: FluxerAttachment): string {
  return attachment.spoiler ? toSpoilerFilename(attachment.filename) : attachment.filename;
}

function toSpoilerFilename(filename: string): string {
  return filename.startsWith("SPOILER_") ? filename : `SPOILER_${filename}`;
}

function createRequestHeaders(options: {
  headers: Record<string, string>;
  authHeader: Record<string, string>;
  userAgent?: string;
  hasAttachments: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(options.userAgent ? { "user-agent": options.userAgent } : {}),
    ...options.headers,
    ...options.authHeader
  };

  if (options.hasAttachments) {
    delete headers["content-type"];
    delete headers["Content-Type"];
  } else {
    headers["content-type"] = headers["content-type"] ?? headers["Content-Type"] ?? "application/json";
  }

  return headers;
}
