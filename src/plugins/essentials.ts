import type { FluxerPlugin } from "../core/types.js";

export interface EssentialsPluginOptions {
  aboutText?: string;
}

export function createEssentialsPlugin(options: EssentialsPluginOptions = {}): FluxerPlugin {
  return {
    name: "essentials",
    description: "Core utility commands for Fluxer bots.",
    modules: [
      {
        name: "essentials-core",
        commands: [
          {
            name: "help",
            description: "Show the available commands for the current bot.",
            execute: async ({ bot, reply }) => {
              const commandNames = bot.commands.map((command) => command.name).sort();
              await reply(`Available commands: ${commandNames.join(", ")}`);
            }
          },
          {
            name: "about",
            description: "Show information about the bot.",
            execute: async ({ bot, reply }) => {
              await reply(options.aboutText ?? `${bot.name} is powered by Fluxer.JS.`);
            }
          }
        ]
      }
    ]
  };
}
