import { parseCommandInput } from "./CommandParser.js";
import type { FluxerClient } from "./Client.js";
import type {
  CommandContext,
  FluxerCommandExecutionHooks,
  FluxerCommandGuard,
  FluxerCommandMiddleware,
  FluxerModule,
  FluxerBotOptions,
  FluxerCommand,
  FluxerMessage
} from "./types.js";

export class FluxerBot {
  readonly name: string;
  readonly prefix: string;
  readonly ignoreBots: boolean;
  readonly caseSensitiveCommands: boolean;

  #client?: FluxerClient;
  #commands = new Map<string, FluxerCommand>();
  #guards: FluxerCommandGuard[] = [];
  #middleware: FluxerCommandMiddleware[] = [];
  #hookSets: FluxerCommandExecutionHooks[] = [];
  #modules = new Set<string>();

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
  }

  public command(command: FluxerCommand): this {
    this.#registerCommandKey(command.name, command);

    for (const alias of command.aliases ?? []) {
      this.#registerCommandKey(alias, command);
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

    void module.setup?.(this);
    return this;
  }

  public get modules(): string[] {
    return [...this.#modules];
  }

  public get commands(): FluxerCommand[] {
    return [...new Set(this.#commands.values())];
  }

  public hasCommand(name: string): boolean {
    return this.#commands.has(this.#normalizeCommandKey(name));
  }

  public getCommand(name: string): FluxerCommand | undefined {
    return this.#commands.get(this.#normalizeCommandKey(name));
  }

  public async handleMessage(message: FluxerMessage): Promise<void> {
    if (!this.#client) {
      throw new Error(`Bot "${this.name}" is not attached to a FluxerClient.`);
    }

    if (this.ignoreBots && message.author.isBot) {
      return;
    }

    const parsedInput = parseCommandInput(message.content, this.prefix);
    if (!parsedInput) {
      return;
    }

    const { commandName, args } = parsedInput;
    const command = this.#commands.get(this.#normalizeCommandKey(commandName));
    if (!command) {
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
      commandName,
      state: {},
      reply: async (content: string) => {
        await this.#client?.sendMessage(message.channel.id, content);
      }
    };

    const blockedResult = await this.#runGuards(context, command);
    if (blockedResult) {
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
      await this.#runHook("beforeCommand", context);
      await this.#runMiddleware(context, command);
      await this.#runHook("afterCommand", context);
      this.#client.emit("commandExecuted", { commandName, message });
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Command execution failed.");
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

  #registerCommandKey(key: string, command: FluxerCommand): void {
    const normalizedKey = this.#normalizeCommandKey(key);
    const existingCommand = this.#commands.get(normalizedKey);

    if (existingCommand && existingCommand !== command) {
      throw new Error(
        `Command key "${key}" is already registered by "${existingCommand.name}".`
      );
    }

    this.#commands.set(normalizedKey, command);
  }

  #normalizeCommandKey(name: string): string {
    return this.caseSensitiveCommands ? name : name.toLowerCase();
  }
}
