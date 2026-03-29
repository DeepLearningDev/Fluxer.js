# Hosted Instance Confidence

This is the honest hosted-platform confidence path in the repo.

Use it when the official hosted Fluxer API is your target and the stronger bot-runtime harness is not available because the hosted platform does not advertise `gatewayBot`.

## What It Proves

- discovery succeeds
- a hosted gateway session can be started from the discovery gateway URL
- the current bot identity can be fetched
- the same bot identity can be fetched again through `fetchUser(...)`
- the target channel can be fetched
- outbound typing and outbound message send succeed
- the sent probe shows up again through live channel reads
- the confirmed probe can be fetched directly by message ID
- the confirmed probe can be edited and re-fetched with the edited content intact
- the edited probe can be deleted and confirmed absent through a typed 404 fetch failure
- the deleted probe is also confirmed absent from recent channel history

This is intentionally narrower than the self-hosted live contract harness because it does not prove the stronger bot-gateway bootstrap path or bot-runtime command handling.

## Required Environment

```bash
export FLUXER_INSTANCE_URL="https://api.fluxer.app"
export FLUXER_TOKEN="your-token"
export FLUXER_CONTRACT_CHANNEL_ID="general"
```

The hosted path also auto-loads these files automatically when present:

- `.env.contract.local`
- `.env.contract`
- `.env.local`
- `.env`

Optional:

```bash
export FLUXER_HOSTED_LIST_LIMIT="10"
export FLUXER_HOSTED_TIMEOUT_MS="5000"
export FLUXER_HOSTED_MESSAGE_PREFIX="Fluxer.JS hosted confidence probe"
export FLUXER_HOSTED_REPORT_PATH="./artifacts/hosted-confidence-report.json"
```

Fallback compatibility:

- `FLUXER_CONTRACT_LIST_LIMIT`
- `FLUXER_CONTRACT_TIMEOUT_MS`
- `FLUXER_CONTRACT_MESSAGE_PREFIX`
- `FLUXER_CONTRACT_REPORT_PATH`

## Run It

```bash
npm run dev:hosted
```

If the hosted path succeeds, it will:

- discover the instance
- fetch the current bot user
- fetch that same bot again through `fetchUser(currentUser.id)`
- fetch the contract channel
- send a typing indicator
- send a unique probe message
- verify that the same probe appears in recent channel history
- fetch that confirmed probe directly through `fetchMessage(...)`
- edit that confirmed probe and fetch it again to verify the edited content
- delete that probe and verify that `fetchMessage(...)` now fails with the expected typed 404 path
- confirm that the deleted probe no longer appears in recent channel history either

If `FLUXER_HOSTED_REPORT_PATH` is set, the path also writes a JSON report with:

- run timestamps
- instance capability snapshot
- current bot identity plus a direct `fetchUser(...)` proof
- probe content, confirmed message ID, direct fetch confirmation, edited-message confirmation, delete confirmation, and deleted-history absence confirmation
- typed failure metadata when the run fails

You can turn that JSON artifact into a markdown summary with:

```bash
npm run report:hosted -- ./artifacts/hosted-confidence-report.json ./artifacts/hosted-confidence-report.md
```

## When To Use This

Use `dev:platform` when you want the first honest live connect path.

Use `dev:contract` when you are targeting a self-hosted or otherwise bot-gateway-capable instance and you want the stronger full bot-runtime contract.

Use `dev:hosted` when you are targeting the official hosted Fluxer platform and want an honest read/write confidence path without pretending gateway-bot support exists.

## Related Guides

- [RealInstanceBootstrap.md](./RealInstanceBootstrap.md)
- [FirstRealBot.md](./FirstRealBot.md)
- [LiveInstanceContractHarness.md](./LiveInstanceContractHarness.md)
