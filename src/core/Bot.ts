import { resolveMessagePayload } from "./builders.js";
import { parseCommandInput, tokenizeCommandInput } from "./CommandParser.js";
import {
  formatCommandUsage,
  isCommandGroup,
  parseCommandSchemaInput
} from "./CommandSchema.js";
import type { FluxerClient } from "./Client.js";
import { CommandSchemaError } from "./errors.js";
import type {
  CommandContext,
  FluxerCommand,
  FluxerCommandGroup,
  FluxerCommandExecutionHooks,
  FluxerCommandSchema,
  FluxerCommandGuard,
  FluxerCommandMiddleware,
  FluxerModule,
  FluxerBotOptions,
  FluxerMessage
} from "./types.js";
import type { FluxerPlugin } from "./types.js";

type AnyCommand = FluxerCommand<FluxerCommandSchema | undefined>;
type AnyCommandGroup = FluxerCommandGroup;

export class FluxerBot {
  readonly name: string;
  readonly prefix: string;
  readonly ignoreBots: boolean;
  readonly caseSensitiveCommands: boolean;

  #client?: FluxerClient;
  #commands = new Map<string, AnyCommand>();
  #commandGroups = new Map<string, AnyCommandGroup>();
  #guards: FluxerCommandGuard[] = [];
  #middleware: FluxerCommandMiddleware[] = [];
  #hookSets: FluxerCommandExecutionHooks[] = [];
  #modules = new Set<string>();
  #plugins = new Set<string>();

  public constructor(options: FluxerBotOptions) {
    this.name = options.name;
    this.prefix = options.prefix ?? "!";
    this.ignoreBots = options.ignoreBots ?? true;
    this.caseSensitiveCommands = options.caseSensitiveCommands ?? false;
    this.#guards = [...(options.guards ?? [])];
    this.#middleware = [...(options.middleware ?? [])];
    if (options.hooks) {
      this.#hookSets.push(options.hooks);
    }
  }

  public attach(client: FluxerClient): void {
    this.#client = client;
    this.#emitDebug({
      scope: "command",
      event: "bot_attached",
      level: "info",
      data: {
        botName: this.name
      }
    });
  }

  public command<TSchema extends FluxerCommandSchema | undefined>(
    command: FluxerCommand<TSchema> | FluxerCommandGroup
  ): this {
    if (isCommandGroup(command)) {
      this.#registerCommandGroup(command);
      return this;
    }

    this.#registerCommandKey(command.name, command as unknown as AnyCommand);

    for (const alias of command.aliases ?? []) {
      this.#registerCommandKey(alias, command as unknown as AnyCommand);
    }

    return this;
  }

  public use(middleware: FluxerCommandMiddleware): this {
    this.#middleware.push(middleware);
    return this;
  }

  public guard(guard: FluxerCommandGuard): this {
    this.#guards.push(guard);
    return this;
  }

  public hooks(hooks: FluxerCommandExecutionHooks): this {
    this.#hookSets.push(hooks);
    return this;
  }

  public module(module: FluxerModule): this {
    if (this.#modules.has(module.name)) {
      return this;
    }

    const setupResult = this.#applyModule(module);
    if (module.setup && this.#isPromiseLike(setupResult)) {
      throw new Error(
        `Module "${module.name}" has async setup. Use installModule() instead of module().`
      );
    }

    return this;
  }

  public async installModule(module: FluxerModule): Promise<this> {
    if (this.#modules.has(module.name)) {
      return this;
    }

    await Promise.resolve(this.#applyModule(module));
    return this;
  }

  #applyModule(module: FluxerModule): Promise<void> | void {
    this.#modules.add(module.name);

    for (const command of module.commands ?? []) {
      this.command(command);
    }

    for (const guard of module.guards ?? []) {
      this.guard(guard);
    }

    for (const middleware of module.middleware ?? []) {
      this.use(middleware);
    }

    if (module.hooks) {
      this.hooks(module.hooks);
    }

    return module.setup?.(this);
  }

  public get modules(): string[] {
    return [...this.#modules];
  }

  public plugin(plugin: FluxerPlugin): this {
    if (this.#plugins.has(plugin.name)) {
      return this;
    }

    for (const module of plugin.modules ?? []) {
      this.module(module);
    }

    if (plugin.setup) {
      const result = plugin.setup({ bot: this });
      if (this.#isPromiseLike(result)) {
        throw new Error(
          `Plugin "${plugin.name}" has async setup. Use installPlugin() instead of plugin().`
        );
      }
    }

    this.#plugins.add(plugin.name);
    return this;
  }

  public async installPlugin(plugin: FluxerPlugin): Promise<this> {
    if (this.#plugins.has(plugin.name)) {
      return this;
    }

    for (const module of plugin.modules ?? []) {
      await this.installModule(module);
    }

    await Promise.resolve(plugin.setup?.({ bot: this }));
    this.#plugins.add(plugin.name);
    return this;
  }

  public get plugins(): string[] {
    return [...this.#plugins];
  }

  public get commands(): AnyCommand[] {
    return [...new Set(this.#commands.values())];
  }

  public hasCommand(name: string): boolean {
    return this.#commands.has(this.#normalizeCommandKey(name));
  }

  public getCommand(name: string): AnyCommand | undefined {
    return this.#commands.get(this.#normalizeCommandKey(name));
  }

  public resolveCommandGroup(input: string): AnyCommandGroup | undefined {
    const tokens = tokenizeCommandInput(input.trim());
    const match = this.#findLongestCommandGroupMatch(tokens);
    return match?.group;
  }

  public resolveCommandFromInput(input: string): AnyCommand | undefined {
    const tokens = tokenizeCommandInput(input.trim());
    const match = this.#findLongestCommandMatch(tokens);
    return match?.command;
  }

  public async handleMessage(message: FluxerMessage): Promise<void> {
    if (!this.#client) {
      throw new Error(`Bot "${this.name}" is not attached to a FluxerClient.`);
    }

    if (this.ignoreBots && message.author.isBot) {
      return;
    }

    const invocation = this.#resolveCommandInvocation(message.content);
    if (!invocation) {
      return;
    }

    const { commandName, args, command } = invocation;
    if (!command) {
      this.#emitDebug({
        scope: "command",
        event: "command_not_found",
        level: "debug",
        data: {
          botName: this.name,
          commandName
        }
      });
      await this.#runHook("commandNotFound", {
        client: this.#client,
        bot: this,
        message,
        commandName,
        args
      });
      return;
    }

    const context: CommandContext = {
      client: this.#client,
      bot: this,
      command,
      message,
      args,
      input: null,
      commandName,
      state: {},
      reply: async (replyMessage) => {
        await this.#client?.sendMessage(
          message.channel.id,
          resolveMessagePayload(replyMessage)
        );
      }
    };

    if (command.schema) {
      try {
        context.input = parseCommandSchemaInput(args, command.schema, {
          prefix: this.prefix,
          commandName: command.name
        });
      } catch (error) {
        const normalizedError = this.#normalizeSchemaError(error, command);
        this.#emitDebug({
          scope: "command",
          event: "command_invalid",
          level: "warn",
          data: {
            botName: this.name,
            commandName: command.name,
            message: normalizedError.message
          }
        });
        await this.#runHook("commandInvalid", {
          command,
          commandContext: context,
          error: normalizedError
        });
        await context.reply(normalizedError.message);
        return;
      }
    }

    const blockedResult = await this.#runGuards(context, command);
    if (blockedResult) {
      this.#emitDebug({
        scope: "command",
        event: "command_blocked",
        level: "warn",
        data: {
          botName: this.name,
          commandName: command.name,
          reason: blockedResult.reason
        }
      });
      await this.#runHook("commandBlocked", {
        command,
        commandContext: context,
        result: blockedResult
      });

      if (blockedResult.reason) {
        await context.reply(blockedResult.reason);
      }

      return;
    }

    try {
      const startedAt = Date.now();
      this.#emitDebug({
        scope: "command",
        event: "command_started",
        level: "info",
        data: {
          botName: this.name,
          commandName: command.name,
          argCount: args.length
        }
      });
      await this.#runHook("beforeCommand", context);
      await this.#runMiddleware(context, command);
      await this.#runHook("afterCommand", context);
      this.#emitDebug({
        scope: "command",
        event: "command_finished",
        level: "info",
        data: {
          botName: this.name,
          commandName: command.name,
          durationMs: Date.now() - startedAt
        }
      });
      this.#client.emit("commandExecuted", { commandName, message });
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Command execution failed.");
      this.#emitDebug({
        scope: "command",
        event: "command_failed",
        level: "error",
        data: {
          botName: this.name,
          commandName: command.name,
          message: normalizedError.message
        }
      });
      await this.#runHook("commandError", {
        command,
        commandContext: context,
        error: normalizedError
      });
      this.#client.emit("error", normalizedError);
    }
  }

  async #runGuards(
    context: CommandContext,
    command: FluxerCommand
  ): Promise<{ allowed: boolean; reason?: string } | null> {
    const guards = [...this.#guards, ...(command.guards ?? [])];

    for (const guard of guards) {
      const result = await guard(context);
      const normalizedResult = this.#normalizeGuardResult(result);
      if (!normalizedResult.allowed) {
        return normalizedResult;
      }
    }

    return null;
  }

  async #runMiddleware(context: CommandContext, command: FluxerCommand): Promise<void> {
    const middleware = [...this.#middleware, ...(command.middleware ?? [])];
    let index = -1;

    const dispatch = async (nextIndex: number): Promise<void> => {
      if (nextIndex <= index) {
        throw new Error("Middleware called next() multiple times.");
      }

      index = nextIndex;
      const current = middleware[nextIndex];

      if (!current) {
        await command.execute(context);
        return;
      }

      await current(context, async () => {
        await dispatch(nextIndex + 1);
      });
    };

    await dispatch(0);
  }

  #normalizeGuardResult(
    result: boolean | string | { allowed: boolean; reason?: string }
  ): { allowed: boolean; reason?: string } {
    if (typeof result === "boolean") {
      return { allowed: result };
    }

    if (typeof result === "string") {
      return {
        allowed: false,
        reason: result
      };
    }

    return result;
  }

  #normalizeSchemaError(error: unknown, command: AnyCommand): CommandSchemaError {
    if (error instanceof CommandSchemaError) {
      const usage = error.usage
        ?? (command.schema
          ? formatCommandUsage(command.schema, {
              prefix: this.prefix,
              commandName: command.name
            })
          : undefined);
      return usage ? new CommandSchemaError(`${error.message}\n${usage}`, { usage }) : error;
    }

    const usage = command.schema
      ? formatCommandUsage(command.schema, {
          prefix: this.prefix,
          commandName: command.name
        })
      : undefined;
    return new CommandSchemaError("Invalid command input.", { usage });
  }

  async #runHook<K extends keyof FluxerCommandExecutionHooks>(
    hookName: K,
    payload: Parameters<NonNullable<FluxerCommandExecutionHooks[K]>>[0]
  ): Promise<void> {
    for (const hooks of this.#hookSets) {
      const hook = hooks[hookName];
      if (hook) {
        await hook(payload as never);
      }
    }
  }

  #registerCommandKey(key: string, command: AnyCommand): void {
    const normalizedKey = this.#normalizeCommandKey(key);
    const existingCommand = this.#commands.get(normalizedKey);

    if (existingCommand && existingCommand !== command) {
      throw new Error(
        `Command key "${key}" is already registered by "${existingCommand.name}".`
      );
    }

    this.#commands.set(normalizedKey, command);
  }

  #registerCommandGroup(group: AnyCommandGroup): void {
    const normalizedGroupName = this.#normalizeCommandKey(group.name);
    const existingGroup = this.#commandGroups.get(normalizedGroupName);
    if (existingGroup && existingGroup !== group) {
      throw new Error(`Command group "${group.name}" is already registered.`);
    }

    this.#commandGroups.set(normalizedGroupName, group);

    for (const alias of group.aliases ?? []) {
      const normalizedAlias = this.#normalizeCommandKey(alias);
      const existingAlias = this.#commandGroups.get(normalizedAlias);
      if (existingAlias && existingAlias !== group) {
        throw new Error(`Command group alias "${alias}" is already registered.`);
      }

      this.#commandGroups.set(normalizedAlias, group);
    }

    for (const command of group.commands) {
      const expandedCommand = this.#expandGroupedCommand(group, command);
      this.command(expandedCommand);
    }
  }

  #expandGroupedCommand(group: AnyCommandGroup, command: AnyCommand): AnyCommand {
    const fullName = `${group.name} ${command.name}`.trim();
    const aliases = new Set<string>();

    for (const alias of command.aliases ?? []) {
      aliases.add(`${group.name} ${alias}`.trim());
    }

    for (const groupAlias of group.aliases ?? []) {
      aliases.add(`${groupAlias} ${command.name}`.trim());
      for (const alias of command.aliases ?? []) {
        aliases.add(`${groupAlias} ${alias}`.trim());
      }
    }

    return {
      ...command,
      name: fullName,
      aliases: aliases.size > 0 ? [...aliases] : undefined,
      hidden: group.hidden || command.hidden,
      group: group.name,
      subcommand: command.name
    };
  }

  #resolveCommandInvocation(
    content: string
  ): { commandName: string; args: string[]; command?: AnyCommand } | null {
    const parsedInput = parseCommandInput(content, this.prefix);
    if (!parsedInput) {
      return null;
    }

    const body = content.slice(this.prefix.length).trim();
    const tokens = tokenizeCommandInput(body);
    const match = this.#findLongestCommandMatch(tokens);
    if (!match) {
      return parsedInput;
    }

    return {
      commandName: match.command.name,
      args: tokens.slice(match.tokenCount),
      command: match.command
    };
  }

  #findLongestCommandMatch(
    tokens: string[]
  ): { command: AnyCommand; tokenCount: number } | null {
    for (let tokenCount = tokens.length; tokenCount >= 1; tokenCount -= 1) {
      const candidateName = tokens.slice(0, tokenCount).join(" ");
      const command = this.getCommand(candidateName);
      if (command) {
        return {
          command,
          tokenCount
        };
      }
    }

    return null;
  }

  #findLongestCommandGroupMatch(
    tokens: string[]
  ): { group: AnyCommandGroup; tokenCount: number } | null {
    for (let tokenCount = tokens.length; tokenCount >= 1; tokenCount -= 1) {
      const candidateName = tokens.slice(0, tokenCount).join(" ");
      const group = this.#commandGroups.get(this.#normalizeCommandKey(candidateName));
      if (group) {
        return {
          group,
          tokenCount
        };
      }
    }

    return null;
  }

  #normalizeCommandKey(name: string): string {
    return this.caseSensitiveCommands ? name : name.toLowerCase();
  }

  #isPromiseLike(value: unknown): value is Promise<unknown> {
    return typeof value === "object" && value !== null && "then" in value;
  }

  #emitDebug(event: {
    scope: "command";
    event: string;
    level?: "debug" | "info" | "warn" | "error";
    data?: Record<string, unknown>;
  }): void {
    this.#client?.emitDebug(event);
  }
}
