import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const processRef = globalThis.process;
const consoleRef = globalThis.console;
const [, , inputArg, outputArg] = processRef.argv;

if (!inputArg) {
  consoleRef.error("Usage: node scripts/summarize-live-contract-report.mjs <report.json> [summary.md]");
  processRef.exit(1);
}

const inputPath = path.resolve(processRef.cwd(), inputArg);
const raw = await readFile(inputPath, "utf8");
const report = JSON.parse(raw);
const mode = String(report.mode ?? "contract");
const summary = renderSummary(report, inputPath);

if (outputArg) {
  const outputPath = path.resolve(processRef.cwd(), outputArg);
  await writeFile(outputPath, summary, "utf8");
  consoleRef.log(`${summaryLabel(mode)} written to ${outputPath}`);
} else {
  processRef.stdout.write(summary);
}

function renderSummary(report, inputPath) {
  const mode = String(report.mode ?? "contract");
  const title = mode === "hosted-confidence"
    ? "# Fluxer.JS Hosted Confidence Report"
    : "# Fluxer.JS Live Contract Report";
  const lines = [
    title,
    "",
    `- Mode: ${mode}`,
    `- Status: ${String(report.status ?? "unknown")}`,
    `- Started: ${String(report.startedAt ?? "unknown")}`,
    `- Finished: ${String(report.finishedAt ?? "unknown")}`,
    `- Source report: \`${inputPath}\``,
    `- Instance: ${String(report.instanceUrl ?? "unknown")}`,
    `- Channel: ${String(report.channelId ?? "unknown")}`,
    ""
  ];

  if (mode !== "hosted-confidence" && report.keepAlive !== undefined) {
    lines.splice(lines.length - 1, 0, `- Keep alive: ${report.keepAlive === true ? "yes" : "no"}`);
  }

  if (report.instance) {
    lines.push("## Instance", "");
    lines.push(`- API Base: ${String(report.instance.apiBaseUrl ?? "unknown")}`);
    lines.push(`- Gateway URL: ${String(report.instance.gatewayUrl ?? "unknown")}`);
    lines.push(`- API Code Version: ${String(report.instance.apiCodeVersion ?? "unknown")}`);
    lines.push(`- Self Hosted: ${report.instance.isSelfHosted === true ? "yes" : "no"}`);
    if (Array.isArray(report.instance.capabilities)) {
      lines.push(`- Capabilities: ${report.instance.capabilities.join(", ") || "none"}`);
    }
    lines.push("");
  }

  if (report.currentUser) {
    lines.push("## Current User", "");
    lines.push(`- Username: ${String(report.currentUser.username ?? "unknown")}`);
    lines.push(`- User ID: ${String(report.currentUser.id ?? "unknown")}`, "");
  }

  if (report.fetchedUser) {
    lines.push("## Fetched User", "");
    lines.push(`- Username: ${String(report.fetchedUser.username ?? "unknown")}`);
    lines.push(`- User ID: ${String(report.fetchedUser.id ?? "unknown")}`, "");
  }

  if (report.channel) {
    lines.push("## Channel", "");
    lines.push(`- Channel ID: ${String(report.channel.id ?? "unknown")}`);
    lines.push(`- Name: ${String(report.channel.name ?? "unknown")}`);
    lines.push(`- Type: ${String(report.channel.type ?? "unknown")}`, "");
  }

  if (report.probe) {
    lines.push("## Probe", "");
    lines.push(`- Content: ${String(report.probe.content ?? "unknown")}`);
    lines.push(`- Confirmed message ID: ${String(report.probe.confirmedMessageId ?? "not confirmed")}`);
    if (report.probe.fetchedMessageId) {
      lines.push(`- Direct fetch message ID: ${String(report.probe.fetchedMessageId)}`);
    }
    if (report.probe.fetchedMessageContent) {
      lines.push(`- Direct fetch content: ${String(report.probe.fetchedMessageContent)}`);
    }
    if (report.probe.editedMessageId) {
      lines.push(`- Edited message ID: ${String(report.probe.editedMessageId)}`);
    }
    if (report.probe.editedContent) {
      lines.push(`- Edited content: ${String(report.probe.editedContent)}`);
    }
    if (report.probe.fetchedEditedMessageId) {
      lines.push(`- Fetched edited message ID: ${String(report.probe.fetchedEditedMessageId)}`);
    }
    if (report.probe.fetchedEditedMessageContent) {
      lines.push(`- Fetched edited content: ${String(report.probe.fetchedEditedMessageContent)}`);
    }
    if (report.probe.deletedMessageId) {
      lines.push(`- Deleted message ID: ${String(report.probe.deletedMessageId)}`);
    }
    if (report.probe.deletedFetchCode) {
      lines.push(`- Deleted fetch code: ${String(report.probe.deletedFetchCode)}`);
    }
    if (report.probe.deletedFetchStatus !== undefined) {
      lines.push(`- Deleted fetch status: ${String(report.probe.deletedFetchStatus)}`);
    }
    if (report.probe.deletedHistoryAbsent === true) {
      lines.push("- Deleted probe absent from recent history: yes");
    }
    lines.push("");
  }

  lines.push("## Steps", "");
  for (const step of Array.isArray(report.steps) ? report.steps : []) {
    lines.push(`- ${String(step.name)}: ${String(step.status)} at ${String(step.timestamp ?? "unknown")}`);
  }
  lines.push("");

  if (report.error) {
    lines.push("## Error", "");
    lines.push(`- Name: ${String(report.error.name ?? "unknown")}`);
    lines.push(`- Message: ${String(report.error.message ?? "unknown")}`);
    if (report.error.code) {
      lines.push(`- Code: ${String(report.error.code)}`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function summaryLabel(mode) {
  return mode === "hosted-confidence"
    ? "Hosted confidence summary"
    : "Contract summary";
}
