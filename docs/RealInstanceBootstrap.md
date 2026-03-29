# Real Instance Bootstrap

This is the narrowest honest path for checking Fluxer.JS against a real Fluxer instance.

## What It Proves

- discovery succeeds
- gateway bootstrap succeeds
- the client can connect
- the current bot identity can be fetched

It does **not** prove the full framework contract. It is a real-instance smoke path, not a full live contract matrix.

## Run It

Set the required environment variables first:

```bash
export FLUXER_INSTANCE_URL="https://api.fluxer.app"
export FLUXER_TOKEN="your-token"
```

Optional:

```bash
export FLUXER_INTENTS="513"
export FLUXER_KEEP_ALIVE="1"
```

Then run:

```bash
npm run dev:platform
```

If the bootstrap works, the script will:

- print instance/bootstrap debug events
- connect the client
- fetch the current bot user
- disconnect automatically unless `FLUXER_KEEP_ALIVE=1`

## Failure Shape

If platform bootstrap fails, the script prints the typed `PlatformBootstrapError` code and details.

Common examples:

- `PLATFORM_DISCOVERY_FAILED`
- `PLATFORM_GATEWAY_INFO_FAILED`
- `INSTANCE_CAPABILITY_UNSUPPORTED`

## Why This Exists

Fluxer.JS is still mock-first in tests. This script gives developers a concrete first-real-instance path without pretending the whole release gate is live-backed.
