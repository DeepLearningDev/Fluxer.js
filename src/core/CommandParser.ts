import type { ParsedCommandInput } from "./types.js";

export function parseCommandInput(content: string, prefix: string): ParsedCommandInput | null {
  if (!content.startsWith(prefix)) {
    return null;
  }

  const body = content.slice(prefix.length).trim();
  if (body.length === 0) {
    return null;
  }

  const tokens = tokenizeCommandInput(body);
  if (tokens.length === 0) {
    return null;
  }

  const [commandName, ...args] = tokens;
  return {
    commandName,
    args
  };
}

export function tokenizeCommandInput(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escape = false;

  for (const character of input) {
    if (escape) {
      current += character;
      escape = false;
      continue;
    }

    if (character === "\\") {
      escape = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
