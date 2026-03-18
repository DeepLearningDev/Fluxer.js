import { createBotAuthHeader, fetchInstanceDiscoveryDocument, normalizeBaseUrl } from "./Discovery.js";
import { validateMessagePayload } from "./builders.js";
import { RestTransportError } from "./errors.js";
import { BaseTransport } from "./Transport.js";
import type {
  FluxerAttachment,
  FluxerInstanceDiscoveryDocument,
  FluxerRestTransportOptions,
  SendMessagePayload
} from "./types.js";

export class RestTransport extends BaseTransport {
  #baseUrl?: string;
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
      throw new RestTransportError({
        message: "RestTransport failed to send the request.",
        code: "REST_REQUEST_FAILED",
        retryable: true,
        details: {
          method: "POST",
          url: requestUrl,
          channelId: payload.channelId,
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }

    if (!response.ok) {
      const responseBody = await safeReadResponseText(response);
      throw new RestTransportError({
        message: `RestTransport failed to send message: ${response.status} ${response.statusText}`,
        code: "REST_HTTP_ERROR",
        status: response.status,
        retryable: response.status >= 500,
        details: {
          method: "POST",
          url: requestUrl,
          channelId: payload.channelId,
          statusText: response.statusText,
          responseBody
        }
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

    if (this.#discovery) {
      this.#baseUrl = normalizeBaseUrl(this.#discovery.endpoints.api);
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

    let discovery: FluxerInstanceDiscoveryDocument;
    try {
      discovery = await fetchInstanceDiscoveryDocument({
        instanceUrl: this.#instanceUrl,
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

    this.#baseUrl = normalizeBaseUrl(discovery.endpoints.api);
    return this.#baseUrl;
  }
}

async function safeReadResponseText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function serializeMessagePayload(payload: SendMessagePayload): Record<string, unknown> {
  return {
    content: payload.content,
    embeds: payload.embeds?.map((embed) => ({
      ...embed,
      footer: embed.footer
        ? {
            text: embed.footer.text,
            icon_url: embed.footer.iconUrl
          }
        : undefined,
      author: embed.author
        ? {
            name: embed.author.name,
            url: embed.author.url,
            icon_url: embed.author.iconUrl
          }
        : undefined,
      image: embed.image
        ? {
            url: embed.image.url
          }
        : undefined,
      thumbnail: embed.thumbnail
        ? {
            url: embed.thumbnail.url
          }
        : undefined,
      fields: embed.fields?.map((field) => ({
        name: field.name,
        value: field.value,
        inline: field.inline
      }))
    })),
    attachments: payload.attachments?.map((attachment, index) => ({
      id: index,
      filename: attachment.spoiler ? toSpoilerFilename(attachment.filename) : attachment.filename,
      description: attachment.description
    })),
    nonce: payload.nonce,
    message_reference: payload.messageReference
      ? {
          message_id: payload.messageReference.messageId,
          channel_id: payload.messageReference.channelId,
          guild_id: payload.messageReference.guildId,
          type: payload.messageReference.type
        }
      : undefined
  };
}

function createMultipartRequestBody(
  payload: SendMessagePayload,
  serializedPayload: Record<string, unknown>
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
