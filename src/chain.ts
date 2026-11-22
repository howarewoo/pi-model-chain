import { setTimeout as delay } from "node:timers/promises";
import {
  getSupportedThinkingLevels,
  isContextOverflow,
  isRecoverableLength,
  isRetryableAssistantError,
  retryDelayMs,
  type AssistantMessage,
  type Model,
  type Message,
} from "@earendil-works/pi-ai";
import {
  convertToLlm,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readCatalog } from "./catalog.ts";
import { fingerprint, identity, type Config } from "./config.ts";
import { createChainManager, type ManagerDeps } from "./manager.ts";
import { formatStatus, RETRIES, type ChainView } from "./status.ts";
import { readConfigFile, writeConfigFile } from "./store.ts";

const ENTRY = "model-chain.state.v1";
interface State {
  version: 1;
  chain: string;
  fingerprint: string;
  index: number;
  target: string;
  failures: number;
  lastEntryId?: string;
  exhausted: boolean;
  pendingDelay: boolean;
  warnedCapabilities?: boolean;
  skipped: { target: string; reason: string }[];
}
function eligible(message: AssistantMessage): boolean {
  if (message.stopReason !== "error" || isContextOverflow(message)) return false;
  const error = message.errorMessage ?? "";
  // Terminal failures must win over ambiguous gateway text mentioning transient errors.
  if (
    /\b(401|403|404|405|422)\b|unauthori[sz]ed|authentication|permission|access.denied|forbidden|refusal|content.policy|cancel|abort/i.test(
      error,
    )
  )
    return false;
  // Providers can report credit/usage exhaustion in a 400 invalid_request_error envelope.
  if (
    /insufficient_quota|quota (?:exceeded|exhausted)|exhausted quota|out of (?:budget|credits)|(?:insufficient|exhausted) credits|credits exhausted|credit balance|payment required|billing|usage.limit|usage limit|available balance|GoUsageLimitError|FreeUsageLimitError/i.test(
      error,
    )
  )
    return true;
  if (/\b400\b|invalid.request/i.test(error)) return false;
  return (
    isRetryableAssistantError(message) ||
    /connection reset|socket hang up|premature close|interrupted stream|network error/i.test(error)
  );
}
function hasImages(messages: readonly Message[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) && message.content.some((block) => block.type === "image"),
  );
}

export interface ChainOptions {
  /** Config file the /chain manager reads and writes; without it the manager is read-only. */
  path?: string;
}

export function installChain(pi: ExtensionAPI, initial: Config, options: ChainOptions = {}) {
  let config = initial;
  const selected = (ctx: ExtensionContext) =>
    ctx.model?.provider === "chain" && config.chains[ctx.model.id] ? ctx.model.id : undefined;
  const fresh = (chain: string): State => ({
    version: 1,
    chain,
    fingerprint: fingerprint(config.chains[chain]),
    index: 0,
    target: identity(config.chains[chain][0]),
    failures: 0,
    exhausted: false,
    pendingDelay: false,
    skipped: [],
  });
  const persisted = (ctx: ExtensionContext, chain: string) => {
    const entry = ctx.sessionManager
      .getBranch()
      .findLast(
        (entry) =>
          entry.type === "custom" &&
          entry.customType === ENTRY &&
          (entry.data as Partial<State> | undefined)?.chain === chain,
      );
    return entry?.type === "custom" ? (entry.data as State) : undefined;
  };
  function read(ctx: ExtensionContext, chain: string, allowMismatch = false): State {
    const state = persisted(ctx, chain);
    if (!state) return fresh(chain);
    if (
      state.version !== 1 ||
      !Number.isInteger(state.index) ||
      state.index < 0 ||
      !Number.isInteger(state.failures) ||
      state.failures < 0 ||
      state.failures > RETRIES + 1 ||
      typeof state.exhausted !== "boolean" ||
      typeof state.pendingDelay !== "boolean" ||
      !Array.isArray(state.skipped)
    )
      throw new Error("Invalid persisted chain state; manual reset required");
    if (
      !allowMismatch &&
      (state.fingerprint !== fingerprint(config.chains[chain]) ||
        !config.chains[chain][state.index] ||
        state.target !== identity(config.chains[chain][state.index]))
    )
      throw new Error("Model chain changed; manual reset required");
    return state;
  }
  const save = (state: State) => pi.appendEntry(ENTRY, state);
  function setup() {
    const retry = pi.getSettings().retry;
    if (
      retry?.enabled === false ||
      retry?.maxRetries !== RETRIES ||
      (retry?.provider?.maxRetries ?? 0) !== 0
    )
      throw new Error(
        "Model chains require retry.enabled=true, retry.maxRetries=2 and retry.provider.maxRetries=0; settings were not changed",
      );
  }
  function validate(ctx: ExtensionContext, chain: string) {
    for (const target of config.chains[chain]) {
      const model = ctx.modelRegistry.find(target.provider, target.model);
      if (model?.api === "pi-virtual")
        throw new Error(`Virtual target is forbidden: ${identity(target)}`);
      if (
        ctx.scopedModels.length &&
        !ctx.scopedModels.some(
          (scope) =>
            scope.model.provider === target.provider &&
            scope.model.id === target.model &&
            (!scope.thinkingLevel || scope.thinkingLevel === target.effort),
        )
      )
        throw new Error(`Unauthorized scoped target: ${identity(target)}`);
      if (model && !getSupportedThinkingLevels(model).includes(target.effort))
        throw new Error(`Unsupported exact effort: ${identity(target)}`);
      if (model && (!(model.contextWindow > 0) || !(model.maxTokens > 0)))
        throw new Error(`Unknown model limits: ${identity(target)}`);
    }
  }
  function available(
    ctx: ExtensionContext,
    chain: string,
    state: State,
    messages: readonly Message[],
    activeOnly = false,
  ): { state: State; model?: Model<string> } {
    const targets = config.chains[chain];
    const skipped = [...state.skipped];
    for (
      let index = state.index;
      index < (activeOnly ? Math.min(state.index + 1, targets.length) : targets.length);
      index++
    ) {
      const target = targets[index];
      const model = ctx.modelRegistry.find(target.provider, target.model);
      let reason: string | undefined;
      if (!model) reason = "missing catalog model";
      else if (!ctx.modelRegistry.hasConfiguredAuth(model)) reason = "no configured authentication";
      else if (hasImages(messages) && !model.input.includes("image"))
        reason = "image input unsupported";
      if (reason) {
        skipped.push({ target: identity(target), reason });
        continue;
      }
      return {
        model: model!,
        state: {
          ...state,
          index,
          target: identity(target),
          failures: index === state.index ? state.failures : 0,
          skipped,
        },
      };
    }
    return { state: { ...state, exhausted: true, skipped } };
  }
  const registered = new Set<string>();
  /** Register the configured chains as `chain/<name>` models, removing chains that no longer exist. */
  function apply(next: Config) {
    config = next;
    for (const chain of registered)
      if (!Object.hasOwn(config.chains, chain)) {
        pi.unregisterVirtualModel("chain", chain);
        registered.delete(chain);
      }
    for (const chain of Object.keys(config.chains)) {
      register(chain);
      registered.add(chain);
    }
  }
  function register(chain: string) {
    pi.registerVirtualModel({
      provider: "chain",
      id: chain,
      name: `Chain: ${chain}`,
      input: ["text", "image"],
      async route(request, ctx) {
        const targets = config.chains[chain];
        if (!targets) throw new Error(`Chain ${chain} is no longer configured`);
        if (request.reason !== "direct") setup();
        validate(ctx, chain);
        let state = read(ctx, chain);
        const previous = state;
        if (state.exhausted) throw new Error("Model chain exhausted; /chain-reset required");
        // Native retry counters can carry across targets or restart after a quota
        // continuation. The persisted physical-target budget is authoritative.
        if (request.reason !== "direct" && state.failures >= RETRIES + 1) {
          if (state.index + 1 === targets.length) {
            save({ ...state, exhausted: true, pendingDelay: false });
            throw new Error("Model chain exhausted; /chain-reset required");
          }
          state = {
            ...state,
            index: state.index + 1,
            target: identity(targets[state.index + 1]),
            failures: 0,
          };
        }
        if (request.reason === "retry" && request.failed) {
          const message = request.failed.message;
          const model = ctx.modelRegistry.find(message.provider, message.model);
          if (
            !eligible(message) &&
            !isContextOverflow(message, model?.contextWindow) &&
            !isRecoverableLength(message, model?.maxTokens ?? 0)
          )
            throw new Error("Model chain stopped: failed response is not eligible for recovery");
        }
        if (request.reason !== "direct" && state.pendingDelay && request.reason !== "retry") {
          const retry = pi.getSettings().retry;
          await delay(
            retryDelayMs(
              {
                baseDelayMs: retry?.baseDelayMs ?? 2000,
                maxAgentDelayMs: retry?.maxAgentDelayMs ?? 60000,
              },
              Math.max(1, state.failures),
            ),
            undefined,
            { signal: request.signal },
          );
          // Settings/scopes/auth may have changed while the cancellable wait ran.
          setup();
          validate(ctx, chain);
        }
        request.signal?.throwIfAborted();
        const result = available(ctx, chain, state, request.messages, request.reason === "direct");
        state = result.state;
        if (!result.model) {
          if (request.reason !== "direct")
            save({
              ...state,
              index: previous.index,
              target: previous.target,
              failures: previous.failures,
              pendingDelay: false,
            });
          throw new Error("No available authorized chain targets; /chain-reset required");
        }
        if (request.reason !== "direct") {
          const capabilities = targets
            .map((target) => ctx.modelRegistry.find(target.provider, target.model))
            .filter((model) => !!model)
            .map((model) => `${model.contextWindow}:${model.input.join(",")}`);
          if (!state.warnedCapabilities && new Set(capabilities).size > 1) {
            const warning =
              "Chain targets differ in context/image capabilities. Native compaction may run; image-incompatible targets are skipped, not converted.";
            pi.appendEntry("model-chain.warning", { chain, warning });
            if (ctx.hasUI) ctx.ui.notify(warning, "warning");
            state = { ...state, warnedCapabilities: true };
          }
          save({ ...state, pendingDelay: false });
        }
        return { model: result.model, thinkingLevel: targets[state.index].effort };
      },
    });
  }
  apply(initial);
  pi.on("turn_end", (event, ctx) => {
    const chain = selected(ctx);
    if (!chain || event.message.role !== "assistant") return;
    const state = read(ctx, chain);
    const target = config.chains[chain][state.index];
    if (
      event.message.provider !== target.provider ||
      event.message.model !== target.model ||
      state.lastEntryId === event.messageEntryId
    )
      return;
    const recover = eligible(event.message);
    const model = ctx.modelRegistry.find(target.provider, target.model);
    const successful =
      event.message.stopReason !== "error" &&
      event.message.stopReason !== "aborted" &&
      !isRecoverableLength(event.message, model?.maxTokens ?? 0);
    return {
      entries: [
        ...event.entries,
        // Commit omission at the turn boundary too: queued user work can run before
        // final settlement. Never project a failed draft or its partial tool calls.
        ...(recover
          ? [{ type: "context_edit" as const, targetId: event.messageEntryId, replacement: null }]
          : []),
        {
          type: "custom",
          customType: ENTRY,
          data: {
            ...state,
            failures: recover ? state.failures + 1 : successful ? 0 : state.failures,
            pendingDelay: recover && !isRetryableAssistantError(event.message),
            lastEntryId: event.messageEntryId,
          },
        },
      ],
    };
  });
  pi.on("agent_before_settle", async (event, ctx) => {
    const chain = selected(ctx);
    if (!chain) return;
    const state = read(ctx, chain);
    if (state.exhausted) return;
    const last = ctx.sessionManager
      .getBranch()
      .findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
    if (
      last?.type !== "message" ||
      last.message.role !== "assistant" ||
      state.lastEntryId !== last.id ||
      !eligible(last.message)
    )
      return;
    setup();
    validate(ctx, chain);
    const exhaustedTarget = state.failures >= RETRIES + 1;
    let next = {
      ...state,
      index: state.index + (exhaustedTarget ? 1 : 0),
      failures: exhaustedTarget ? 0 : state.failures,
      pendingDelay: true,
    };
    const result = available(ctx, chain, next, event.context.llmMessages);
    next = result.state;
    if (!result.model)
      return {
        entries: [
          ...event.entries,
          {
            type: "custom",
            customType: ENTRY,
            data: {
              ...next,
              index: state.index,
              target: state.target,
              failures: state.failures,
              exhausted: true,
              pendingDelay: false,
            },
          },
        ],
      };
    return {
      entries: [...event.entries, { type: "custom", customType: ENTRY, data: next }],
      continue: true,
    };
  });
  function view(ctx: ExtensionContext, chain: string): ChainView {
    let state: State | undefined;
    let changed = false;
    if (persisted(ctx, chain))
      try {
        state = read(ctx, chain, true);
        read(ctx, chain); // throws when the chain's targets changed since the state was saved
      } catch {
        changed = true;
      }
    return {
      name: chain,
      targets: config.chains[chain],
      state,
      changed,
      active: selected(ctx) === chain,
    };
  }
  function resetChain(ctx: ExtensionContext, chain: string) {
    validate(ctx, chain);
    const result = available(
      ctx,
      chain,
      fresh(chain),
      convertToLlm(ctx.sessionManager.buildSessionProjection().messages),
    );
    save(result.state);
    return result.state;
  }
  function problemFor(ctx: ExtensionContext, chain?: string) {
    try {
      setup();
      if (chain) {
        validate(ctx, chain);
        read(ctx, chain);
      }
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  function report(ctx: ExtensionContext, chain?: string, problem = problemFor(ctx, chain)) {
    const current = chain ? view(ctx, chain) : undefined;
    const content = formatStatus({
      view: current,
      chains: Object.keys(config.chains),
      problem,
    }).join("\n");
    if (ctx.hasUI) ctx.ui.notify(content, problem ? "warning" : "info");
    else
      pi.sendMessage(
        {
          customType: "model-chain.status",
          content,
          display: true,
          details: {
            chain: chain ?? null,
            state: current?.state ?? null,
            problem: problem ?? null,
          },
        },
        { triggerTurn: false },
      );
  }
  pi.registerCommand("chain-reset", {
    description: "Reset the selected model chain on this idle branch (no model call)",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) throw new Error("Chain reset requires an idle session");
      const chain = selected(ctx);
      if (!chain) throw new Error("Select a chain/<name> model first");
      resetChain(ctx, chain);
      report(ctx, chain);
    },
  });
  pi.registerCommand("chain-status", {
    description: "Show the selected chain's steps, retry budget and setup on this branch",
    handler: async (_args, ctx) => report(ctx, selected(ctx)),
  });
  pi.registerCommand("chain", {
    description: "Manage model chains: select, create, edit, reorder, reset or delete",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        report(ctx, selected(ctx));
        return;
      }
      const deps: ManagerDeps = {
        async read() {
          const file = options.path ? await readConfigFile(options.path) : { config };
          // Views show the file's chains with this branch's state for the registered ones.
          const views = Object.keys(file.config.chains).map((chain) =>
            Object.hasOwn(config.chains, chain) &&
            fingerprint(config.chains[chain]) === fingerprint(file.config.chains[chain])
              ? view(ctx, chain)
              : {
                  name: chain,
                  targets: file.config.chains[chain],
                  active: selected(ctx) === chain,
                },
          );
          return { ...file, views };
        },
        catalog: () => readCatalog(ctx),
        idle: () => ctx.isIdle(),
        async save(next, expected) {
          if (!options.path) throw new Error("No config file is available to save to");
          await writeConfigFile(options.path, next, expected);
          apply(next);
        },
        async activate(chain) {
          const model = ctx.modelRegistry.find("chain", chain);
          if (!model || !(await pi.setModel(model)))
            throw new Error(`Cannot select chain/${chain}; reload after editing the config file`);
        },
        reset: (chain) => {
          if (!Object.hasOwn(config.chains, chain))
            throw new Error(`Reload to pick up ${chain} from the config file`);
          resetChain(ctx, chain);
        },
      };
      const snapshot = await deps.read();
      await ctx.ui.custom<void>(
        (tui, theme, keys, done) =>
          createChainManager(
            deps,
            snapshot,
            theme,
            keys,
            () => tui.requestRender(),
            () => done(),
            () => Math.max(10, Math.floor(tui.terminal.rows * 0.9)),
          ),
        {
          overlay: true,
          overlayOptions: { width: "90%", maxHeight: "90%", anchor: "center" },
          blocked: { kind: "question", message: "Model chains" },
        },
      );
    },
  });
  return { apply };
}
