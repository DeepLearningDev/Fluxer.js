import { EventEmitter } from "node:events";
import type { FluxerClient } from "./Client.js";
import { WaitForTimeoutError } from "./errors.js";
import type {
  FluxerCollectorStopReason,
  FluxerEventMap,
  FluxerMessage,
  FluxerMessageAwaitOptions,
  FluxerMessageCollectorOptions,
  FluxerMessageCollectorResult,
  FluxerWaitForOptions
} from "./types.js";

type EventKey = keyof FluxerEventMap;

export class FluxerMessageCollector extends EventEmitter {
  readonly #client: FluxerClient;
  readonly #options: FluxerMessageCollectorOptions;
  readonly #collected: FluxerMessage[] = [];
  readonly #listener: (message: FluxerMessage) => Promise<void>;
  #ended = false;
  #timeoutTimer?: ReturnType<typeof setTimeout>;
  #idleTimer?: ReturnType<typeof setTimeout>;
  #resolveEnd!: (result: FluxerMessageCollectorResult) => void;
  readonly #resultPromise: Promise<FluxerMessageCollectorResult>;

  public constructor(client: FluxerClient, options: FluxerMessageCollectorOptions = {}) {
    super();
    this.#client = client;
    this.#options = options;
    this.#listener = async (message) => {
      await this.#handleMessage(message);
    };
    this.#resultPromise = new Promise<FluxerMessageCollectorResult>((resolve) => {
      this.#resolveEnd = resolve;
    });

    this.#client.on("messageCreate", this.#listener);
    this.#armTimers();

    if (options.signal) {
      if (options.signal.aborted) {
        this.stop("abort");
        return;
      }

      options.signal.addEventListener("abort", () => {
        this.stop("abort");
      }, { once: true });
    }
  }

  public get collected(): FluxerMessage[] {
    return [...this.#collected];
  }

  public get ended(): boolean {
    return this.#ended;
  }

  public stop(reason: FluxerCollectorStopReason = "manual"): FluxerMessageCollectorResult {
    if (this.#ended) {
      return {
        collected: this.collected,
        reason
      };
    }

    this.#ended = true;
    this.#clearTimers();
    this.#client.off("messageCreate", this.#listener);

    const result = {
      collected: this.collected,
      reason
    };
    this.emit("end", result);
    this.#resolveEnd(result);
    return result;
  }

  public wait(): Promise<FluxerMessageCollectorResult> {
    return this.#resultPromise;
  }

  async #handleMessage(message: FluxerMessage): Promise<void> {
    if (this.#ended || !(await matchesMessageAwaitOptions(message, this.#options))) {
      return;
    }

    this.#collected.push(message);
    this.emit("collect", message);
    this.#rearmIdleTimer();

    if (this.#options.max && this.#collected.length >= this.#options.max) {
      this.stop("limit");
    }
  }

  #armTimers(): void {
    if (typeof this.#options.timeoutMs === "number") {
      this.#timeoutTimer = setTimeout(() => {
        this.stop("timeout");
      }, this.#options.timeoutMs);
    }

    this.#rearmIdleTimer();
  }

  #rearmIdleTimer(): void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = undefined;
    }

    if (typeof this.#options.idleMs === "number") {
      this.#idleTimer = setTimeout(() => {
        this.stop("idle");
      }, this.#options.idleMs);
    }
  }

  #clearTimers(): void {
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = undefined;
    }

    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = undefined;
    }
  }
}

export async function waitForEvent<E extends EventKey>(
  client: FluxerClient,
  eventName: E,
  options: FluxerWaitForOptions<FluxerEventMap[E]> = {}
): Promise<FluxerEventMap[E]> {
  return new Promise<FluxerEventMap[E]>((resolve, reject) => {
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      client.off(eventName, listener);
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
    };

    const listener = async (payload: FluxerEventMap[E]) => {
      try {
        const matches = options.filter ? await options.filter(payload) : true;
        if (!matches) {
          return;
        }

        cleanup();
        resolve(payload);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    client.on(eventName, listener);

    if (typeof options.timeoutMs === "number") {
      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new WaitForTimeoutError(`Timed out waiting for event "${String(eventName)}".`));
      }, options.timeoutMs);
    }

    if (options.signal) {
      if (options.signal.aborted) {
        cleanup();
        reject(new Error(`Waiting for event "${String(eventName)}" was aborted.`));
        return;
      }

      options.signal.addEventListener("abort", () => {
        cleanup();
        reject(new Error(`Waiting for event "${String(eventName)}" was aborted.`));
      }, { once: true });
    }
  });
}

export async function waitForMessage(
  client: FluxerClient,
  options: FluxerMessageAwaitOptions = {}
): Promise<FluxerMessage> {
  return waitForEvent(client, "messageCreate", {
    ...options,
    filter: async (message) => matchesMessageAwaitOptions(message, options)
  });
}

async function matchesMessageAwaitOptions(
  message: FluxerMessage,
  options: FluxerMessageAwaitOptions
): Promise<boolean> {
  if (!options.includeBots && message.author.isBot) {
    return false;
  }

  if (options.authorId && message.author.id !== options.authorId) {
    return false;
  }

  if (options.channelId && message.channel.id !== options.channelId) {
    return false;
  }

  if (options.filter) {
    return options.filter(message);
  }

  return true;
}
