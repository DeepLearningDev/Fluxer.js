import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const DEFAULT_EXAMPLE_ENV_FILES = [
  ".env.contract.local",
  ".env.contract",
  ".env.local",
  ".env"
] as const;

export function normalizeEnvValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function loadExampleEnvFiles(candidates: readonly string[] = DEFAULT_EXAMPLE_ENV_FILES): string[] {
  const loaded: string[] = [];

  for (const candidate of candidates) {
    const fullPath = path.resolve(process.cwd(), candidate);
    if (!existsSync(fullPath)) {
      continue;
    }

    const fileContent = readFileSync(fullPath, "utf8");
    for (const line of fileContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = normalizeEnvValue(rawValue);
    }

    loaded.push(candidate);
  }

  return loaded;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

export function optionalEnvFromNames(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = optionalEnv(name);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

export function parseIntegerEnv(
  value: string | undefined,
  fallback: number,
  options: {
    name: string;
    minimum?: number;
    descriptor: string;
  }
): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  const minimum = options.minimum ?? Number.NEGATIVE_INFINITY;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${options.name} must be ${options.descriptor}.`);
  }

  return parsed;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function writeReportIfConfigured<T extends { reportPath?: string }>(
  report: T,
  reportLabel: string
): Promise<void> {
  if (!report.reportPath) {
    return;
  }

  const outputPath = path.resolve(process.cwd(), report.reportPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`${reportLabel} report written to ${outputPath}`);
}
