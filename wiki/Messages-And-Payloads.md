# Messages And Payloads

## Builder Surface

- `MessageBuilder`
- `EmbedBuilder`
- `AttachmentBuilder`

These builders are the intended high-level path for rich outbound payloads.

## Payload Helpers

- `createEmbedTemplate(...)`
- `createMessageTemplate(...)`
- `serializeMessagePayload(...)`
- `validateMessagePayload(...)`

Use these when you want reusable payload shapes, serializer previews, or explicit validation before the transport layer sends anything.

## Practical Notes

- attachment-backed embed references are supported
- JSON attachment generation is built in through `AttachmentBuilder#setJson(...)`
- invalid payloads are rejected intentionally rather than sent optimistically

Reference:

- [Payload Builders](../docs/PayloadBuilders.md)
