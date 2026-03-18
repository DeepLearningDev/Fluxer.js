import { CommandSchemaError } from "./errors.js";
import type {
  FluxerCommand,
  FluxerCommandArgumentDefinition,
  FluxerCommandFlagDefinition,
  FluxerCommandSchema,
  FluxerCommandValueType,
  FluxerParsedCommandInput
} from "./types.js";

type FluxerSchemaValue = string | number | boolean;

export function defineCommand(command: FluxerCommand<undefined>): FluxerCommand<undefined>;
export function defineCommand<TSchema extends FluxerCommandSchema>(
  command: FluxerCommand<TSchema>
): FluxerCommand<TSchema>;
export function defineCommand<TSchema extends FluxerCommandSchema | undefined>(
  command: FluxerCommand<TSchema>
): FluxerCommand<TSchema> {
  return command;
}

export function parseCommandSchemaInput<TSchema extends FluxerCommandSchema>(
  rawArgs: string[],
  schema: TSchema,
  options?: { prefix?: string; commandName?: string }
): FluxerParsedCommandInput<TSchema> {
  const tokens = [...rawArgs];
  const positionalTokens: string[] = [];
  const rawFlags = new Map<string, string[]>();
  const unknownFlags: string[] = [];
  const flagsByName = new Map((schema.flags ?? []).map((flag) => [flag.name, flag]));
  const flagsByShort = new Map(
    (schema.flags ?? [])
      .filter((flag): flag is FluxerCommandFlagDefinition & { short: string } => Boolean(flag.short))
      .map((flag) => [flag.short, flag])
  );

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "--") {
      positionalTokens.push(...tokens.slice(index + 1));
      break;
    }

    if (token.startsWith("--")) {
      const [flagToken, inlineValue] = splitInlineFlag(token.slice(2));
      const isNegated = flagToken.startsWith("no-");
      const lookupName = isNegated ? flagToken.slice(3) : flagToken;
      const definition = flagsByName.get(lookupName);

      if (!definition) {
        unknownFlags.push(`--${flagToken}`);
        continue;
      }

      if (getFlagType(definition) === "boolean") {
        recordFlagValue(rawFlags, definition.name, inlineValue ?? String(!isNegated));
        continue;
      }

      const nextToken = inlineValue ?? tokens[index + 1];
      if (typeof nextToken !== "string") {
        throw new CommandSchemaError(`Missing value for flag "--${definition.name}".`, {
          usage: formatCommandUsage(schema, options)
        });
      }

      if (inlineValue === undefined) {
        index += 1;
      }

      recordFlagValue(rawFlags, definition.name, nextToken);
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const shortName = token.slice(1);
      const definition = flagsByShort.get(shortName);

      if (!definition) {
        unknownFlags.push(`-${shortName}`);
        continue;
      }

      if (getFlagType(definition) === "boolean") {
        recordFlagValue(rawFlags, definition.name, "true");
        continue;
      }

      const nextToken = tokens[index + 1];
      if (typeof nextToken !== "string") {
        throw new CommandSchemaError(`Missing value for flag "-${shortName}".`, {
          usage: formatCommandUsage(schema, options)
        });
      }

      index += 1;
      recordFlagValue(rawFlags, definition.name, nextToken);
      continue;
    }

    positionalTokens.push(token);
  }

  if (schema.allowUnknownFlags === false && unknownFlags.length > 0) {
    throw new CommandSchemaError(`Unknown flag "${unknownFlags[0]}".`, {
      usage: formatCommandUsage(schema, options)
    });
  }

  const parsedArgs = parseArgumentDefinitions(positionalTokens, schema.args ?? [], schema, options);
  const parsedFlags = parseFlagDefinitions(rawFlags, schema.flags ?? [], schema, options);

  return {
    args: parsedArgs,
    flags: parsedFlags,
    rawArgs,
    unknownFlags
  } as FluxerParsedCommandInput<TSchema>;
}

export function formatCommandUsage(
  schema: FluxerCommandSchema,
  options?: { prefix?: string; commandName?: string }
): string {
  const commandLabel = options?.commandName
    ? `${options.prefix ?? ""}${options.commandName}`
    : "command";
  const argumentParts = (schema.args ?? []).map((argument) => {
    const base = argument.rest
      ? argument.required
        ? `<${argument.name}...>`
        : `[${argument.name}...]`
      : argument.required
        ? `<${argument.name}>`
        : `[${argument.name}]`;
    return base;
  });
  const flagParts = (schema.flags ?? []).map((flag) => {
    const label = flag.short ? `-${flag.short}, --${flag.name}` : `--${flag.name}`;
    return getFlagType(flag) === "boolean" ? `[${label}]` : `[${label} <value>]`;
  });

  return `Usage: ${[commandLabel, ...argumentParts, ...flagParts].join(" ").trim()}`;
}

export function formatCommandUsageFromCommand(
  command: Pick<FluxerCommand, "name" | "usage" | "schema">,
  options?: { prefix?: string }
): string {
  if (command.usage) {
    return command.usage.startsWith("Usage:")
      ? command.usage
      : `Usage: ${command.usage}`;
  }

  if (command.schema) {
    return formatCommandUsage(command.schema, {
      prefix: options?.prefix,
      commandName: command.name
    });
  }

  return `Usage: ${(options?.prefix ?? "")}${command.name}`;
}

export function describeCommand(
  command: Pick<
    FluxerCommand,
    "name" | "aliases" | "description" | "examples" | "usage" | "schema"
  >,
  options?: { prefix?: string }
): string {
  const lines = [formatCommandUsageFromCommand(command, options)];

  if (command.description) {
    lines.push(command.description);
  }

  if (command.aliases && command.aliases.length > 0) {
    lines.push(`Aliases: ${command.aliases.join(", ")}`);
  }

  if (command.schema?.args && command.schema.args.length > 0) {
    lines.push(
      `Arguments: ${command.schema.args
        .map((argument) => {
          const modifiers = [
            argument.required ? "required" : "optional",
            argument.rest ? "rest" : undefined,
            argument.type && argument.type !== "string" ? argument.type : undefined
          ].filter(Boolean);
          return `${argument.name}${modifiers.length > 0 ? ` (${modifiers.join(", ")})` : ""}`;
        })
        .join(", ")}`
    );
  }

  if (command.schema?.flags && command.schema.flags.length > 0) {
    lines.push(
      `Flags: ${command.schema.flags
        .map((flag) => {
          const names = [flag.short ? `-${flag.short}` : undefined, `--${flag.name}`]
            .filter(Boolean)
            .join(", ");
          const modifiers = [
            flag.required ? "required" : "optional",
            flag.type && flag.type !== "boolean" ? flag.type : undefined,
            flag.multiple ? "multiple" : undefined
          ].filter(Boolean);
          return `${names}${modifiers.length > 0 ? ` (${modifiers.join(", ")})` : ""}`;
        })
        .join("; ")}`
    );
  }

  if (command.examples && command.examples.length > 0) {
    lines.push(`Examples: ${command.examples.join(" | ")}`);
  }

  return lines.join("\n");
}

function parseArgumentDefinitions(
  positionalTokens: string[],
  definitions: readonly FluxerCommandArgumentDefinition[],
  schema: FluxerCommandSchema,
  options?: { prefix?: string; commandName?: string }
): Record<string, FluxerSchemaValue | FluxerSchemaValue[] | undefined> {
  const result: Record<string, FluxerSchemaValue | FluxerSchemaValue[] | undefined> = {};
  let position = 0;

  for (const definition of definitions) {
    if (definition.rest) {
      const restTokens = positionalTokens.slice(position);
      if (definition.required && restTokens.length === 0) {
        throw new CommandSchemaError(`Missing value for argument "${definition.name}".`, {
          usage: formatCommandUsage(schema, options)
        });
      }

      result[definition.name] = restTokens.map((token) =>
        coerceSchemaValue(token, getArgumentType(definition), `argument "${definition.name}"`)
      );
      position = positionalTokens.length;
      continue;
    }

    const token = positionalTokens[position];
    if (token === undefined) {
      if (definition.required) {
        throw new CommandSchemaError(`Missing value for argument "${definition.name}".`, {
          usage: formatCommandUsage(schema, options)
        });
      }

      result[definition.name] = undefined;
      continue;
    }

    result[definition.name] = coerceSchemaValue(
      token,
      getArgumentType(definition),
      `argument "${definition.name}"`
    );
    position += 1;
  }

  return result;
}

function parseFlagDefinitions(
  rawFlags: Map<string, string[]>,
  definitions: readonly FluxerCommandFlagDefinition[],
  schema: FluxerCommandSchema,
  options?: { prefix?: string; commandName?: string }
): Record<string, FluxerSchemaValue | FluxerSchemaValue[] | undefined> {
  const result: Record<string, FluxerSchemaValue | FluxerSchemaValue[] | undefined> = {};

  for (const definition of definitions) {
    const values = rawFlags.get(definition.name) ?? [];
    if (values.length === 0) {
      if (definition.defaultValue !== undefined) {
        result[definition.name] = definition.defaultValue;
        continue;
      }

      if (definition.required) {
        throw new CommandSchemaError(`Missing required flag "--${definition.name}".`, {
          usage: formatCommandUsage(schema, options)
        });
      }

      result[definition.name] = getFlagType(definition) === "boolean" ? false : undefined;
      continue;
    }

    const coercedValues = values.map((value) =>
      coerceSchemaValue(value, getFlagType(definition), `flag "--${definition.name}"`)
    );

    if (definition.multiple) {
      result[definition.name] = coercedValues;
      continue;
    }

    result[definition.name] = coercedValues[coercedValues.length - 1];
  }

  return result;
}

function coerceSchemaValue(
  value: string,
  type: FluxerCommandValueType,
  fieldName: string
): FluxerSchemaValue {
  if (type === "string") {
    return value;
  }

  if (type === "boolean") {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    throw new CommandSchemaError(`Invalid boolean for ${fieldName}. Expected "true" or "false".`);
  }

  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    throw new CommandSchemaError(`Invalid number for ${fieldName}.`);
  }

  return numericValue;
}

function getArgumentType(definition: FluxerCommandArgumentDefinition): FluxerCommandValueType {
  return definition.type ?? "string";
}

function getFlagType(definition: FluxerCommandFlagDefinition): FluxerCommandValueType {
  return definition.type ?? "boolean";
}

function recordFlagValue(rawFlags: Map<string, string[]>, name: string, value: string): void {
  const currentValues = rawFlags.get(name);
  if (currentValues) {
    currentValues.push(value);
    return;
  }

  rawFlags.set(name, [value]);
}

function splitInlineFlag(token: string): [string, string | undefined] {
  const separatorIndex = token.indexOf("=");
  if (separatorIndex === -1) {
    return [token, undefined];
  }

  return [token.slice(0, separatorIndex), token.slice(separatorIndex + 1)];
}
