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
  public readonly details?: Record<string, unknown>;

  public constructor(options: {
    message: string;
    code: string;
    state?: FluxerGatewayConnectionState;
    retryable?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(options.message, options.code);
    this.state = options.state;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
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
    details?: Record<string, unknown>;
  }) {
    super(options);
    this.opcode = options.opcode;
    this.eventType = options.eventType;
  }
}

export class RestTransportError extends FluxerError {
  public readonly retryable: boolean;
  public readonly status?: number;
  public readonly details?: Record<string, unknown>;

  public constructor(options: {
    message: string;
    code: string;
    retryable?: boolean;
    status?: number;
    details?: Record<string, unknown>;
  }) {
    super(options.message, options.code);
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.details = options.details;
  }
}

export class PayloadValidationError extends FluxerError {
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, options?: { code?: string; details?: Record<string, unknown> }) {
    super(message, options?.code ?? "PAYLOAD_VALIDATION_FAILED");
    this.details = options?.details;
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
