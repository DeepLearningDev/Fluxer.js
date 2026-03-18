import { CommandSchemaError } from "./errors.js";
import type {
  FluxerCommandArgumentDescriptor,
  FluxerCommand,
  FluxerCommandGroup,
  FluxerCommandCatalog,
  FluxerCommandArgumentDefinition,
  FluxerCommandCatalogOptions,
  FluxerCommandDescriptor,
  FluxerCommandFlagDefinition,
  FluxerCommandFlagDescriptor,
  FluxerCommandGroupDescriptor,
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

export function defineCommandGroup(group: FluxerCommandGroup): FluxerCommandGroup {
  return group;
}

export function isCommandGroup(value: FluxerCommand | FluxerCommandGroup): value is FluxerCommandGroup {
  return "commands" in value;
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

export function inspectCommand(
  command: Pick<
    FluxerCommand,
    "name" | "aliases" | "description" | "examples" | "usage" | "schema" | "hidden" | "group" | "subcommand"
  >,
  options?: { prefix?: string }
): FluxerCommandDescriptor {
  return {
    name: command.name,
    description: command.description,
    usage: formatCommandUsageFromCommand(command, options),
    aliases: [...(command.aliases ?? [])],
    examples: [...(command.examples ?? [])],
    hidden: command.hidden ?? false,
    group: command.group,
    subcommand: command.subcommand,
    args: (command.schema?.args ?? []).map((argument) => inspectArgument(argument)),
    flags: (command.schema?.flags ?? []).map((flag) => inspectFlag(flag))
  };
}

export function inspectCommandGroup(
  group: Pick<
    FluxerCommandGroup,
    "name" | "aliases" | "description" | "usage" | "examples" | "hidden" | "commands"
  >,
  options?: { prefix?: string }
): FluxerCommandGroupDescriptor {
  return {
    name: group.name,
    description: group.description,
    usage: group.usage
      ? group.usage.startsWith("Usage:")
        ? group.usage
        : `Usage: ${group.usage}`
      : `Usage: ${(options?.prefix ?? "")}${group.name} <subcommand>`,
    aliases: [...(group.aliases ?? [])],
    examples: [...(group.examples ?? [])],
    hidden: group.hidden ?? false,
    commands: group.commands.map((command) =>
      inspectCommand(
        {
          ...command,
          name: `${group.name} ${command.name}`.trim(),
          aliases: expandGroupedCommandAliases(group, command),
          hidden: group.hidden || command.hidden,
          group: group.name,
          subcommand: command.name
        },
        options
      )
    )
  };
}

export function createCommandCatalog(
  source: {
    commands: readonly FluxerCommand[];
    groups?: readonly FluxerCommandGroup[];
  },
  options?: ({ prefix?: string } & FluxerCommandCatalogOptions)
): FluxerCommandCatalog {
  const includeHidden = options?.includeHidden ?? false;
  const groups = (source.groups ?? [])
    .filter((group) => includeHidden || !group.hidden)
    .map((group) => inspectCommandGroup(group, options))
    .sort((left, right) => left.name.localeCompare(right.name));

  const commands = source.commands
    .filter((command) => !command.group)
    .filter((command) => includeHidden || !command.hidden)
    .map((command) => inspectCommand(command, options))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    commands,
    groups
  };
}

export function describeCommandCatalog(catalog: FluxerCommandCatalog): string {
  const sections: string[] = [];

  if (catalog.commands.length > 0) {
    sections.push(
      `Commands:\n${catalog.commands
        .map((command) => formatDescriptorSummary(command))
        .join("\n")}`
    );
  }

  if (catalog.groups.length > 0) {
    sections.push(
      `Groups:\n${catalog.groups
        .map((group) => formatGroupDescriptorSummary(group))
        .join("\n")}`
    );
  }

  return sections.join("\n\n");
}

export function findCommandDescriptor(
  catalog: FluxerCommandCatalog,
  input: string
): FluxerCommandDescriptor | undefined {
  return catalog.commands.find((command) => command.name === input)
    ?? catalog.groups
      .flatMap((group) => group.commands)
      .find((command) => command.name === input || command.aliases.includes(input));
}

export function findCommandGroupDescriptor(
  catalog: FluxerCommandCatalog,
  input: string
): FluxerCommandGroupDescriptor | undefined {
  return catalog.groups.find((group) => group.name === input || group.aliases.includes(input));
}

export function describeCommand(
  command: Pick<
    FluxerCommand,
    "name" | "aliases" | "description" | "examples" | "usage" | "schema" | "hidden" | "group" | "subcommand"
  >,
  options?: { prefix?: string }
): string {
  const descriptor = inspectCommand(command, options);
  const lines = [descriptor.usage];

  if (descriptor.description) {
    lines.push(descriptor.description);
  }

  if (descriptor.aliases.length > 0) {
    lines.push(`Aliases: ${descriptor.aliases.join(", ")}`);
  }

  if (descriptor.args.length > 0) {
    lines.push("Arguments:");
    lines.push(...descriptor.args.map((argument) => `- ${formatArgumentDescriptor(argument)}`));
  }

  if (descriptor.flags.length > 0) {
    lines.push("Flags:");
    lines.push(...descriptor.flags.map((flag) => `- ${formatFlagDescriptor(flag)}`));
  }

  if (descriptor.examples.length > 0) {
    lines.push(`Examples: ${descriptor.examples.join(" | ")}`);
  }

  return lines.join("\n");
}

export function describeCommandGroup(
  group: Pick<
    FluxerCommandGroup,
    "name" | "aliases" | "description" | "usage" | "examples" | "hidden" | "commands"
  >,
  options?: { prefix?: string }
): string {
  const descriptor = inspectCommandGroup(group, options);
  const lines = [descriptor.usage];

  if (descriptor.description) {
    lines.push(descriptor.description);
  }

  if (descriptor.aliases.length > 0) {
    lines.push(`Aliases: ${descriptor.aliases.join(", ")}`);
  }

  lines.push("Subcommands:");
  lines.push(...descriptor.commands.map((command) => `- ${formatDescriptorSummary(command)}`));

  if (descriptor.examples.length > 0) {
    lines.push(`Examples: ${descriptor.examples.join(" | ")}`);
  }

  return lines.join("\n");
}

function expandGroupedCommandAliases(
  group: Pick<FluxerCommandGroup, "name" | "aliases">,
  command: Pick<FluxerCommand, "name" | "aliases">
): string[] {
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

  return [...aliases];
}

function inspectArgument(
  argument: FluxerCommandArgumentDefinition
): FluxerCommandArgumentDescriptor {
  return {
    name: argument.name,
    description: argument.description,
    required: argument.required ?? false,
    rest: argument.rest ?? false,
    type: getArgumentType(argument),
    defaultValue: argument.defaultValue,
    enum: argument.enum,
    coerced: Boolean(argument.coerce)
  };
}

function inspectFlag(flag: FluxerCommandFlagDefinition): FluxerCommandFlagDescriptor {
  return {
    name: flag.name,
    short: flag.short,
    description: flag.description,
    required: flag.required ?? false,
    multiple: flag.multiple ?? false,
    type: getFlagType(flag),
    defaultValue: flag.defaultValue,
    enum: flag.enum,
    coerced: Boolean(flag.coerce)
  };
}

function formatDescriptorSummary(
  descriptor: Pick<FluxerCommandDescriptor, "usage" | "description">
): string {
  const signature = descriptor.usage.replace(/^Usage:\s*/, "");
  return descriptor.description
    ? `${signature} - ${descriptor.description}`
    : signature;
}

function formatGroupDescriptorSummary(
  descriptor: Pick<FluxerCommandGroupDescriptor, "usage" | "description">
): string {
  const signature = descriptor.usage.replace(/^Usage:\s*/, "");
  return descriptor.description
    ? `${signature} - ${descriptor.description}`
    : signature;
}

function formatArgumentDescriptor(argument: FluxerCommandArgumentDescriptor): string {
  const modifiers = [
    argument.required ? "required" : "optional",
    argument.rest ? "rest" : undefined,
    argument.type !== "string" ? argument.type : undefined,
    argument.defaultValue !== undefined ? `default=${String(argument.defaultValue)}` : undefined,
    argument.enum && argument.enum.length > 0 ? `enum=${argument.enum.join("/")}` : undefined,
    argument.coerced ? "coerced" : undefined
  ].filter(Boolean);

  const summary = `${argument.name}${modifiers.length > 0 ? ` (${modifiers.join(", ")})` : ""}`;
  return argument.description ? `${summary}: ${argument.description}` : summary;
}

function formatFlagDescriptor(flag: FluxerCommandFlagDescriptor): string {
  const names = [flag.short ? `-${flag.short}` : undefined, `--${flag.name}`]
    .filter(Boolean)
    .join(", ");
  const modifiers = [
    flag.required ? "required" : "optional",
    flag.type !== "boolean" ? flag.type : undefined,
    flag.multiple ? "multiple" : undefined,
    flag.defaultValue !== undefined ? `default=${String(flag.defaultValue)}` : undefined,
    flag.enum && flag.enum.length > 0 ? `enum=${flag.enum.join("/")}` : undefined,
    flag.coerced ? "coerced" : undefined
  ].filter(Boolean);

  const summary = `${names}${modifiers.length > 0 ? ` (${modifiers.join(", ")})` : ""}`;
  return flag.description ? `${summary}: ${flag.description}` : summary;
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
        coerceSchemaValue(
          token,
          definition,
          `argument "${definition.name}"`,
          getArgumentType(definition)
        )
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

      result[definition.name] = definition.defaultValue;
      continue;
    }

    result[definition.name] = coerceSchemaValue(
      token,
      definition,
      `argument "${definition.name}"`,
      getArgumentType(definition)
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
      coerceSchemaValue(
        value,
        definition,
        `flag "--${definition.name}"`,
        getFlagType(definition)
      )
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
  definition: Pick<
    FluxerCommandArgumentDefinition | FluxerCommandFlagDefinition,
    "type" | "enum" | "coerce"
  >,
  fieldName: string,
  defaultType: FluxerCommandValueType
): FluxerSchemaValue {
  if (definition.coerce) {
    try {
      const coercedValue = definition.coerce(value);
      validateEnumValue(coercedValue, definition.enum, fieldName);
      return coercedValue;
    } catch (error) {
      if (error instanceof CommandSchemaError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : `Invalid value for ${fieldName}.`;
      throw new CommandSchemaError(message);
    }
  }

  const type = definition.type ?? defaultType;
  if (type === "string") {
    validateEnumValue(value, definition.enum, fieldName);
    return value;
  }

  if (type === "boolean") {
    const normalizedValue = value.toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalizedValue)) {
      validateEnumValue(true, definition.enum, fieldName);
      return true;
    }

    if (["false", "0", "no", "off"].includes(normalizedValue)) {
      validateEnumValue(false, definition.enum, fieldName);
      return false;
    }

    throw new CommandSchemaError(`Invalid boolean for ${fieldName}. Expected "true" or "false".`);
  }

  const numericValue = Number(value);
  if (Number.isNaN(numericValue) || !Number.isFinite(numericValue)) {
    throw new CommandSchemaError(`Invalid number for ${fieldName}.`);
  }

  validateEnumValue(numericValue, definition.enum, fieldName);
  return numericValue;
}

function getArgumentType(definition: FluxerCommandArgumentDefinition): FluxerCommandValueType {
  return definition.type ?? inferSchemaValueType(definition.defaultValue ?? definition.enum?.[0]) ?? "string";
}

function getFlagType(definition: FluxerCommandFlagDefinition): FluxerCommandValueType {
  return definition.type ?? inferSchemaValueType(definition.defaultValue ?? definition.enum?.[0]) ?? "boolean";
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

function validateEnumValue(
  value: FluxerSchemaValue,
  allowedValues: readonly FluxerSchemaValue[] | undefined,
  fieldName: string
): void {
  if (!allowedValues || allowedValues.length === 0) {
    return;
  }

  if (!allowedValues.includes(value)) {
    throw new CommandSchemaError(
      `Invalid value for ${fieldName}. Expected one of: ${allowedValues.join(", ")}.`
    );
  }
}

function inferSchemaValueType(value: FluxerSchemaValue | undefined): FluxerCommandValueType | undefined {
  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "string") {
    return "string";
  }

  return undefined;
}
