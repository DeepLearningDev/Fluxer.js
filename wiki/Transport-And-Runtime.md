# Transport And Runtime

## Transport Choices

- `MockTransport`: local development and deterministic tests
- `RestTransport`: HTTP-based bot operations
- `GatewayTransport`: realtime inbound events over WebSocket
- `PlatformTransport`: composed inbound gateway plus outbound REST path

## Recommended Path

1. Start with `MockTransport`.
2. Prove command behavior locally.
3. Move to `createFluxerPlatformTransport(...)` when real instance connectivity matters.

## Runtime Notes

- gateway state changes are surfaced through `gatewayStateChange`
- session updates are surfaced through `gatewaySessionUpdate`
- transport and protocol failures surface typed errors
- reconnect and resume behavior exist, but the lifecycle contract is still partly inferred from Discord-compatible guidance

## Diagnostics

Key error families:

- `DiscoveryError`
- `PlatformBootstrapError`
- `GatewayTransportError`
- `GatewayProtocolError`
- `RestTransportError`
- `PayloadValidationError`

Reference docs:

- [Gateway Error Codes](../docs/GatewayErrorCodes.md)
- [REST Error Codes](../docs/RestErrorCodes.md)
