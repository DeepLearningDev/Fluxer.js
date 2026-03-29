# First Real Bot

This is the shortest honest path from a working mock bot to a real Fluxer bot.

Use this after the local `MockTransport` flow already makes sense.

## Goal

Check four things in order:

1. the instance can be discovered
2. the gateway/bootstrap path works
3. the bot can stay connected
4. the bot can reply to a real `!ping`

## 1. Start From The In-Repo Bootstrap Example

Fluxer.JS already ships a real bot example at:

- `src/examples/real-instance-bootstrap.ts`

That example:

- creates a real `FluxerBot`
- registers a `!ping` command
- connects through `createFluxerPlatformTransport(...)`
- fetches the current bot identity
- optionally sends a startup message into a real channel

## 2. Set The Required Environment

Required:

```bash
export FLUXER_INSTANCE_URL="https://api.fluxer.app"
export FLUXER_TOKEN="your-token"
```

Recommended for the first real command check:

```bash
export FLUXER_KEEP_ALIVE="1"
```

Optional:

```bash
export FLUXER_INTENTS="513"
export FLUXER_BOOTSTRAP_CHANNEL_ID="general"
```

`FLUXER_BOOTSTRAP_CHANNEL_ID` is useful when you want the script to send one startup message after connect so you can verify outbound REST and channel access immediately.

## 3. Run The Bot

```bash
npm run dev:platform
```

If the path works, you should see:

- instance/bootstrap debug output
- gateway state changes
- current bot identity
- an optional startup message send
- a message telling you to send `!ping`

## 4. Verify The First Real Reply

Once the script is running in keep-alive mode:

1. open a text channel the bot can read
2. send `!ping`
3. confirm the bot replies with `pong`

That is the first real end-to-end bot check for Fluxer.JS.

## Success Shape

The path is successful when:

- the script connects without a typed bootstrap error
- the current bot user is fetched successfully
- the optional startup message is accepted when a bootstrap channel is configured
- the bot replies to `!ping` in a real channel

## Failure Handling

### `PLATFORM_DISCOVERY_FAILED`

Meaning:

- the instance discovery document could not be fetched

Check:

- `FLUXER_INSTANCE_URL`
- DNS and TLS reachability
- reverse-proxy and API exposure

### `PLATFORM_GATEWAY_INFO_FAILED`

Meaning:

- discovery worked, but gateway bootstrap failed

Check:

- bot token validity
- API auth behavior
- whether the instance exposes bot gateway bootstrap correctly

### `INSTANCE_CAPABILITY_UNSUPPORTED`

Meaning:

- the instance does not advertise the capabilities needed for platform transport bootstrap

Check:

- instance feature support
- whether bot gateway support is enabled on that instance

### `REST_HTTP_ERROR`

Meaning:

- the startup message or another outbound request received a non-2xx response

Check:

- channel permissions
- bot auth scope
- whether the channel ID is valid

### `REST_REQUEST_FAILED`

Meaning:

- the outbound request failed before a response arrived

Check:

- network path to the API
- proxy behavior
- DNS and TLS

### `GATEWAY_RECONNECT_EXHAUSTED`

Meaning:

- the websocket session could not recover

Check:

- gateway reachability
- proxy websocket support
- whether the instance is closing bot sessions unexpectedly

## Why This Matters

Mock-first confidence and real-instance confidence are not the same thing.

Fluxer.JS now gives you a narrow but concrete first-real-bot path:

- local mock bot first
- real bootstrap next
- real reply verification after that

That is a better onboarding shape than jumping straight from docs into a broad live contract promise.

For a stronger repeatable instance check after the first real reply, see [LiveInstanceContractHarness.md](./LiveInstanceContractHarness.md).
