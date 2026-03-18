import type { FluxerGatewayConnectionState } from "./types.js";

export class FluxerError extends Error {
  public readonly code: string;

  public constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class GatewayTransportError extends FluxerError {
  public readonly state?: FluxerGatewayConnectionState;
  public readonly retryable: boolean;

  public constructor(options: {
    message: string;
    code: string;
    state?: FluxerGatewayConnectionState;
    retryable?: boolean;
  }) {
    super(options.message, options.code);
    this.state = options.state;
    this.retryable = options.retryable ?? false;
  }
}

export class GatewayProtocolError extends GatewayTransportError {
  public readonly opcode?: number;
  public readonly eventType?: string;

  public constructor(options: {
    message: string;
    code: string;
    state?: FluxerGatewayConnectionState;
    retryable?: boolean;
    opcode?: number;
    eventType?: string;
  }) {
    super(options);
    this.opcode = options.opcode;
    this.eventType = options.eventType;
  }
}

export class CommandSchemaError extends FluxerError {
  public readonly usage?: string;

  public constructor(message: string, options?: { usage?: string }) {
    super(message, "COMMAND_SCHEMA_INVALID");
    this.usage = options?.usage;
  }
}

export class WaitForTimeoutError extends FluxerError {
  public constructor(message: string) {
    super(message, "WAIT_FOR_TIMEOUT");
  }
}
