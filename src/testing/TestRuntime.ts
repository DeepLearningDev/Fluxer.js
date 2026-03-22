import { FluxerClient } from "../core/Client.js";
import { MockTransport } from "../core/MockTransport.js";
import { FluxerError, WaitForTimeoutError } from "../core/errors.js";
import type {
  FluxerBotLike,
  FluxerGatewayDispatchEvent,
  FluxerMessage,
  FluxerWaitForOptions,
  SendMessagePayload
} from "../core/types.js";
import {
  createTestChannel,
  createTestGatewayDispatch,
  createTestGuild,
  createTestMessage,
  createTestUser
} from "./fixtures.js";

export class FluxerTestRuntime {
  readonly transport: MockTransport;
  readonly client: FluxerClient;

  #messageSequence = 0;
  #dispatchSequence = 0;

  public constructor() {
    this.transport = new MockTransport();
    this.client = new FluxerClient(this.transport);
  }

  public async connect(): Promise<void> {
    await this.client.connect();
  }

  public async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  public registerBot(bot: FluxerBotLike): this {
    this.client.registerBot(bot as never);
    return this;
  }

  public get sentMessages(): SendMessagePayload[] {
    return this.transport.sentMessages;
  }

  public clearSentMessages(): void {
    this.transport.clearSentMessages();
  }

  public waitForSentMessage(
    options: FluxerWaitForOptions<SendMessagePayload> = {}
  ): Promise<SendMessagePayload> {
    const existingMessage = options.filter
      ? undefined
      : this.sentMessages[0];

    if (existingMessage && !options.filter) {
      return Promise.resolve(existingMessage);
    }

    return new Promise<SendMessagePayload>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let removeAbortListener: (() => void) | undefined;

      const cleanup = (): void => {
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        removeAbortListener?.();
        unsubscribe();
      };

      const tryResolve = async (payload: SendMessagePayload): Promise<void> => {
        const matches = await options.filter?.(payload) ?? true;
        if (!matches || settled) {
          return;
        }

        cleanup();
        resolve(payload);
      };

      if (options.signal?.aborted) {
        reject(createSentMessageAbortError());
        return;
      }

      const unsubscribe = this.transport.onSend((payload) => void tryResolve(payload));

      for (const payload of this.sentMessages) {
        void tryResolve(payload);
        if (settled) {
          return;
        }
      }

      if (options.timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          if (settled) {
            return;
          }
          cleanup();
          reject(new WaitForTimeoutError("Timed out waiting for a sent message."));
        }, options.timeoutMs);
      }

      if (options.signal) {
        const onAbort = (): void => {
          if (settled) {
            return;
          }
          cleanup();
          reject(createSentMessageAbortError());
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => {
          options.signal?.removeEventListener("abort", onAbort);
        };
      }
    });
  }

  public createUser = createTestUser;
  public createChannel = createTestChannel;
  public createGuild = createTestGuild;

  public createMessage(content = "!ping", overrides: Partial<FluxerMessage> = {}): FluxerMessage {
    this.#messageSequence += 1;
    return createTestMessage(content, {
      id: `msg_${this.#messageSequence}`,
      ...overrides
    });
  }

  public createDispatch(
    type: string,
    data: Record<string, unknown>,
    overrides: Partial<FluxerGatewayDispatchEvent> = {}
  ): FluxerGatewayDispatchEvent {
    this.#dispatchSequence += 1;
    return createTestGatewayDispatch(type, data, {
      sequence: this.#dispatchSequence,
      ...overrides
    });
  }

  public async injectMessage(
    messageOrContent: FluxerMessage | string,
    overrides: Partial<FluxerMessage> = {}
  ): Promise<void> {
    const message = typeof messageOrContent === "string"
      ? this.createMessage(messageOrContent, overrides)
      : messageOrContent;
    await this.transport.injectMessage(message);
  }

  public async injectGatewayDispatch(
    eventOrType: FluxerGatewayDispatchEvent | string,
    data?: Record<string, unknown>,
    overrides: Partial<FluxerGatewayDispatchEvent> = {}
  ): Promise<void> {
    const event = typeof eventOrType === "string"
      ? this.createDispatch(eventOrType, data ?? {}, overrides)
      : eventOrType;
    await this.transport.injectGatewayDispatch(event);
  }
}

function createSentMessageAbortError(): FluxerError {
  return new FluxerError("Sent message wait aborted.", "TEST_RUNTIME_WAIT_ABORTED");
}
