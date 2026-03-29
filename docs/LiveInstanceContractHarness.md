# Live Instance Contract Harness

This is the stronger repeatable self-hosted or bot-gateway-capable live-instance confidence layer in the repo.

Use it after the first-real-bot path already makes sense.

## What It Proves

- discovery succeeds
- gateway bootstrap succeeds
- the client can connect
- the current bot identity can be fetched
- the target contract channel can be fetched
- outbound typing and outbound message send succeed
- the sent probe shows up again through live channel reads

This is stronger than the first bootstrap smoke, but it is still not a full live contract matrix.

## Required Environment

```bash
export FLUXER_INSTANCE_URL="https://your-self-hosted-fluxer-api"
export FLUXER_TOKEN="your-token"
export FLUXER_CONTRACT_CHANNEL_ID="<your-channel-id>"
```

`FLUXER_CONTRACT_CHANNEL_ID` should be the channel ID, not the display name.

The harness also loads these files automatically when present:

- `.env.contract.local`
- `.env.contract`
- `.env.local`
- `.env`

Optional:

```bash
export FLUXER_INTENTS="513"
export FLUXER_CONTRACT_LIST_LIMIT="10"
export FLUXER_CONTRACT_TIMEOUT_MS="5000"
export FLUXER_CONTRACT_MESSAGE_PREFIX="Fluxer.JS live contract probe"
export FLUXER_KEEP_ALIVE="1"
export FLUXER_CONTRACT_REPORT_PATH="./artifacts/live-contract-report.json"
```

## Run It

```bash
npm run dev:contract
```

This path currently expects an instance that advertises both `gateway` and `gatewayBot`.

If you are targeting the official hosted Fluxer API and only need an honest live read/write confidence path, use [`HostedInstanceConfidence.md`](./HostedInstanceConfidence.md) and run `npm run dev:hosted` instead.

If the harness succeeds, it will:

- connect through `createFluxerPlatformTransport(...)`
- fetch the current bot user
- fetch the contract channel
- send a typing indicator
- send a unique probe message
- verify that the same probe appears in recent channel history

If `FLUXER_KEEP_ALIVE=1`, the harness stays connected after the probe and tells you to send `!ping` for a manual reply check.

If `FLUXER_CONTRACT_REPORT_PATH` is set, the harness also writes a JSON report with:

- run timestamps
- step-by-step pass/fail status
- current bot identity
- probe content and confirmed message ID
- typed failure metadata when the run fails

You can turn that JSON artifact into a markdown summary with:

```bash
npm run report:contract -- ./artifacts/live-contract-report.json ./artifacts/live-contract-report.md
```

## Failure Shape

The harness prints typed failures where possible.

Common examples:

- `PLATFORM_DISCOVERY_FAILED`
- `PLATFORM_GATEWAY_INFO_FAILED`
- `INSTANCE_CAPABILITY_UNSUPPORTED`
- `REST_HTTP_ERROR`
- `REST_REQUEST_FAILED`
- `REST_RATE_LIMITED`
- `REST_RESPONSE_INVALID`
- `GATEWAY_RECONNECT_EXHAUSTED`

## When To Use This

Use `dev:platform` when you want the first honest live connect path.

Use `dev:contract` when you want a stronger repeatable real-instance check that proves:

- connect
- channel access
- outbound write
- read-back through live channel history

Use `dev:hosted` when you are targeting the official hosted Fluxer platform and need the narrower read/write confidence path without gateway-bot requirements.

## Related Guides

- [RealInstanceBootstrap.md](./RealInstanceBootstrap.md)
- [FirstRealBot.md](./FirstRealBot.md)
- [HostedInstanceConfidence.md](./HostedInstanceConfidence.md)
