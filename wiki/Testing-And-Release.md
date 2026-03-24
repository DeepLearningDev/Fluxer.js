# Testing And Release

## Testing Model

Fluxer.JS is currently mock-first.

Primary tools:

- `MockTransport`
- `FluxerTestRuntime`
- fixture helpers

This gives the repo good local confidence, but it is still not the same thing as broad live contract testing against a real Fluxer instance.

## Release Gate

The single release gate is:

```bash
npm run release:check
```

That path currently includes:

- lint
- typecheck
- tests
- build
- built-example smoke test
- installed-package smoke test
- pack dry run

## Beta Direction

Fluxer.JS moves toward beta through narrow, reviewable slices:

- tighten runtime confidence
- keep docs honest
- prove real consumer paths
- avoid broad unstable surface jumps

Reference:

- [Release Policy](../docs/ReleasePolicy.md)
