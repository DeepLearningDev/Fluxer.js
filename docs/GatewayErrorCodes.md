# Gateway Error Codes

This document describes the current gateway error codes emitted by `GatewayTransport`.

These errors surface through the transport `error` path and then through `FluxerClient` as `error` events.

Gateway errors currently come in two classes:

- `GatewayTransportError`
- `GatewayProtocolError`

Both include:

- `message`
- `code`
- `state?`
- `retryable`
- `details?`

`GatewayProtocolError` may also include:

- `opcode?`
- `eventType?`

## Error Fields

### `code`

Stable machine-readable identifier for the failure mode.

### `state`

Best-effort gateway connection state at the time the error was emitted.

Possible values:

- `idle`
- `connecting`
- `connected`
- `identifying`
- `resuming`
- `ready`
- `reconnecting`
- `disconnected`

### `retryable`

Whether the runtime considers the failure recoverable in principle.

This does not guarantee that an automatic retry will happen. It only classifies the failure.

### `details`

Optional structured metadata for debugging and operator tooling.

The exact shape depends on the error code.

## Transport Errors

### `GATEWAY_SEND_UNSUPPORTED`

Type: `GatewayTransportError`

Meaning:

- `GatewayTransport` cannot send messages directly

Retryable:

- `false`

Typical fix:

- use `RestTransport` or `PlatformTransport` for outbound message actions

### `GATEWAY_SOCKET_FACTORY_FAILED`

Type: `GatewayTransportError`

Meaning:

- socket creation failed before a connection could be attempted

Retryable:

- `true`

Details:

```ts
{
  socketUrl: string;
  message: string;
}
```

Typical fix:

- inspect the custom `webSocketFactory`
- verify the resolved socket URL

### `GATEWAY_SOCKET_ERROR`

Type: `GatewayTransportError`

Meaning:

- the underlying socket emitted an error event

Retryable:

- `true`

Typical fix:

- inspect network conditions or server availability
- review related reconnect diagnostics

### `GATEWAY_CONNECT_FAILED`

Type: `GatewayTransportError`

Meaning:

- the socket errored before the initial connection completed

Retryable:

- `true`

Typical fix:

- validate gateway reachability and auth/bootstrap inputs

### `GATEWAY_CLOSED_PREMATURELY`

Type: `GatewayTransportError`

Meaning:

- the socket closed before the initial connection completed

Retryable:

- `true`

Typical fix:

- inspect server-side close behavior or gateway URL correctness

### `GATEWAY_DISCONNECTED`

Type: `GatewayTransportError`

Meaning:

- an established gateway connection closed unexpectedly

Retryable:

- `true`

Typical fix:

- inspect reconnect behavior and related gateway errors

### `GATEWAY_RECONNECT_DISABLED`

Type: `GatewayTransportError`

Meaning:

- the transport needed to reconnect, but reconnects are disabled by configuration

Retryable:

- `false`

Typical fix:

- enable reconnects in transport options if automatic recovery is desired

### `GATEWAY_RECONNECT_EXHAUSTED`

Type: `GatewayTransportError`

Meaning:

- reconnect attempts hit the configured `maxAttempts`

Retryable:

- `false`

Details:

```ts
{
  maxAttempts: number;
}
```

Typical fix:

- increase reconnect limits
- inspect the earlier failure that forced reconnect

### `GATEWAY_HEARTBEAT_TIMEOUT`

Type: `GatewayTransportError`

Meaning:

- a heartbeat was sent but no `HEARTBEAT_ACK` arrived before the next heartbeat interval

Retryable:

- `true`

Typical fix:

- inspect gateway responsiveness
- review heartbeat interval assumptions and reconnect behavior

### `GATEWAY_CONFIGURATION_INVALID`

Type: `GatewayTransportError`

Meaning:

- the transport could not determine a socket URL because required configuration was missing

Retryable:

- `false`

Details:

```ts
{
  hasUrl: boolean;
  hasApiBaseUrl: boolean;
  hasAuth: boolean;
}
```

Typical fix:

- provide a direct gateway URL, or both `apiBaseUrl` and `auth`

### `GATEWAY_INFO_FETCH_FAILED`

Type: `GatewayTransportError`

Meaning:

- the transport failed while fetching gateway bootstrap information from the API

Retryable:

- `true`

Details:

```ts
{
  apiBaseUrl: string;
  message: string;
}
```

Typical fix:

- inspect API reachability and bot auth

### `GATEWAY_IDENTIFY_UNAVAILABLE`

Type: `GatewayTransportError`

Meaning:

- the transport reached startup but could not build an identify payload

Retryable:

- `false`

Details:

```ts
{
  hasIdentifyPayload: boolean;
  hasIdentifyBuilder: boolean;
  hasAuth: boolean;
}
```

Typical fix:

- provide `identifyPayload`, `buildIdentifyPayload`, or enough auth/config to generate one

### `GATEWAY_UNKNOWN_ERROR`

Type: `GatewayTransportError`

Meaning:

- the transport caught a non-`Error` failure value and wrapped it

Retryable:

- `false`

Details:

```ts
{
  value: unknown;
}
```

Typical fix:

- inspect the wrapped `details.value`
- treat as an internal or integration bug until narrowed down

## Protocol Errors

### `GATEWAY_PAYLOAD_PARSE_FAILED`

Type: `GatewayProtocolError`

Meaning:

- the incoming gateway payload was a string but not valid JSON

Retryable:

- `false`

Details:

```ts
{
  rawData: string;
}
```

Typical fix:

- inspect the server or gateway proxy for malformed frames

### `GATEWAY_MESSAGE_CREATE_INVALID`

Type: `GatewayProtocolError`

Meaning:

- a `MESSAGE_CREATE` payload reached the default message parser but was missing required fields or contained an invalid timestamp

Retryable:

- `false`

Details:

```ts
{
  payload: unknown;
}
```

Typical fix:

- inspect the inbound event shape from the Fluxer instance or proxy
- verify the payload still matches the documented message-create contract before it reaches bot code

### `GATEWAY_HELLO_INVALID`

Type: `GatewayProtocolError`

Meaning:

- a `HELLO` payload was received without a valid positive heartbeat interval

Retryable:

- `true`

Details:

```ts
{
  heartbeatInterval: number | null;
}
```

Typical fix:

- inspect gateway protocol compatibility
- confirm the server is actually speaking the expected Fluxer/Discord-style gateway contract

### `GATEWAY_RECONNECT_REQUESTED`

Type: `GatewayProtocolError`

Meaning:

- the server sent an explicit reconnect opcode

Retryable:

- `true`

Typical fix:

- usually no manual fix is needed beyond observing whether reconnect succeeds

### `GATEWAY_INVALID_SESSION`

Type: `GatewayProtocolError`

Meaning:

- the server invalidated the current session

Retryable:

- `true`

Notes:

- if the invalid-session payload allows resume, the transport preserves the session identity and attempts resume on reconnect
- otherwise it clears the session identity and falls back to identify

Typical fix:

- inspect earlier auth or sequencing issues if invalid sessions happen repeatedly

## Practical Usage

Typical handling pattern:

```ts
client.on("error", (error) => {
  if (error instanceof GatewayTransportError) {
    console.error(error.code, error.retryable, error.details);
  }
});
```

If you need all low-level frames and unsupported dispatches, combine this error reference with [GatewayEventContract.md](./GatewayEventContract.md).

