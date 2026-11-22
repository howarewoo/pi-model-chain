import { getSupportedThinkingLevels, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { identity, type Target } from "./config.ts";

export interface CatalogEntry {
  provider: string;
  model: string;
  name: string;
  providerLabel: string;
  virtual: boolean;
  /** Configured authentication; missing auth is allowed but skipped at runtime. */
  auth: boolean;
  /** Supported efforts; a reason marks an effort the current session scope excludes. */
  efforts: { effort: ModelThinkingLevel; reason?: string }[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number };
  vision: boolean;
  reasoning: boolean;
  /** Set when no effort of this model can be a chain target. */
  reason?: string;
}
export interface Catalog {
  entries: CatalogEntry[];
  error?: string;
}

const positive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

/** Snapshot synchronous host metadata only: no refresh, credential resolution or provider call. */
export function readCatalog(
  ctx: Pick<ExtensionContext, "modelRegistry" | "scopedModels">,
): Catalog {
  try {
    const registry = ctx.modelRegistry;
    if (registry.getError()) return { entries: [], error: "Host model metadata is unavailable" };
    const seen = new Set<string>();
    const entries: CatalogEntry[] = [];
    for (const model of registry.getAll()) {
      const key = JSON.stringify([model.provider, model.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      const virtual = model.api === "pi-virtual";
      const contextWindow = positive(model.contextWindow);
      const maxTokens = positive(model.maxTokens);
      const scoped = (effort: ModelThinkingLevel) =>
        !ctx.scopedModels.length ||
        ctx.scopedModels.some(
          (scope) =>
            scope.model.provider === model.provider &&
            scope.model.id === model.id &&
            (!scope.thinkingLevel || scope.thinkingLevel === effort),
        );
      const efforts = virtual
        ? []
        : getSupportedThinkingLevels(model).map((effort) =>
            scoped(effort)
              ? { effort }
              : { effort, reason: "Outside this session's model/effort scope" },
          );
      const cost = model.cost;
      entries.push({
        provider: model.provider,
        model: model.id,
        name: model.name || model.id,
        providerLabel: registry.getProviderDisplayName(model.provider) || model.provider,
        virtual,
        auth: !virtual && registry.hasConfiguredAuth(model),
        efforts,
        contextWindow,
        maxTokens,
        cost:
          cost && Number.isFinite(cost.input) && Number.isFinite(cost.output)
            ? { input: cost.input, output: cost.output }
            : undefined,
        vision: Array.isArray(model.input) && model.input.includes("image"),
        reasoning: !!model.reasoning,
        reason: virtual
          ? "Virtual model; chains need physical targets"
          : !contextWindow || !maxTokens
            ? "Unknown context or output limits"
            : !efforts.length
              ? "No supported efforts"
              : undefined,
      });
    }
    return { entries };
  } catch {
    return { entries: [], error: "Host model metadata could not be read" };
  }
}

export function filterCatalog(catalog: Catalog, query: string, provider = ""): CatalogEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return catalog.entries.filter(
    (entry) =>
      (!provider || entry.provider === provider) &&
      `${entry.name} ${entry.providerLabel} ${entry.provider} ${entry.model}`
        .toLocaleLowerCase()
        .includes(needle),
  );
}

/**
 * Why `target` cannot be added to a chain that already holds `taken`, or undefined when it can.
 * Missing authentication is not a reason: such targets are skipped at runtime, never authorized.
 */
export function targetReason(
  catalog: Catalog,
  target: Target,
  taken: readonly Target[] = [],
): string | undefined {
  if (catalog.error) return catalog.error;
  const entry = catalog.entries.find(
    (item) => item.provider === target.provider && item.model === target.model,
  );
  if (!entry) return "Not in the model catalogue";
  if (entry.reason) return entry.reason;
  const effort = entry.efforts.find((item) => item.effort === target.effort);
  if (!effort) return `Unsupported effort for this model: ${target.effort}`;
  if (effort.reason) return effort.reason;
  if (taken.some((item) => identity(item) === identity(target))) return "Already in this chain";
  return undefined;
}
