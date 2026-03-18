import { PayloadValidationError } from "./errors.js";
import type {
  FluxerAttachment,
  FluxerAttachmentData,
  FluxerEmbed,
  FluxerEmbedAuthor,
  FluxerEmbedField,
  FluxerEmbedFooter,
  FluxerEmbedImage,
  MessageBuilderLike,
  SendMessagePayload
} from "./types.js";

const MAX_ATTACHMENTS = 10;
const ATTACHMENT_URL_PREFIX = "attachment://";
const EMBED_ATTACHMENT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export class AttachmentBuilder {
  #attachment: Partial<FluxerAttachment> = {};

  public setFilename(filename: string): this {
    this.#attachment.filename = filename;
    return this;
  }

  public setDescription(description: string): this {
    this.#attachment.description = description;
    return this;
  }

  public setContentType(contentType: string): this {
    this.#attachment.contentType = contentType;
    return this;
  }

  public setSpoiler(spoiler = true): this {
    this.#attachment.spoiler = spoiler;
    return this;
  }

  public setData(data: FluxerAttachmentData): this {
    this.#attachment.data = data;
    return this;
  }

  public setText(text: string, contentType = "text/plain; charset=utf-8"): this {
    this.#attachment.data = text;
    this.#attachment.contentType = contentType;
    return this;
  }

  public toJSON(): FluxerAttachment {
    if (!this.#attachment.filename) {
      throw new PayloadValidationError("Attachment filename is required.", {
        code: "PAYLOAD_ATTACHMENT_FILENAME_REQUIRED"
      });
    }

    if (typeof this.#attachment.data === "undefined") {
      throw new PayloadValidationError("Attachment data is required.", {
        code: "PAYLOAD_ATTACHMENT_DATA_REQUIRED",
        details: {
          filename: this.#attachment.filename
        }
      });
    }

    return {
      filename: this.#attachment.filename,
      data: this.#attachment.data,
      description: this.#attachment.description,
      contentType: this.#attachment.contentType,
      spoiler: this.#attachment.spoiler
    };
  }
}

export class EmbedBuilder {
  #embed: FluxerEmbed = {};

  public setTitle(title: string): this {
    this.#embed.title = title;
    return this;
  }

  public setDescription(description: string): this {
    this.#embed.description = description;
    return this;
  }

  public setUrl(url: string): this {
    this.#embed.url = url;
    return this;
  }

  public setColor(color: number): this {
    this.#embed.color = color;
    return this;
  }

  public setTimestamp(timestamp: Date | string = new Date()): this {
    this.#embed.timestamp = timestamp instanceof Date ? timestamp.toISOString() : timestamp;
    return this;
  }

  public setFooter(footer: FluxerEmbedFooter | string, iconUrl?: string): this {
    this.#embed.footer = typeof footer === "string" ? { text: footer, iconUrl } : footer;
    return this;
  }

  public setAuthor(author: FluxerEmbedAuthor | string, options?: Omit<FluxerEmbedAuthor, "name">): this {
    this.#embed.author = typeof author === "string" ? { name: author, ...options } : author;
    return this;
  }

  public setImage(image: FluxerEmbedImage | string): this {
    this.#embed.image = typeof image === "string" ? { url: image } : image;
    return this;
  }

  public setThumbnail(thumbnail: FluxerEmbedImage | string): this {
    this.#embed.thumbnail = typeof thumbnail === "string" ? { url: thumbnail } : thumbnail;
    return this;
  }

  public setAttachmentImage(filename: string): this {
    return this.setImage(createAttachmentUrl(filename));
  }

  public setAttachmentThumbnail(filename: string): this {
    return this.setThumbnail(createAttachmentUrl(filename));
  }

  public addField(field: FluxerEmbedField): this {
    this.#embed.fields ??= [];
    this.#embed.fields.push(field);
    return this;
  }

  public addFields(fields: FluxerEmbedField[]): this {
    for (const field of fields) {
      this.addField(field);
    }

    return this;
  }

  public toJSON(): FluxerEmbed {
    return cloneEmbed(this.#embed);
  }
}

export class MessageBuilder {
  #payload: Omit<SendMessagePayload, "channelId"> = {};

  public setContent(content: string): this {
    this.#payload.content = content;
    return this;
  }

  public setNonce(nonce: string): this {
    this.#payload.nonce = nonce;
    return this;
  }

  public setMessageReference(
    messageReference: Omit<NonNullable<SendMessagePayload["messageReference"]>, never>
  ): this {
    this.#payload.messageReference = { ...messageReference };
    return this;
  }

  public addEmbed(embed: EmbedBuilder | FluxerEmbed): this {
    this.#payload.embeds ??= [];
    this.#payload.embeds.push(embed instanceof EmbedBuilder ? embed.toJSON() : cloneEmbed(embed));
    return this;
  }

  public addEmbeds(embeds: Array<EmbedBuilder | FluxerEmbed>): this {
    for (const embed of embeds) {
      this.addEmbed(embed);
    }

    return this;
  }

  public addAttachment(attachment: AttachmentBuilder | FluxerAttachment): this {
    this.#payload.attachments ??= [];
    this.#payload.attachments.push(
      attachment instanceof AttachmentBuilder ? attachment.toJSON() : cloneAttachment(attachment)
    );
    return this;
  }

  public addAttachments(attachments: Array<AttachmentBuilder | FluxerAttachment>): this {
    for (const attachment of attachments) {
      this.addAttachment(attachment);
    }

    return this;
  }

  public toJSON(): Omit<SendMessagePayload, "channelId"> {
    return clonePayload(this.#payload);
  }
}

export function createAttachmentUrl(filename: string): string {
  return `${ATTACHMENT_URL_PREFIX}${filename}`;
}

export function validateMessagePayload(
  payload: Omit<SendMessagePayload, "channelId"> | SendMessagePayload
): void {
  const hasContent = typeof payload.content === "string" && payload.content.trim().length > 0;
  const hasEmbeds = Array.isArray(payload.embeds) && payload.embeds.length > 0;
  const hasAttachments = Array.isArray(payload.attachments) && payload.attachments.length > 0;

  if (!hasContent && !hasEmbeds && !hasAttachments) {
    throw new PayloadValidationError(
      "Message payload must include content, embeds, or attachments.",
      { code: "PAYLOAD_EMPTY_MESSAGE" }
    );
  }

  if ((payload.attachments?.length ?? 0) > MAX_ATTACHMENTS) {
    throw new PayloadValidationError(`Message payload supports at most ${MAX_ATTACHMENTS} attachments.`, {
      code: "PAYLOAD_ATTACHMENT_LIMIT_EXCEEDED",
      details: {
        count: payload.attachments?.length ?? 0,
        max: MAX_ATTACHMENTS
      }
    });
  }

  const attachments = payload.attachments ?? [];
  const attachmentNames = new Set<string>();
  for (const attachment of attachments) {
    if (typeof attachment.filename !== "string" || !attachment.filename.trim()) {
      throw new PayloadValidationError("Attachment filename cannot be empty.", {
        code: "PAYLOAD_ATTACHMENT_FILENAME_REQUIRED"
      });
    }

    if (typeof attachment.data === "undefined") {
      throw new PayloadValidationError("Attachment data is required.", {
        code: "PAYLOAD_ATTACHMENT_DATA_REQUIRED",
        details: {
          filename: attachment.filename
        }
      });
    }

    if (attachmentNames.has(attachment.filename)) {
      throw new PayloadValidationError(`Duplicate attachment filename "${attachment.filename}".`, {
        code: "PAYLOAD_ATTACHMENT_DUPLICATE_FILENAME",
        details: {
          filename: attachment.filename
        }
      });
    }

    attachmentNames.add(attachment.filename);
  }

  for (const embed of payload.embeds ?? []) {
    validateEmbed(embed, attachmentNames);
  }
}

export function resolveMessagePayload(
  message: string | Omit<SendMessagePayload, "channelId"> | MessageBuilderLike
): Omit<SendMessagePayload, "channelId"> {
  if (typeof message === "string") {
    const payload = { content: message };
    validateMessagePayload(payload);
    return payload;
  }

  if ("toJSON" in message && typeof message.toJSON === "function") {
    const payload = clonePayload(message.toJSON());
    validateMessagePayload(payload);
    return payload;
  }

  const payload = clonePayload(message as Omit<SendMessagePayload, "channelId">);
  validateMessagePayload(payload);
  return payload;
}

export function clonePayload(
  payload: Omit<SendMessagePayload, "channelId"> | SendMessagePayload
): Omit<SendMessagePayload, "channelId"> {
  return {
    ...payload,
    messageReference: payload.messageReference ? { ...payload.messageReference } : undefined,
    embeds: payload.embeds?.map(cloneEmbed),
    attachments: payload.attachments?.map(cloneAttachment)
  };
}

export function createMessageTemplate(
  template: string | Omit<SendMessagePayload, "channelId"> | MessageBuilderLike
): (override?: string | Omit<SendMessagePayload, "channelId"> | MessageBuilderLike) => Omit<SendMessagePayload, "channelId"> {
  const basePayload = resolveMessagePayload(template);

  return (override) => {
    if (typeof override === "undefined") {
      return clonePayload(basePayload);
    }

    const overridePayload = resolveMessagePayload(override);
    return resolveMessagePayload({
      ...basePayload,
      ...overridePayload,
      embeds: overridePayload.embeds ?? basePayload.embeds,
      attachments: overridePayload.attachments ?? basePayload.attachments,
      messageReference: overridePayload.messageReference ?? basePayload.messageReference
    });
  };
}

function validateEmbed(embed: FluxerEmbed, attachmentNames: Set<string>): void {
  for (const field of embed.fields ?? []) {
    if (typeof field.name !== "string" || !field.name.trim()) {
      throw new PayloadValidationError("Embed field name cannot be empty.", {
        code: "PAYLOAD_EMBED_FIELD_NAME_REQUIRED"
      });
    }

    if (typeof field.value !== "string" || !field.value.trim()) {
      throw new PayloadValidationError("Embed field value cannot be empty.", {
        code: "PAYLOAD_EMBED_FIELD_VALUE_REQUIRED",
        details: {
          field: field.name
        }
      });
    }
  }

  validateAttachmentReference(embed.image?.url, attachmentNames, "image");
  validateAttachmentReference(embed.thumbnail?.url, attachmentNames, "thumbnail");
}

function validateAttachmentReference(
  value: string | undefined,
  attachmentNames: Set<string>,
  target: "image" | "thumbnail"
): void {
  if (!value?.startsWith(ATTACHMENT_URL_PREFIX)) {
    return;
  }

  const filename = value.slice(ATTACHMENT_URL_PREFIX.length);
  if (!filename) {
    throw new PayloadValidationError(`Embed ${target} attachment reference cannot be empty.`, {
      code: "PAYLOAD_ATTACHMENT_REFERENCE_INVALID",
      details: {
        target
      }
    });
  }

  if (!attachmentNames.has(filename)) {
    throw new PayloadValidationError(
      `Embed ${target} references missing attachment "${filename}".`,
      {
        code: "PAYLOAD_ATTACHMENT_REFERENCE_MISSING",
        details: {
          target,
          filename
        }
      }
    );
  }

  if (!hasEmbedAttachmentExtension(filename)) {
    throw new PayloadValidationError(
      `Embed ${target} attachment "${filename}" must be an image file.`,
      {
        code: "PAYLOAD_ATTACHMENT_REFERENCE_UNSUPPORTED",
        details: {
          target,
          filename
        }
      }
    );
  }
}

function hasEmbedAttachmentExtension(filename: string): boolean {
  const normalizedFilename = filename.toLowerCase();
  for (const extension of EMBED_ATTACHMENT_EXTENSIONS) {
    if (normalizedFilename.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

function cloneEmbed(embed: FluxerEmbed): FluxerEmbed {
  return {
    ...embed,
    footer: embed.footer ? { ...embed.footer } : undefined,
    author: embed.author ? { ...embed.author } : undefined,
    image: embed.image ? { ...embed.image } : undefined,
    thumbnail: embed.thumbnail ? { ...embed.thumbnail } : undefined,
    fields: embed.fields?.map((field) => ({ ...field }))
  };
}

function cloneAttachment(attachment: FluxerAttachment): FluxerAttachment {
  return {
    filename: attachment.filename,
    data: cloneAttachmentData(attachment.data),
    description: attachment.description,
    contentType: attachment.contentType,
    spoiler: attachment.spoiler
  };
}

function cloneAttachmentData(data: FluxerAttachmentData): FluxerAttachmentData {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof Uint8Array) {
    return new Uint8Array(data);
  }

  if (data instanceof ArrayBuffer) {
    return data.slice(0);
  }

  return data;
}
