# Gateway Event Contract

This document describes the current event contract exposed by `FluxerClient` for gateway-driven runtime behavior.

The contract has two layers:

- raw dispatch access through `gatewayDispatch`
- normalized higher-level events emitted by `FluxerClient` when the incoming payload has the minimum required fields

If a dispatch is not normalized yet, it is still available through `gatewayDispatch`.

## Raw Dispatch Layer

Raw gateway dispatches are emitted as `gatewayDispatch` with the shape:

```ts
interface FluxerGatewayDispatchEvent<T = unknown> {
  type: string;
  sequence: number | null;
  data: T;
  raw: {
    op: number;
    d: T;
    s: number | null;
    t: string | null;
  };
}
```

This is the escape hatch for unsupported or newly introduced Fluxer dispatch types.

## Runtime Gateway Surfaces

These events are part of the gateway/runtime contract even though they are not direct dispatch normalizations.

### `gatewayStateChange`

Emitted whenever the transport connection state changes.

```ts
interface FluxerGatewayStateChangeEvent {
  previousState: "idle" | "connecting" | "connected" | "identifying" | "resuming" | "ready" | "reconnecting" | "disconnected";
  state: "idle" | "connecting" | "connected" | "identifying" | "resuming" | "ready" | "reconnecting" | "disconnected";
  reason?: string;
}
```

### `gatewaySessionUpdate`

Emitted whenever the tracked session metadata changes.

```ts
interface FluxerGatewaySession {
  sessionId?: string;
  sequence: number | null;
  resumable: boolean;
}
```

### `debug`

Structured runtime diagnostics emitted by transport, gateway, client, and command layers.

```ts
interface FluxerDebugEvent {
  scope: "gateway" | "transport" | "client" | "command";
  event: string;
  timestamp: string;
  level?: "debug" | "info" | "warn" | "error";
  data?: Record<string, unknown>;
}
```

### `error`

Emitted for typed transport/protocol failures and other runtime errors.

## Normalized Gateway Events

The sections below describe the current normalized event surface, the source dispatches, and the emitted payload shape.

### Messages

#### `messageCreate`

Emitted from the transport `onMessage(...)` path, not directly from the client dispatch switch. In practice this is usually fed by gateway parsing, but the exact source depends on the transport.

```ts
interface FluxerMessage {
  id: string;
  content: string;
  author: FluxerUser;
  channel: FluxerChannel;
  createdAt: Date;
}
```

#### `messageUpdate`

Source dispatch: `MESSAGE_UPDATE`

Emitted only when the payload includes:

- `id`
- `author.id`
- `author.username`
- `channel_id`

Emitted payload:

```ts
interface FluxerMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    displayName?: string;
    isBot?: boolean;
  };
  channel: {
    id: string;
    name: string;
    type: "text";
  };
  createdAt: Date;
}
```

Normalization notes:

- `channel.name` is currently normalized to the `channel_id`
- `channel.type` is currently normalized as `"text"`
- `content` defaults to `""` if absent
- `createdAt` falls back to `new Date()` if `timestamp` is absent

#### `messageDelete`

Source dispatch: `MESSAGE_DELETE`

Emitted only when the payload includes:

- `id`
- `channel_id`

Emitted payload:

```ts
{
  id: string;
  channelId: string;
  guildId?: string;
}
```

### Reactions

#### `messageReactionAdd`
#### `messageReactionRemove`

Source dispatches:

- `MESSAGE_REACTION_ADD`
- `MESSAGE_REACTION_REMOVE`

Emitted only when the payload includes:

- `user_id`
- `channel_id`
- `message_id`
- `emoji`

Emitted payload:

```ts
interface FluxerReactionEvent {
  userId: string;
  channelId: string;
  messageId: string;
  guildId?: string;
  emoji: {
    id?: string;
    name?: string;
    animated?: boolean;
  };
}
```

### Channels

#### `channelCreate`
#### `channelUpdate`

Source dispatches:

- `CHANNEL_CREATE`
- `CHANNEL_UPDATE`

Emitted only when the payload includes:

- `id`
- `name`
- `type`

Emitted payload:

```ts
interface FluxerChannel {
  id: string;
  name: string;
  type: "dm" | "group" | "text";
}
```

#### `channelDelete`

Source dispatch: `CHANNEL_DELETE`

Emitted only when the payload includes:

- `id`

Emitted payload:

```ts
{
  id: string;
  guildId?: string;
}
```

### Guilds

#### `guildCreate`
#### `guildUpdate`

Source dispatches:

- `GUILD_CREATE`
- `GUILD_UPDATE`

Emitted only when the payload includes:

- `id`
- `name`

Emitted payload:

```ts
interface FluxerGuild {
  id: string;
  name: string;
  iconUrl?: string;
}
```

#### `guildDelete`

Source dispatch: `GUILD_DELETE`

Emitted only when the payload includes:

- `id`

Emitted payload:

```ts
{
  id: string;
}
```

### Roles

#### `roleCreate`
#### `roleUpdate`

Source dispatches:

- `GUILD_ROLE_CREATE`
- `GUILD_ROLE_UPDATE`

Emitted only when the payload includes:

- `guild_id`
- `role.id`
- `role.name`

Emitted payload:

```ts
interface FluxerRole {
  id: string;
  guildId: string;
  name: string;
  color?: number;
  position?: number;
  permissions?: string;
}
```

#### `roleDelete`

Source dispatch: `GUILD_ROLE_DELETE`

Emitted only when the payload includes:

- `guild_id`
- `role_id`

Emitted payload:

```ts
{
  id: string;
  guildId: string;
}
```

### Members

#### `guildMemberAdd`
#### `guildMemberUpdate`

Source dispatches:

- `GUILD_MEMBER_ADD`
- `GUILD_MEMBER_UPDATE`

Emitted only when the payload includes:

- `guild_id`
- `user.id`
- `user.username`

Emitted payload:

```ts
interface FluxerGuildMember {
  user: FluxerUser;
  guildId: string;
  nickname?: string;
  roles?: string[];
  joinedAt?: Date;
}
```

#### `guildMemberRemove`

Source dispatch: `GUILD_MEMBER_REMOVE`

Emitted only when the payload includes:

- `guild_id`
- `user.id`
- `user.username`

Emitted payload:

```ts
{
  guildId: string;
  user: FluxerUser;
}
```

### Moderation

#### `guildBanAdd`
#### `guildBanRemove`

Source dispatches:

- `GUILD_BAN_ADD`
- `GUILD_BAN_REMOVE`

Emitted only when the payload includes:

- `guild_id`
- `user.id`
- `user.username`

Emitted payload:

```ts
interface FluxerBanEvent {
  guildId: string;
  user: FluxerUser;
}
```

### Invites

#### `inviteCreate`
#### `inviteDelete`

Source dispatches:

- `INVITE_CREATE`
- `INVITE_DELETE`

Emitted only when the payload includes:

- `code`

Emitted payload:

```ts
interface FluxerInvite {
  code: string;
  channelId?: string;
  guildId?: string;
  inviter?: FluxerUser;
  uses?: number;
  maxUses?: number;
  maxAgeSeconds?: number;
  temporary?: boolean;
  createdAt?: Date;
  expiresAt?: Date;
}
```

Normalization notes:

- `createdAt` is derived from `created_at` when present
- `expiresAt` is derived from `expires_at` when present and non-null
- `inviter` is only present when the inviter object has both `id` and `username`

### Presence And Typing

#### `presenceUpdate`

Source dispatch: `PRESENCE_UPDATE`

Emitted only when the payload includes:

- `user.id`
- `status`

Emitted payload:

```ts
interface FluxerPresence {
  userId: string;
  status: "online" | "idle" | "dnd" | "offline" | "invisible" | string;
  activities?: Array<{
    name: string;
    type?: number;
  }>;
}
```

Normalization notes:

- activities are filtered so only entries with a string `name` survive normalization

#### `typingStart`

Source dispatch: `TYPING_START`

Emitted only when the payload includes:

- `channel_id`
- `user_id`

Emitted payload:

```ts
interface FluxerTypingStartEvent {
  channelId: string;
  userId: string;
  guildId?: string;
  startedAt?: Date;
}
```

Normalization notes:

- `startedAt` is derived from a Unix-seconds `timestamp` when present

#### `userUpdate`

Source dispatch: `USER_UPDATE`

Emitted only when the payload includes:

- `id`
- `username`

Emitted payload:

```ts
interface FluxerUser {
  id: string;
  username: string;
  displayName?: string;
  isBot?: boolean;
}
```

### Voice

#### `voiceStateUpdate`

Source dispatch: `VOICE_STATE_UPDATE`

Emitted only when the payload includes:

- `user_id`
- `session_id`

Emitted payload:

```ts
interface FluxerVoiceState {
  guildId?: string;
  channelId?: string;
  userId: string;
  sessionId: string;
  deaf?: boolean;
  mute?: boolean;
  selfDeaf?: boolean;
  selfMute?: boolean;
  selfStream?: boolean;
  selfVideo?: boolean;
  suppress?: boolean;
}
```

Normalization notes:

- `channel_id: null` is normalized to `channelId: undefined`

#### `voiceServerUpdate`

Source dispatch: `VOICE_SERVER_UPDATE`

Emitted only when the payload includes:

- `guild_id`
- `token`

Emitted payload:

```ts
interface FluxerVoiceServerUpdate {
  guildId: string;
  token: string;
  endpoint?: string;
}
```

Normalization notes:

- `endpoint: null` is normalized to `endpoint: undefined`

## Normalization Rules

The client normalizes conservatively.

- Events are only emitted when the minimum required fields are present.
- Unknown or partially populated payloads should still be read from `gatewayDispatch`.
- The emitted payload shape is the SDK contract; raw gateway shapes are not.

## Current Gaps

The following remain intentionally outside the normalized contract for now:

- any dispatch family not listed above
- payload-specific fields not represented in the emitted SDK interfaces
- Fluxer-specific protocol features that are not yet documented or stable enough to model confidently
