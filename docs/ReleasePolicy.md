# Release Policy

`Fluxer.JS` is currently in the `alpha` channel.

The package version is now `0.1.0-alpha.0`, which reflects two things:

- the framework is intentionally usable for real experimentation
- the public API is not yet locked to stable compatibility expectations

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

- `npm run check`
- `npm test`
- `npm run build`
- `npm run pack:dry-run`

The package now exposes `npm run release:check` and runs it automatically through `prepublishOnly`.

## Changelog expectations

Every release should update:

- `CHANGELOG.md`
- any relevant migration docs
- any relevant guarantees or error/reference docs if behavior changed
