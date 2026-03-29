# Release Policy

`Fluxer.JS` is currently in the `alpha` channel.

The package version is now `0.1.0-alpha.1`, which reflects two things:

- the framework is intentionally usable for real experimentation
- the public API is not yet locked to stable compatibility expectations
- release verification proves package quality gates, not full protocol completeness

## Release channels

### Alpha

Alpha releases are for rapid iteration on the framework foundation.

Expect:

- frequent additions
- contract tightening
- public API refinements when they materially improve correctness or developer ergonomics
- release notes to call out any meaningful breaking changes explicitly

Alpha releases are appropriate for:

- early adopters
- framework experimentation
- internal bots where the team is comfortable upgrading with the changelog in hand

Current alpha caveats:

- the package is ESM-only
- Node `>=20` is required
- the runtime is test-backed, but the Fluxer gateway lifecycle contract is still partially inferred from Discord-compatible guidance while dedicated Fluxer lifecycle docs remain incomplete
- the REST layer is still intentionally narrow, but it now covers bootstrap/discovery plus core channel reads and message operations: fetch channel, list messages, send, fetch, edit, and delete messages
- the REST lifecycle negative paths now have focused coverage too, including rate-limit metadata precedence and invalid-response handling for list, fetch, edit, and delete flows
- real-instance bootstrap through `createFluxerPlatformTransport(...)` exposes typed `PlatformBootstrapError` failures for discovery, gateway-info, and unsupported-capability startup paths
- REST rate limits are surfaced as typed errors with retry metadata when available, but automatic retry/backoff is not implemented yet

### Beta

Beta releases will begin once the runtime and package surface are closer to the intended 1.0 shape.

Expect:

- slower API churn
- stronger upgrade guidance
- higher confidence around plugin packaging conventions
- fewer breaking changes, but still not a stable guarantee

### Stable

Stable releases begin at `1.0.0`.

Expect:

- semantic versioning to be enforced for documented public APIs
- breaking changes only in major versions
- changelog and migration notes for major transitions

## Versioning rules

While the project is pre-1.0:

- patch versions are for fixes, docs, and small non-disruptive additions
- minor versions may still include breaking changes if needed to improve the framework surface
- pre-release identifiers like `alpha.1`, `beta.0`, and so on communicate readiness more clearly than plain `0.x`

Once the project reaches `1.0.0`:

- `major` means breaking changes to documented public APIs
- `minor` means backward-compatible features
- `patch` means backward-compatible fixes and polish

## Release checks

Before publishing, the repo should pass:

- `npm run lint`
- `npm run check`
- `npm test`
- `npm run build`
- `npm run smoke:minimal`
- `npm run smoke:package`
- `npm run pack:dry-run`

The package now exposes `npm run release:check` and runs it automatically through `prepublishOnly`.

These checks are also enforced in GitHub Actions:

- `.github/workflows/ci.yml` runs `release:check` on pushes and pull requests as the single authoritative verification step
- `.github/workflows/release-verify.yml` runs the same release verification path on version tags and manual release verification runs

`smoke:package` is intended to catch packaging regressions that `pack:dry-run` cannot catch by itself. It performs a real `npm pack`, installs the tarball into a temporary consumer project, imports the package through its published entrypoint, runs both a mock bot flow and a fake-instance composed platform-transport smoke through the public API, and typechecks a small TypeScript consumer against the published `.d.ts` surface.

The repo also exposes an opt-in live harness through `npm run dev:contract` for real Fluxer instances. That harness is intentionally outside the default release gate because it depends on a live instance and real credentials.

## Changelog expectations

Every release should update:

- `CHANGELOG.md`
- any relevant migration docs
- any relevant guarantees or error/reference docs if behavior changed
