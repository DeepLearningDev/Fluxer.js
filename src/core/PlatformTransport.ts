import { BaseTransport } from "./Transport.js";
import type {
  FluxerGatewayDispatchHandler,
  FluxerMessageHandler,
  FluxerTransport,
  SendMessagePayload
} from "./types.js";

export interface PlatformTransportOptions {
  inbound: FluxerTransport;
  outbound: FluxerTransport;
}

export class PlatformTransport extends BaseTransport {
  readonly #inbound: FluxerTransport;
  readonly #outbound: FluxerTransport;

  public constructor(options: PlatformTransportOptions) {
    super();
    this.#inbound = options.inbound;
    this.#outbound = options.outbound;
  }

  public override onMessage(handler: FluxerMessageHandler): void {
    super.onMessage(handler);
    this.#inbound.onMessage(handler);
  }

  public override onError(handler: (error: Error) => Promise<void> | void): void {
    super.onError(handler);
    this.#inbound.onError(handler);
    this.#outbound.onError(handler);
  }

  public override onGatewayDispatch(handler: FluxerGatewayDispatchHandler): void {
    super.onGatewayDispatch(handler);
    this.#inbound.onGatewayDispatch(handler);
  }

  public async connect(): Promise<void> {
    await Promise.all([this.#inbound.connect(), this.#outbound.connect()]);
  }

  public async disconnect(): Promise<void> {
    await Promise.all([this.#inbound.disconnect(), this.#outbound.disconnect()]);
  }

  public async sendMessage(payload: SendMessagePayload): Promise<void> {
    await this.#outbound.sendMessage(payload);
  }
}
