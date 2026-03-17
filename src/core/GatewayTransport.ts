import { fetchGatewayInformation } from "./Discovery.js";
import { BaseTransport } from "./Transport.js";
import type {
  FluxerGatewayTransportOptions,
  FluxerReconnectOptions,
  SendMessagePayload
} from "./types.js";

const DEFAULT_RECONNECT: Required<FluxerReconnectOptions> = {
  enabled: true,
  maxAttempts: Infinity,
  baseDelayMs: 500,
  maxDelayMs: 10_000
};

const DISPATCH_OPCODE = 0;
const HEARTBEAT_OPCODE = 1;
const IDENTIFY_OPCODE = 2;
const RECONNECT_OPCODE = 7;
const INVALID_SESSION_OPCODE = 9;
const HELLO_OPCODE = 10;
const HEARTBEAT_ACK_OPCODE = 11;

export class GatewayTransport extends BaseTransport {
  readonly #options: FluxerGatewayTransportOptions;
  readonly #reconnect: Required<FluxerReconnectOptions>;
  readonly #fetchImpl: typeof fetch;
  #socket?: WebSocket;
  #manualClose = false;
  #reconnectAttempts = 0;
  #reconnectTimer?: ReturnType<typeof setTimeout>;
  #heartbeatTimer?: ReturnType<typeof setInterval>;
  #lastSequence: number | null = null;
  #awaitingHeartbeatAck = false;

  public constructor(options: FluxerGatewayTransportOptions) {
    super();
    this.#options = options;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#reconnect = {
      ...DEFAULT_RECONNECT,
      ...options.reconnect
    };
  }

  public async connect(): Promise<void> {
    this.#manualClose = false;
    await this.#openSocket();
  }

  public async disconnect(): Promise<void> {
    this.#manualClose = true;

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }

    this.#stopHeartbeat();
    this.#socket?.close();
    this.#socket = undefined;
  }

  public async sendMessage(_payload: SendMessagePayload): Promise<void> {
    throw new Error("GatewayTransport cannot send messages directly. Pair it with RestTransport.");
  }

  async #openSocket(): Promise<void> {
    const socketUrl = await this.#resolveSocketUrl();
    const factory =
      this.#options.webSocketFactory ??
      ((url: string, protocols?: string | string[]) => new WebSocket(url, protocols));

    const socket = factory(socketUrl, this.#options.protocols);
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      socket.addEventListener("open", () => {
        settled = true;
        this.#reconnectAttempts = 0;

        resolve();
      });

      socket.addEventListener("message", async (event) => {
        try {
          const payload = this.#parseIncomingPayload(event.data);
          await this.#handleGatewayPayload(payload);
        } catch (error) {
          await this.emitError(this.#normalizeError(error, "GatewayTransport failed to process payload."));
        }
      });

      socket.addEventListener("error", async () => {
        await this.emitError(new Error("GatewayTransport socket error."));
        if (!settled) {
          reject(new Error("GatewayTransport failed to connect."));
        }
      });

      socket.addEventListener("close", async () => {
        this.#socket = undefined;
        this.#stopHeartbeat();
        if (!settled) {
          reject(new Error("GatewayTransport closed before the connection was established."));
          return;
        }

        if (!this.#manualClose) {
          await this.emitError(new Error("GatewayTransport disconnected unexpectedly."));
          this.#scheduleReconnect();
        }
      });
    });
  }

  #scheduleReconnect(): void {
    if (!this.#reconnect.enabled) {
      return;
    }

    if (this.#reconnectAttempts >= this.#reconnect.maxAttempts) {
      return;
    }

    const delay = Math.min(
      this.#reconnect.baseDelayMs * 2 ** this.#reconnectAttempts,
      this.#reconnect.maxDelayMs
    );

    this.#reconnectAttempts += 1;
    this.#reconnectTimer = setTimeout(() => {
      void this.#openSocket().catch(async (error) => {
        await this.emitError(this.#normalizeError(error, "GatewayTransport failed to reconnect."));
        this.#scheduleReconnect();
      });
    }, delay);
  }

  #parseIncomingPayload(rawData: unknown): unknown {
    if (typeof rawData !== "string") {
      return rawData;
    }

    try {
      return JSON.parse(rawData);
    } catch {
      return rawData;
    }
  }

  async #resolveSocketUrl(): Promise<string> {
    if (this.#options.url) {
      return this.#options.url;
    }

    if (!this.#options.apiBaseUrl || !this.#options.auth) {
      throw new Error("GatewayTransport requires either a direct url or both apiBaseUrl and auth.");
    }

    const gateway = await fetchGatewayInformation({
      apiBaseUrl: this.#options.apiBaseUrl,
      auth: this.#options.auth,
      fetchImpl: this.#fetchImpl
    });

    return gateway.url;
  }

  async #handleGatewayPayload(payload: unknown): Promise<void> {
    this.#updateSequence(payload);

    if (this.#isHelloPayload(payload)) {
      const heartbeatInterval = this.#resolveHeartbeatInterval(payload);
      if (heartbeatInterval) {
        this.#startHeartbeat(heartbeatInterval);
      }

      this.#sendIdentifyIfConfigured();
      return;
    }

    if (this.#isHeartbeatAckPayload(payload)) {
      this.#awaitingHeartbeatAck = false;
      return;
    }

    if (this.#isReconnectPayload(payload) || this.#isInvalidSessionPayload(payload)) {
      this.#socket?.close();
      return;
    }

    if (this.#isHeartbeatRequestPayload(payload)) {
      this.#sendHeartbeat();
      return;
    }

    if (!this.#isDispatchPayload(payload)) {
      return;
    }

    const dispatchEvent = this.#parseDispatchEvent(payload);
    if (dispatchEvent) {
      await this.emitGatewayDispatch(dispatchEvent);
    }

    const message = this.#options.parseMessageEvent(payload);
    if (message) {
      await this.emitMessage(message);
    }
  }

  #startHeartbeat(intervalMs: number): void {
    this.#stopHeartbeat();
    this.#awaitingHeartbeatAck = false;

    this.#heartbeatTimer = setInterval(() => {
      if (this.#awaitingHeartbeatAck) {
        this.#socket?.close();
        return;
      }

      this.#sendHeartbeat();
    }, intervalMs);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }

    this.#awaitingHeartbeatAck = false;
  }

  #sendHeartbeat(): void {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.#awaitingHeartbeatAck = true;
    this.#socket.send(JSON.stringify(this.#createHeartbeatPayload()));
  }

  #sendIdentifyIfConfigured(): void {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = this.#options.identifyPayload ?? this.#options.buildIdentifyPayload?.({
      auth: this.#options.auth
    });

    if (payload === undefined) {
      return;
    }

    this.#socket.send(JSON.stringify(payload));
  }

  #resolveHeartbeatInterval(payload: unknown): number | null {
    if (this.#options.heartbeatIntervalResolver) {
      return this.#options.heartbeatIntervalResolver(payload);
    }

    const hello = payload as { op?: number; d?: { heartbeat_interval?: number } };
    return hello.op === HELLO_OPCODE && typeof hello.d?.heartbeat_interval === "number"
      ? hello.d.heartbeat_interval
      : null;
  }

  #isDispatchPayload(payload: unknown): boolean {
    return this.#options.isDispatchPayload
      ? this.#options.isDispatchPayload(payload)
      : (payload as { op?: number }).op === DISPATCH_OPCODE;
  }

  #isHelloPayload(payload: unknown): boolean {
    return this.#options.isHelloPayload
      ? this.#options.isHelloPayload(payload)
      : (payload as { op?: number }).op === HELLO_OPCODE;
  }

  #isHeartbeatAckPayload(payload: unknown): boolean {
    return this.#options.isHeartbeatAckPayload
      ? this.#options.isHeartbeatAckPayload(payload)
      : (payload as { op?: number }).op === HEARTBEAT_ACK_OPCODE;
  }

  #isReconnectPayload(payload: unknown): boolean {
    return this.#options.isReconnectPayload
      ? this.#options.isReconnectPayload(payload)
      : (payload as { op?: number }).op === RECONNECT_OPCODE;
  }

  #isInvalidSessionPayload(payload: unknown): boolean {
    return this.#options.isInvalidSessionPayload
      ? this.#options.isInvalidSessionPayload(payload)
      : (payload as { op?: number }).op === INVALID_SESSION_OPCODE;
  }

  #isHeartbeatRequestPayload(payload: unknown): boolean {
    const maybePayload = payload as { op?: number };
    return maybePayload.op === HEARTBEAT_OPCODE;
  }

  #createHeartbeatPayload(): unknown {
    return this.#options.createHeartbeatPayload?.(this.#lastSequence) ?? {
      op: HEARTBEAT_OPCODE,
      d: this.#lastSequence
    };
  }

  #updateSequence(payload: unknown): void {
    const maybePayload = payload as { s?: number | null };
    if (typeof maybePayload.s === "number") {
      this.#lastSequence = maybePayload.s;
    }
  }

  #normalizeError(error: unknown, fallback: string): Error {
    return error instanceof Error ? error : new Error(fallback);
  }

  #parseDispatchEvent(payload: unknown) {
    if (this.#options.parseDispatchEvent) {
      return this.#options.parseDispatchEvent(payload);
    }

    const envelope = payload as { t?: string | null; s?: number | null; d?: unknown; op?: number };
    if (envelope.op !== DISPATCH_OPCODE || typeof envelope.t !== "string") {
      return null;
    }

    return {
      type: envelope.t,
      sequence: envelope.s ?? null,
      data: envelope.d,
      raw: {
        op: envelope.op,
        d: envelope.d,
        s: envelope.s ?? null,
        t: envelope.t
      }
    };
  }
}
