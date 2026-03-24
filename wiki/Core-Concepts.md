# Core Concepts

## Main Runtime Types

- `FluxerClient`: owns transports, emits events, and connects bot logic to inbound and outbound behavior
- `FluxerBot`: owns commands, guards, middleware, hooks, modules, and plugins
- `FluxerTransport`: the contract behind mock, REST, gateway, and composed platform transport behavior

## Composition Model

- commands define behavior
- guards define access decisions
- middleware defines cross-cutting execution behavior
- hooks define lifecycle reactions
- modules group related commands and setup
- plugins package higher-level features

## Public Surface Rule

Use package-root exports from `fluxer-js`.

Avoid deep imports into internal files. The package-root API is the intended consumer surface, especially while the project is still alpha.

## Helpful Next Reads

- [Commands And Conversations](./Commands-And-Conversations.md)
- [Transport And Runtime](./Transport-And-Runtime.md)
- [API Guarantees](../docs/ApiGuarantees.md)
