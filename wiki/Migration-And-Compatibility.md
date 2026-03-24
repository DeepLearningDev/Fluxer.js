# Migration And Compatibility

## Current Compatibility Stance

Fluxer.JS is still alpha.

That means:

- the public API is intended for consumers, but not fully frozen
- package-root exports are the supported path
- deep imports should not be treated as stable
- meaningful breaking changes should be called out in the changelog

## Migration Context

If you are coming from `discord.js`, start with:

- [Migration From DiscordJS](../docs/MigrationFromDiscordJS.md)

## What To Watch During Alpha

- gateway assumptions that still depend on Discord-compatible behavior
- API shape refinements before beta
- narrow REST coverage relative to a long-term full platform client
- release notes for meaningful public contract changes

## Best Current Use

- experimentation
- internal bot work where the team is comfortable upgrading with the changelog in hand
- framework evaluation before beta
